import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { liveFixture } from './emu-live-helpers.js';

// emulator/run.sh with a stand-in browser (a bash script that records its args and PID, then waits for a
// "close" file or a signal). Each run gets its own TMPDIR so leftovers can be asserted.
const RUN = fileURLToPath(new URL('../../emulator/run.sh', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, what, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await sleep(50);
  }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function standIn(dir, { exitAtOnce = false, child = false } = {}) {
  const file = path.join(dir, 'stand-in.sh');
  fs.writeFileSync(file, `#!/bin/bash
printf '%s\\n' "$@" > "${dir}/args.txt"
echo $$ > "${dir}/pid.txt"
${child ? `sleep 300 &\necho $! > "${dir}/childpid.txt"` : ''}
${exitAtOnce ? 'exit 0' : `while [ ! -e "${dir}/close" ]; do sleep 0.05; done`}
`, { mode: 0o755 });
  return file;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

const portOpen = (port) => new Promise((resolve) => {
  const s = net.connect(port, '127.0.0.1');
  s.on('connect', () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
});

// Start run.sh; resolves with helpers. Always clean up with run.finish().
// Every run gets a private XDG_RUNTIME_DIR (dir/xdg) and private stand-ins for /tmp (dir/fallback) and /run/user/<uid> (dir/runuser), so a
// test never sees or stops anybody else's run.sh and leaves nothing outside its own dir. An env value of null unsets.
const runDirs = [];
// pids (not this process) whose command line contains one of the given private directories
function procsInDirs(...dirs) {
  const found = [];
  for (const p of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x) && Number(x) !== process.pid)) {
    try {
      const cmd = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8');
      if (dirs.some((d) => cmd.includes(d))) found.push(Number(p));
    } catch { /* gone */ }
  }
  return found;
}

// The guard: after the file's last test, nothing started by these tests is left running.
after(() => {
  const left = procsInDirs(...runDirs);
  for (const p of left) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
  assert.deepEqual(left, [], 'processes left behind by emulator/run.sh tests');
});

function start(args, { env = {}, browser = true, standOpts, cwd, script = RUN, setup } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emu-run-test-'));
  runDirs.push(dir);
  const tmp = path.join(dir, 'tmp');
  const xdg = path.join(dir, 'xdg');
  fs.mkdirSync(tmp);
  fs.mkdirSync(xdg, { mode: 0o700 });
  const fallback = path.join(dir, 'fallback');
  fs.mkdirSync(fallback);
  if (setup) setup({ dir, tmp, xdg, fallback });
  const runUser = path.join(dir, 'runuser');
  fs.mkdirSync(runUser);
  const e = { ...process.env, TMPDIR: tmp, XDG_RUNTIME_DIR: xdg, REVVIEW_EMU_FALLBACK_TMP: fallback, REVVIEW_EMU_FALLBACK_RUN: runUser, ...env };
  for (const k of Object.keys(e)) if (e[k] === null) delete e[k];
  if (browser) e.REVVIEW_BROWSER = standIn(dir, standOpts);
  const child = spawn('bash', [script, ...args], { env: e, cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const run = { dir, tmp, xdg, fallback, child, env: e, out: '', err: '', exited: null };
  run.pidFile = () => path.join(xdg, 'revview-emu', `${child.pid}.pid`);
  child.stdout.on('data', (d) => { run.out += d; });
  child.stderr.on('data', (d) => { run.err += d; });
  child.on('exit', (code, sig) => { run.exited = { code, sig }; });
  run.exit = () => until(() => run.exited, 'run.sh exit');
  run.url = async () => {
    const m = await until(() => /view: {2}(\S+)/.exec(run.out), 'view line');
    return m[1];
  };
  run.stand = async () => {
    const pid = Number(await until(() => fs.existsSync(path.join(dir, 'pid.txt')) && fs.readFileSync(path.join(dir, 'pid.txt'), 'utf8').trim(), 'stand-in pid'));
    await until(() => fs.readFileSync(path.join(dir, 'args.txt'), 'utf8').includes('--no-default-browser-check'), 'stand-in args');
    return { pid, args: fs.readFileSync(path.join(dir, 'args.txt'), 'utf8').split('\n').filter(Boolean) };
  };
  run.serverPid = () => {
    // the node server is a child of the script
    const kids = fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p)).filter((p) => {
      try { return fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(') ')[1].split(' ')[1] === String(child.pid); } catch { return false; }
    });
    for (const k of kids) {
      try { if (fs.readFileSync(`/proc/${k}/cmdline`, 'utf8').includes('src/server/index.js')) return Number(k); } catch { /* gone */ }
    }
    return null;
  };
  run.finish = () => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    // run.sh starts the browser in its own session (setsid), so the group kill above does not reach it: when a test ends
    // with run.sh still up, the stand-in would outlive it. Kill whatever still has this run's private dir on its command line.
    for (const p of procsInDirs(dir)) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return run;
}

const portOf = (url) => Number(new URL(url).port);
const leftovers = (run) => fs.readdirSync(run.tmp);

test('starts on a free port, serves, gives the browser the app URL and window size', async () => {
  const run = start([]);
  try {
    const url = await run.url();
    const port = portOf(url);
    assert.equal(url, `http://127.0.0.1:${port}/?devkeys=1`);
    const res = await until(() => fetch(url).catch(() => null), 'server answer');
    assert.equal(res.status, 200);
    const { args } = await run.stand();
    assert.ok(args.includes(`--app=http://127.0.0.1:${port}/?devkeys=1`), args.join(' '));
    assert.ok(args.includes('--window-size=1280,400'));
    assert.ok(args.some((a) => a.startsWith('--user-data-dir=')));
    assert.ok(!args.some((a) => a.startsWith('--force-device-scale-factor')));
  } finally { run.finish(); }
});

test('--scale 1.5 adds the device scale factor', async () => {
  const run = start(['--scale', '1.5']);
  try {
    await run.url();
    const { args } = await run.stand();
    assert.ok(args.includes('--force-device-scale-factor=1.5'), args.join(' '));
    assert.ok(args.includes('--window-size=1280,400'));
  } finally { run.finish(); }
});

test('--port is honoured', async () => {
  const want = await freePort();
  const run = start(['--port', String(want)]);
  try {
    const url = await run.url();
    assert.equal(portOf(url), want);
    const res = await until(() => fetch(url).catch(() => null), 'server answer');
    assert.equal(res.status, 200);
  } finally { run.finish(); }
});

test('the browser exiting stops the server and removes the profile', async () => {
  const run = start([], { env: { REVVIEW_QUICK_EXIT_SECS: '0' } });
  try {
    const port = portOf(await run.url());
    const { pid } = await run.stand();
    const spid = await until(() => run.serverPid(), 'server pid');
    fs.writeFileSync(path.join(run.dir, 'close'), '');
    const { code } = await run.exit();
    assert.equal(code, 0);
    assert.equal(await portOpen(port), false);
    await until(() => !alive(spid), 'server gone');
    assert.equal(alive(pid), false);
    assert.deepEqual(leftovers(run), []);
  } finally { run.finish(); }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  test(`${sig} stops the browser and the server and cleans up`, async () => {
    const run = start([]);
    try {
      const port = portOf(await run.url());
      const { pid } = await run.stand();
      const spid = await until(() => run.serverPid(), 'server pid');
      process.kill(run.child.pid, sig);
      const { code } = await run.exit();
      assert.equal(code, 0);
      assert.equal(await portOpen(port), false);
      await until(() => !alive(spid), 'server gone');
      await until(() => !alive(pid), 'browser gone');
      assert.deepEqual(leftovers(run), []);
    } finally { run.finish(); }
  });
}

test('a browser that exits at once leaves the server running until SIGINT', async () => {
  const run = start([], { env: { REVVIEW_QUICK_EXIT_SECS: '600' }, standOpts: { exitAtOnce: true } });
  try {
    const url = await run.url();
    await until(() => /another browser instance/.test(run.out), 'quick exit note');
    assert.equal(run.exited, null);
    const res = await fetch(url);
    assert.equal(res.status, 200);
    const spid = await until(() => run.serverPid(), 'server pid');
    process.kill(run.child.pid, 'SIGINT');
    const { code } = await run.exit();
    assert.equal(code, 0);
    await until(() => !alive(spid), 'server gone');
    assert.equal(await portOpen(portOf(url)), false);
    assert.deepEqual(leftovers(run), []);
  } finally { run.finish(); }
});

test('--no-browser serves and prints the URL', async () => {
  const run = start(['--no-browser']);
  try {
    const url = await run.url();
    const res = await until(() => fetch(url).catch(() => null), 'server answer');
    assert.equal(res.status, 200);
    assert.ok(!fs.existsSync(path.join(run.dir, 'pid.txt')), 'no browser started');
    process.kill(run.child.pid, 'SIGTERM');
    assert.equal((await run.exit()).code, 0);
    assert.deepEqual(leftovers(run), []);
  } finally { run.finish(); }
});

test('no browser found: prints the URL and keeps serving', async () => {
  const run = start([], { browser: false, env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', WSL_DISTRO_NAME: '' } });
  try {
    const url = await run.url();
    assert.match(run.out, /no browser found/);
    assert.equal((await fetch(url)).status, 200);
    process.kill(run.child.pid, 'SIGINT');
    assert.equal((await run.exit()).code, 0);
    assert.deepEqual(leftovers(run), []);
  } finally { run.finish(); }
});

test('--keys lists all 11 keys and the hold meanings (details: emulator-keys-sheet.test.js)', async () => {
  const run = start(['--keys'], { browser: false });
  try {
    const { code } = await run.exit();
    assert.equal(code, 0);
    assert.equal(run.out.split('\n').filter((l) => /^\S+ +[a-z-]+ {2,}\S/.test(l) && !/^KEY /.test(l)).length, 11);
    assert.match(run.out, /^Backspace +back +back +home/m);
    assert.match(run.out, /^Esc +cancel .*Ctrl\+C$/m);
  } finally { run.finish(); }
});

test('--help exits 0 with usage', async () => {
  const run = start(['--help'], { browser: false });
  try {
    assert.equal((await run.exit()).code, 0);
    assert.match(run.out, /usage: bash emulator\/run\.sh/);
  } finally { run.finish(); }
});

for (const bad of [['--bogus'], ['--port', 'x'], ['--port'], ['--scale', '0'], ['--scale', 'abc'], ['--scale', '-1']]) {
  test(`bad option ${bad.join(' ')} exits 2 with usage`, async () => {
    const run = start(bad, { browser: false });
    try {
      assert.equal((await run.exit()).code, 2);
      assert.match(run.err, /usage: bash emulator\/run\.sh/);
      assert.deepEqual(leftovers(run), []);
    } finally { run.finish(); }
  });
}

test('Node older than 22 exits 1 with the Node 22 message', async () => {
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'emu-run-fakenode-'));
  try {
    fs.writeFileSync(path.join(fake, 'node'), '#!/bin/bash\necho v18.19.0\n', { mode: 0o755 });
    const run = start([], { browser: false, env: { PATH: `${fake}:${process.env.PATH}` } });
    try {
      assert.equal((await run.exit()).code, 1);
      assert.match(run.err, /v18\.19\.0.*Node 22/);
      assert.deepEqual(leftovers(run), []);
    } finally { run.finish(); }
  } finally { fs.rmSync(fake, { recursive: true, force: true }); }
});

const stderrAfter = (run, re) => until(() => re.test(run.err), `stderr ${re}`);

async function noProcessLeft(run, pids) {
  for (const p of pids) await until(() => !alive(p), `pid ${p} gone`);
  assert.deepEqual(leftovers(run), []);
}

const readPid = (run, name) => until(() => fs.existsSync(path.join(run.dir, name)) && fs.readFileSync(path.join(run.dir, name), 'utf8').trim(), name).then(Number);

test('the server dying while the window is open: message with log tail on stderr, window closed, exit 1', async () => {
  const run = start([], { env: { REVVIEW_QUICK_EXIT_SECS: '0' } });
  try {
    await run.url();
    const { pid } = await run.stand();
    const spid = await until(() => run.serverPid(), 'server pid');
    process.kill(spid, 'SIGKILL');
    const { code } = await run.exit();
    assert.equal(code, 1);
    assert.match(run.err, /the server stopped/);
    assert.match(run.err, /view:/, 'tail of the server log');
    await noProcessLeft(run, [pid, spid]);
  } finally { run.finish(); }
});

test('the server dying with --no-browser: message on stderr (after a successful probe), exit 1', async () => {
  const run = start(['--no-browser']);
  try {
    await run.url();
    const spid = await until(() => run.serverPid(), 'server pid');
    process.kill(spid, 'SIGKILL');
    assert.equal((await run.exit()).code, 1);
    await stderrAfter(run, /the server stopped/);
    await noProcessLeft(run, [spid]);
  } finally { run.finish(); }
});

test('the server dying when the browser returned at once: message, exit 1', async () => {
  const run = start([], { env: { REVVIEW_QUICK_EXIT_SECS: '600' }, standOpts: { exitAtOnce: true } });
  try {
    await run.url();
    await until(() => /another browser instance/.test(run.out), 'quick exit note');
    const spid = await until(() => run.serverPid(), 'server pid');
    process.kill(spid, 'SIGKILL');
    assert.equal((await run.exit()).code, 1);
    assert.match(run.err, /the server stopped/);
    await noProcessLeft(run, [spid]);
  } finally { run.finish(); }
});

// The stand-in starts a background child, as a real Chromium does. run.sh starts the browser in its own process
// group and signals the whole group, so children and grandchildren in that group die too. A process that leaves
// the group itself (setsid) could still survive; Chromium's renderer processes do not do that.
test('a child of the browser does not survive the window closing', async () => {
  const run = start([], { env: { REVVIEW_QUICK_EXIT_SECS: '0' }, standOpts: { child: true } });
  try {
    await run.url();
    await run.stand();
    const kid = await readPid(run, 'childpid.txt');
    assert.equal(alive(kid), true);
    fs.writeFileSync(path.join(run.dir, 'close'), '');
    assert.equal((await run.exit()).code, 0);
    await noProcessLeft(run, [kid]);
  } finally { run.finish(); }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  test(`a child of the browser does not survive ${sig} to run.sh`, async () => {
    const run = start([], { standOpts: { child: true } });
    try {
      await run.url();
      const { pid } = await run.stand();
      const kid = await readPid(run, 'childpid.txt');
      process.kill(run.child.pid, sig);
      assert.equal((await run.exit()).code, 0);
      await noProcessLeft(run, [pid, kid]);
    } finally { run.finish(); }
  });
}

// ---- demo mode (the default) and --live ----
// The player is told its server by --url http://127.0.0.1:PORT, so that string finds its process.
function procsWith(needle) {
  return fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p)).filter((p) => {
    try { return fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').replaceAll('\0', ' ').includes(needle); } catch { return false; }
  }).map(Number);
}
const playerPids = (port) => procsWith(`emulator/demo/player.js --url http://127.0.0.1:${port}`);
const onePlayer = (port) => until(() => { const l = playerPids(port); return l.length === 1 && l; }, 'the player process');

test('default is demo mode: the server has --dev-demo, GET /dev/demo is routed, the player runs and plays', async () => {
  const run = start(['--no-browser']);
  try {
    const url = await run.url();
    const port = portOf(url);
    assert.match(run.out, /demo mode: 1-9 scenes, P pause, \[ \] slower\/faster; see --keys/);
    await until(() => /^demo: 1 working/m.test(run.out), 'first demo scene line');
    const spid = await until(() => run.serverPid(), 'server pid');
    assert.ok(fs.readFileSync(`/proc/${spid}/cmdline`, 'utf8').split('\0').includes('--dev-demo'));
    assert.equal((await onePlayer(port)).length, 1);
    // an event stream: look at the status line, then hang up
    const status = await new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/dev/demo`, { agent: false }, (res) => { resolve(res.statusCode); req.destroy(); });
      req.on('error', (e) => (e.code === 'ECONNRESET' ? undefined : reject(e)));
    });
    assert.equal(status, 200);
  } finally { run.finish(); }
});

test('--live: no player, no --dev-demo, GET /dev/demo is not routed', async () => {
  // the stand-in claude (a shim first on PATH), a fresh HOME and a temp project dir as cwd: never the real claude
  const fx = liveFixture();
  const run = start(['--live', '--no-browser'], { env: fx.env, cwd: fx.proj });
  try {
    const url = await run.url();
    const port = portOf(url);
    assert.match(run.out, /live mode: no demo; .*real Claude Code hook events/);
    assert.doesNotMatch(run.out, /demo mode/);
    const spid = await until(() => run.serverPid(), 'server pid');
    assert.ok(!fs.readFileSync(`/proc/${spid}/cmdline`, 'utf8').split('\0').includes('--dev-demo'));
    assert.equal((await fetch(`http://127.0.0.1:${port}/dev/demo`)).status, 404);
    assert.deepEqual(playerPids(port), []);
    assert.doesNotMatch(run.out, /^demo:/m);
    process.kill(run.child.pid, 'SIGTERM');
    assert.equal((await run.exit()).code, 0);
  } finally {
    run.finish();
    fx.cleanup();
  }
});

test('--demo and --live together exit 2 with usage, in either order', async () => {
  for (const args of [['--demo', '--live'], ['--live', '--demo']]) {
    const run = start(args, { browser: false });
    try {
      assert.equal((await run.exit()).code, 2);
      assert.match(run.err, /--demo and --live/);
      assert.match(run.err, /usage: bash emulator\/run\.sh/);
      assert.deepEqual(leftovers(run), []);
    } finally { run.finish(); }
  }
});

test('--demo alone (the default spelled out) is accepted', async () => {
  const run = start(['--demo', '--no-browser']);
  try {
    const port = portOf(await run.url());
    await onePlayer(port);
    process.kill(run.child.pid, 'SIGTERM');
    assert.equal((await run.exit()).code, 0);
  } finally { run.finish(); }
});

test('the window closing leaves no player process', async () => {
  const run = start([], { env: { REVVIEW_QUICK_EXIT_SECS: '0' } });
  try {
    const port = portOf(await run.url());
    await run.stand();
    const [pp] = await onePlayer(port);
    fs.writeFileSync(path.join(run.dir, 'close'), '');
    assert.equal((await run.exit()).code, 0);
    await until(() => !alive(pp), 'player gone');
    assert.deepEqual(playerPids(port), []);
    assert.deepEqual(leftovers(run), []);
  } finally { run.finish(); }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  test(`${sig} to run.sh leaves no player process`, async () => {
    const run = start([]);
    try {
      const port = portOf(await run.url());
      await run.stand();
      const [pp] = await onePlayer(port);
      process.kill(run.child.pid, sig);
      assert.equal((await run.exit()).code, 0);
      await until(() => !alive(pp), 'player gone');
      assert.deepEqual(playerPids(port), []);
      assert.deepEqual(leftovers(run), []);
    } finally { run.finish(); }
  });
}

test('the player dying alone: one note, the server keeps serving', async () => {
  const run = start(['--no-browser']);
  try {
    const url = await run.url();
    const port = portOf(url);
    const [pp] = await onePlayer(port);
    process.kill(pp, 'SIGKILL');
    await until(() => /the demo player stopped/.test(run.out), 'player note');
    assert.equal(run.out.match(/the demo player stopped/g).length, 1);
    assert.equal(run.exited, null);
    assert.equal((await fetch(url)).status, 200);
    process.kill(run.child.pid, 'SIGTERM');
    assert.equal((await run.exit()).code, 0);
  } finally { run.finish(); }
});

test('--keys lists the demo keys, every scene name and the no-Claude note', async () => {
  const run = start(['--keys'], { browser: false });
  try {
    assert.equal((await run.exit()).code, 0);
    assert.match(run.out, /^Demo keys \(demo mode only; the demo player takes them, not the bar\):$/m);
    const { buildLoop } = await import('../../emulator/demo/scenes.js');
    const names = buildLoop(1).map((s) => s.name);
    assert.equal(names.length, 9);
    for (const n of names) assert.ok(run.out.includes(n), `scene ${n}`);
    assert.match(run.out, /^ {2}1-9 .*jump/m);
    assert.match(run.out, /^ {2}P +pause/m);
    assert.match(run.out, /\[ +slower/);
    assert.match(run.out, /\] +faster/);
    assert.match(run.out, /nothing is sent to a Claude/i);
    assert.doesNotMatch(run.out, /REVVIEW_SPEECH/);
    assert.match(run.out, /espeak-ng/);
  } finally { run.finish(); }
});

test('--help describes --demo and --live', async () => {
  const run = start(['--help'], { browser: false });
  try {
    assert.equal((await run.exit()).code, 0);
    assert.match(run.out, /--demo /);
    assert.match(run.out, /--live [\s\S]*real Claude Code hook events/);
  } finally { run.finish(); }
});

test('--help lists --print-aliases and --stop', async () => {
  const run = start(['--help'], { browser: false });
  try {
    assert.equal((await run.exit()).code, 0);
    assert.match(run.out, /^usage: .*\[--print-aliases\] \[--stop\]/m);
    assert.match(run.out, /--print-aliases /);
    assert.match(run.out, /--stop /);
  } finally { run.finish(); }
});

// --print-aliases: prints the block, writes nothing, never touches $HOME/.bashrc
test('--print-aliases prints the three aliases with the real path, writes nothing, exits 0', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'emu-home-'));
  const run = start(['--print-aliases'], { browser: false, env: { HOME: home } });
  try {
    assert.equal((await run.exit()).code, 0);
    const root = path.dirname(path.dirname(RUN));
    assert.match(run.out, new RegExp(`^alias revview='bash ${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/emulator/run\\.sh'$`, 'm'));
    assert.match(run.out, /^alias revview-keys='bash .*\/emulator\/run\.sh --keys'$/m);
    assert.match(run.out, /^alias revview-stop='bash .*\/emulator\/run\.sh --stop'$/m);
    assert.deepEqual(fs.readdirSync(home), []);
    assert.deepEqual(fs.readdirSync(run.tmp), []);
    assert.equal(run.err, '');
  } finally { run.finish(); fs.rmSync(home, { recursive: true, force: true }); }
});

test('--print-aliases quotes a clone path with spaces and quotes: the printed block, sourced, runs the clone', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'emu-alias-'));
  const clone = path.join(base, "my clone's dir");
  fs.mkdirSync(path.join(clone, 'emulator'), { recursive: true });
  fs.copyFileSync(RUN, path.join(clone, 'emulator/run.sh'));
  try {
    const r = spawnSync('bash', [path.join(clone, 'emulator/run.sh'), '--print-aliases'], { encoding: 'utf8', env: { ...process.env, HOME: base } });
    assert.equal(r.status, 0);
    // run the aliases in a fresh interactive-like shell that only echoes its args: swap bash for printf
    const probe = spawnSync('bash', ['-c', `shopt -s expand_aliases; bash() { printf '%s\\n' "$@"; }; ${r.stdout}\nrevview-stop`], { encoding: 'utf8' });
    assert.equal(probe.stdout.trim().split('\n').join('|'), `${path.join(clone, 'emulator/run.sh')}|--stop`);
    assert.deepEqual(fs.readdirSync(base), ["my clone's dir"]);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ---- the pid file: a private directory, the process start time, removed on every way out ----
const uid = process.getuid();
// field 22 of /proc/<pid>/stat, counted after the last ")" (the command name may hold spaces and parentheses)
const startTime = (pid) => fs.readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /s, '').split(' ')[19];
const pidFileIn = (run, pid = run.child.pid) => path.join(run.xdg, 'revview-emu', `${pid}.pid`);
const pidFiles = (run) => { try { return fs.readdirSync(path.join(run.xdg, 'revview-emu')); } catch { return []; } };

test('the pid file holds the pid and the start time, in a private directory under XDG_RUNTIME_DIR', async () => {
  const run = start(['--no-browser']);
  try {
    await run.url();
    const f = pidFileIn(run);
    await until(() => fs.existsSync(f), 'pid file');
    assert.equal(fs.readFileSync(f, 'utf8'), `${run.child.pid} ${startTime(run.child.pid)}\n`);
    const dir = path.dirname(f);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    assert.equal(fs.lstatSync(dir).isSymbolicLink(), false);
    assert.equal(fs.statSync(f).mode & 0o077, 0, 'the file is not readable by others');
    process.kill(run.child.pid, 'SIGTERM');
    assert.equal((await run.exit()).code, 0);
  } finally { run.finish(); }
});

test('the pid file is gone after the browser stand-in closes', async () => {
  const run = start([], { env: { REVVIEW_QUICK_EXIT_SECS: '0' } });
  try {
    await run.url();
    await until(() => fs.existsSync(pidFileIn(run)), 'pid file');
    fs.writeFileSync(path.join(run.dir, 'close'), '');
    assert.equal((await run.exit()).code, 0);
    assert.deepEqual(pidFiles(run), []);
  } finally { run.finish(); }
});

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  test(`the pid file is gone after ${sig} to run.sh`, async () => {
    const run = start([]);
    try {
      await run.url();
      await run.stand();
      await until(() => fs.existsSync(pidFileIn(run)), 'pid file');
      process.kill(run.child.pid, sig);
      assert.equal((await run.exit()).code, 0);
      assert.deepEqual(pidFiles(run), []);
    } finally { run.finish(); }
  });
}

test('the pid file is gone after the server died and run.sh exited 1', async () => {
  const run = start(['--no-browser']);
  try {
    await run.url();
    await until(() => fs.existsSync(pidFileIn(run)), 'pid file');
    process.kill(await until(() => run.serverPid(), 'server pid'), 'SIGKILL');
    assert.equal((await run.exit()).code, 1);
    assert.deepEqual(pidFiles(run), []);
  } finally { run.finish(); }
});

test('without XDG_RUNTIME_DIR the directory is TMPDIR/revview-emu-<uid>, mode 700', async () => {
  const run = start(['--no-browser'], { env: { XDG_RUNTIME_DIR: null } });
  try {
    await run.url();
    const dir = path.join(run.tmp, `revview-emu-${uid}`);
    const f = path.join(dir, `${run.child.pid}.pid`);
    await until(() => fs.existsSync(f), 'pid file');
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    assert.deepEqual(fs.readdirSync(run.xdg), [], 'nothing under the unused XDG dir');
    process.kill(run.child.pid, 'SIGTERM');
    assert.equal((await run.exit()).code, 0);
    assert.equal(fs.existsSync(dir), false, 'the empty pid directory is removed on exit (r9-06)');
  } finally { run.finish(); }
});

test('a planted symlink where the directory should be is not followed: the next place is used', async () => {
  const victim = fs.mkdtempSync(path.join(os.tmpdir(), 'emu-victim-'));
  const run = start(['--no-browser'], {
    env: { XDG_RUNTIME_DIR: null },
    setup: ({ tmp }) => fs.symlinkSync(victim, path.join(tmp, `revview-emu-${uid}`)),
  });
  try {
    await run.url();
    const f = path.join(run.fallback, `revview-emu-${uid}`, `${run.child.pid}.pid`);
    await until(() => fs.existsSync(f), 'pid file in the fallback directory');
    assert.deepEqual(fs.readdirSync(victim), [], 'nothing written through the symlink');
    assert.equal(run.err, '');
    process.kill(run.child.pid, 'SIGTERM');
    assert.equal((await run.exit()).code, 0);
  } finally { run.finish(); fs.rmSync(victim, { recursive: true, force: true }); }
});

test('a symlinked revview-emu inside XDG_RUNTIME_DIR is not followed either', async () => {
  const victim = fs.mkdtempSync(path.join(os.tmpdir(), 'emu-victim-'));
  const run = start(['--no-browser'], { setup: ({ xdg }) => fs.symlinkSync(victim, path.join(xdg, 'revview-emu')) });
  try {
    await run.url();
    await until(() => fs.existsSync(path.join(run.tmp, `revview-emu-${uid}`, `${run.child.pid}.pid`)), 'pid file in the TMPDIR directory');
    assert.deepEqual(fs.readdirSync(victim), []);
    process.kill(run.child.pid, 'SIGTERM');
    assert.equal((await run.exit()).code, 0);
  } finally { run.finish(); fs.rmSync(victim, { recursive: true, force: true }); }
});

test('a directory open to others is not used', async () => {
  const run = start(['--no-browser'], {
    env: { XDG_RUNTIME_DIR: null },
    setup: ({ tmp }) => { const d = path.join(tmp, `revview-emu-${uid}`); fs.mkdirSync(d); fs.chmodSync(d, 0o777); },
  });
  try {
    await run.url();
    await until(() => fs.existsSync(path.join(run.fallback, `revview-emu-${uid}`, `${run.child.pid}.pid`)), 'pid file in the fallback directory');
    assert.deepEqual(fs.readdirSync(path.join(run.tmp, `revview-emu-${uid}`)), [], 'the open directory was not used');
    process.kill(run.child.pid, 'SIGTERM');
    assert.equal((await run.exit()).code, 0);
  } finally { run.finish(); }
});

test('no safe directory at all: one clear line, no raw bash error, the run keeps going', async () => {
  const run = start(['--no-browser'], {
    env: { XDG_RUNTIME_DIR: '/nonexistent', REVVIEW_EMU_FALLBACK_TMP: '/nonexistent/x' },
    setup: ({ tmp }) => fs.symlinkSync('/nonexistent', path.join(tmp, `revview-emu-${uid}`)),
  });
  try {
    await run.url();
    await until(() => /^Serving until/m.test(run.out), 'serving');
    assert.equal(run.exited, null);
    assert.equal(run.err.trim(), 'run.sh: no pid file; --stop will not find this run');
    process.kill(run.child.pid, 'SIGTERM');
    assert.equal((await run.exit()).code, 0);
  } finally { run.finish(); }
});

// ---- --stop ----
// Async, never spawnSync, when the run.sh to stop is a child of this process: this process must reap it.
function stop(env, opts = {}) {
  const e = { ...process.env, ...env };
  for (const k of Object.keys(e)) if (e[k] === null) delete e[k]; // null unsets
  const c = spawn('bash', [RUN, '--stop'], { env: e, cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  c.stdout.on('data', (d) => { out += d; });
  c.stderr.on('data', (d) => { err += d; });
  const timer = setTimeout(() => c.kill('SIGKILL'), 20000);
  return new Promise((resolve) => c.on('exit', (status, sig) => { clearTimeout(timer); resolve({ status, sig, out, err }); }));
}
const envOf = (run) => ({ TMPDIR: run.tmp, XDG_RUNTIME_DIR: run.xdg, REVVIEW_EMU_FALLBACK_TMP: run.fallback, REVVIEW_EMU_FALLBACK_RUN: path.join(run.dir, 'runuser') });
// a stop with nothing else in the way: private dirs of its own
function lone(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emu-stop-'));
  const x = { dir, xdg: path.join(dir, 'xdg'), tmp: path.join(dir, 'tmp'), fallback: path.join(dir, 'fallback') };
  fs.mkdirSync(x.xdg, { mode: 0o700 });
  fs.mkdirSync(x.tmp);
  x.pidDir = path.join(x.xdg, 'revview-emu');
  fs.mkdirSync(x.pidDir, { mode: 0o700 });
  return Promise.resolve(fn(x)).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

test('--stop with nothing running says so and exits 0', () => lone(async (x) => {
  const r = await stop(envOf(x));
  assert.equal(r.status, 0);
  assert.equal(r.out.trim(), 'not running');
}));

test('--stop: a stale file (pid gone) and a live pid that is another process are removed, neither is signalled', () => lone(async (x) => {
  fs.writeFileSync(path.join(x.pidDir, '1.pid'), '999999 12345\n');
  const other = spawn('sleep', ['30']);
  // an unrelated process whose command line even says emulator/run.sh must not match either
  const decoy = spawn('bash', ['-c', 'sleep 30', 'emulator/run.sh', '--no-browser']);
  fs.writeFileSync(path.join(x.pidDir, '2.pid'), `${other.pid} 1\n`);
  fs.writeFileSync(path.join(x.pidDir, '3.pid'), `${decoy.pid} 1\n`);
  fs.writeFileSync(path.join(x.pidDir, '4.pid'), 'garbage\n');
  try {
    const r = await stop(envOf(x));
    assert.equal(r.status, 0);
    assert.equal(r.out.trim(), 'not running');
    assert.ok(alive(other.pid), 'the other process was signalled');
    assert.ok(alive(decoy.pid), 'the decoy was signalled');
    assert.deepEqual(fs.readdirSync(x.pidDir), []);
  } finally { other.kill(); decoy.kill(); }
}));

test('--stop does not read a symlink or a FIFO, and does not hang on one', () => lone(async (x) => {
  const other = spawn('sleep', ['30']);
  const victim = path.join(x.dir, 'victim.pid');
  // a symlink to a file that would match: the live process with its real start time
  fs.writeFileSync(victim, `${other.pid} ${startTime(other.pid)}\n`);
  fs.symlinkSync(victim, path.join(x.pidDir, '5.pid'));
  const fifo = path.join(x.pidDir, '6.pid');
  assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
  try {
    const r = await stop(envOf(x));
    assert.equal(r.sig, null, 'stop hung and was killed');
    assert.equal(r.status, 0);
    assert.equal(r.out.trim(), 'not running');
    assert.ok(alive(other.pid), 'the process behind the symlink was signalled');
    assert.deepEqual(fs.readdirSync(x.pidDir).sort(), ['5.pid', '6.pid'], 'the symlink and the FIFO are left alone');
  } finally { other.kill(); }
}));

test('--stop ignores a pid directory that is a symlink', () => lone(async (x) => {
  const other = spawn('sleep', ['30']);
  const real = path.join(x.dir, 'real');
  fs.mkdirSync(real, { mode: 0o700 });
  fs.writeFileSync(path.join(real, '7.pid'), `${other.pid} ${startTime(other.pid)}\n`);
  fs.rmSync(x.pidDir, { recursive: true });
  fs.symlinkSync(real, x.pidDir);
  try {
    const r = await stop(envOf(x));
    assert.equal(r.out.trim(), 'not running');
    assert.ok(alive(other.pid));
  } finally { other.kill(); }
}));

test('--stop stops a running run.sh: server, demo player and temp dir are gone, the pid file too', async () => {
  const run = start(['--no-browser']);
  try {
    await run.url();
    await until(() => fs.existsSync(pidFileIn(run)), 'pid file');
    const server = await until(() => run.serverPid(), 'server pid');
    assert.ok(alive(server));
    const r = await stop(envOf(run));
    assert.equal(r.status, 0);
    assert.match(r.out, /^stopped \(pid \d+\)$/m);
    assert.equal((await run.exit()).code, 0);
    assert.ok(!alive(server), 'server still running');
    assert.deepEqual(leftovers(run), []);
    assert.deepEqual(pidFiles(run), []);
    assert.equal((await stop(envOf(run))).out.trim(), 'not running');
  } finally { run.finish(); }
});

test('--stop finds a run started from inside emulator/ with a relative path, and stops it', async () => {
  const emu = path.dirname(RUN);
  for (const script of ['run.sh', './run.sh']) {
    const run = start(['--no-browser'], { cwd: emu, script });
    try {
      await run.url();
      await until(() => fs.existsSync(pidFileIn(run)), 'pid file');
      const r = await stop(envOf(run), { cwd: emu });
      assert.match(r.out, /^stopped \(pid \d+\)$/m, `${script}: ${r.out}`);
      assert.equal((await run.exit()).code, 0);
      assert.deepEqual(pidFiles(run), []);
    } finally { run.finish(); }
  }
});

// three started at once into one XDG_RUNTIME_DIR: the first to make revview-emu must not make the others fall back
test('--stop stops every run.sh of the user that is running (three started together share one directory)', async () => {
  const a = start(['--no-browser']);
  const rest = [1, 2].map(() => start(['--no-browser'], { env: { XDG_RUNTIME_DIR: a.xdg } }));
  const all = [a, ...rest];
  try {
    for (const r of all) await r.url();
    await until(() => all.every((r) => fs.existsSync(path.join(a.xdg, 'revview-emu', `${r.child.pid}.pid`))), 'all pid files in the one directory');
    const r = await stop(envOf(a));
    assert.equal(r.out.match(/^stopped \(pid \d+\)$/gm)?.length, 3, r.out);
    for (const x of all) assert.equal((await x.exit()).code, 0);
    assert.deepEqual(pidFiles(a), []);
  } finally { for (const x of all) x.finish(); }
});

// --stop scans every place a run may have written to, not only the ones its own environment names. All private dirs.
test('--stop finds a run started with XDG_RUNTIME_DIR set when it has XDG unset, if that directory is /run/user/<uid>', async () => {
  // the run's dir is a fixed private one standing in for /run/user/<uid>: the helper makes it before start()
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'emu-cross-'));
  const ru = path.join(base, 'ru');
  fs.mkdirSync(ru, { mode: 0o700 });
  const run = start(['--no-browser'], { env: { XDG_RUNTIME_DIR: ru } });
  try {
    await run.url();
    await until(() => fs.existsSync(path.join(ru, 'revview-emu', `${run.child.pid}.pid`)), 'pid file');
    const r = await stop({ ...envOf(run), XDG_RUNTIME_DIR: null, REVVIEW_EMU_FALLBACK_RUN: ru });
    assert.match(r.out, /^stopped \(pid \d+\)$/m, r.out);
    assert.equal((await run.exit()).code, 0);
  } finally { run.finish(); fs.rmSync(base, { recursive: true, force: true }); }
});

test('--stop finds a run started without XDG_RUNTIME_DIR when it has another XDG_RUNTIME_DIR (same TMPDIR)', async () => {
  const run = start(['--no-browser'], { env: { XDG_RUNTIME_DIR: null } });
  try {
    await run.url();
    await until(() => fs.existsSync(path.join(run.tmp, `revview-emu-${uid}`, `${run.child.pid}.pid`)), 'pid file');
    const other = path.join(run.dir, 'other-xdg');
    fs.mkdirSync(other, { mode: 0o700 });
    const r = await stop({ ...envOf(run), XDG_RUNTIME_DIR: other });
    assert.match(r.out, /^stopped \(pid \d+\)$/m, r.out);
    assert.equal((await run.exit()).code, 0);
  } finally { run.finish(); }
});

test('--stop finds a run that wrote to another TMPDIR, when that is /tmp for the stop (private stand-in)', async () => {
  const run = start(['--no-browser'], { env: { XDG_RUNTIME_DIR: null } });
  try {
    await run.url();
    await until(() => fs.existsSync(path.join(run.tmp, `revview-emu-${uid}`, `${run.child.pid}.pid`)), 'pid file');
    const otherTmp = path.join(run.dir, 'other-tmp');
    fs.mkdirSync(otherTmp);
    const r = await stop({ ...envOf(run), XDG_RUNTIME_DIR: null, TMPDIR: otherTmp, REVVIEW_EMU_FALLBACK_TMP: run.tmp });
    assert.match(r.out, /^stopped \(pid \d+\)$/m, r.out);
    assert.equal((await run.exit()).code, 0);
  } finally { run.finish(); }
});

test('--stop does NOT find a run in a directory that is none of the scanned ones', async () => {
  const run = start(['--no-browser'], { env: { XDG_RUNTIME_DIR: null } });
  try {
    await run.url();
    await until(() => fs.existsSync(path.join(run.tmp, `revview-emu-${uid}`, `${run.child.pid}.pid`)), 'pid file');
    const otherTmp = path.join(run.dir, 'other-tmp');
    fs.mkdirSync(otherTmp);
    const r = await stop({ ...envOf(run), XDG_RUNTIME_DIR: null, TMPDIR: otherTmp });
    assert.equal(r.out.trim(), 'not running');
    assert.equal(run.exited, null);
  } finally { run.finish(); }
});

test('--stop never signals pid 0, 1, a negative pid, a leading-zero pid or junk; such files are removed', () => lone(async (x) => {
  const other = spawn('sleep', ['30']);
  const st = startTime(other.pid);
  const files = {
    'a0.pid': `0 ${st}\n`,
    'a1.pid': `1 ${startTime(1)}\n`,
    'a2.pid': `-1 ${st}\n`,
    'a3.pid': `-${other.pid} ${st}\n`,
    'a4.pid': `0${other.pid} ${st}\n`, // leading zero: not the pid it looks like
    'a5.pid': `${other.pid} 0${st}\n`,
    'a6.pid': '1e3 5\n',
    'a7.pid': '\n',
    'a8.pid': `${other.pid}\n`,
  };
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(x.pidDir, n), c);
  try {
    const r = await stop(envOf(x));
    assert.equal(r.status, 0);
    assert.equal(r.out.trim(), 'not running');
    assert.ok(alive(other.pid), 'a bad pid file made --stop signal the process');
    assert.deepEqual(fs.readdirSync(x.pidDir), [], 'junk files are removed like stale ones');
  } finally { other.kill(); }
}));

test('--stop goes through all pid files when one run does not stop: exit 1 at the end, that file stays', () => lone(async (x) => {
  const ready = path.join(x.dir, 'ready');
  const stubborn = spawn('bash', ['-c', `trap '' TERM; : > '${ready}'; while :; do sleep 0.1; done`]);
  const normal = spawn('sleep', ['30']);
  try {
    await until(() => fs.existsSync(ready), 'trap set');
    fs.writeFileSync(path.join(x.pidDir, '1-stubborn.pid'), `${stubborn.pid} ${startTime(stubborn.pid)}\n`);
    fs.writeFileSync(path.join(x.pidDir, '2-normal.pid'), `${normal.pid} ${startTime(normal.pid)}\n`);
    const r = await stop({ ...envOf(x), REVVIEW_EMU_STOP_WAIT_SECS: '1' });
    assert.equal(r.status, 1);
    assert.match(r.err, new RegExp(`pid ${stubborn.pid} did not stop within 1 s`));
    assert.match(r.out, new RegExp(`^stopped \\(pid ${normal.pid}\\)$`, 'm'), 'the later run was still stopped');
    assert.ok(alive(stubborn.pid));
    assert.deepEqual(fs.readdirSync(x.pidDir), ['1-stubborn.pid']);
  } finally { stubborn.kill('SIGKILL'); normal.kill('SIGKILL'); }
}));

test('--print-aliases: the comment line does not carry the path (a newline in it cannot break out of the comment)', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'emu-alias-'));
  const clone = path.join(base, 'a\nrm -rf x\nb');
  fs.mkdirSync(path.join(clone, 'emulator'), { recursive: true });
  fs.copyFileSync(RUN, path.join(clone, 'emulator/run.sh'));
  try {
    const r = spawnSync('bash', [path.join(clone, 'emulator/run.sh'), '--print-aliases'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    const lines = r.stdout.trimEnd().split('\n');
    assert.equal(lines[0], '# revview emulator');
    assert.equal(lines.length, 4, r.stdout);
    for (const l of lines.slice(1)) assert.match(l, /^alias revview(-keys|-stop)?='/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
