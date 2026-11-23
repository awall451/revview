import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
function start(args, { env = {}, browser = true, standOpts } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emu-run-test-'));
  const tmp = path.join(dir, 'tmp');
  fs.mkdirSync(tmp);
  const e = { ...process.env, TMPDIR: tmp, ...env };
  if (browser) e.REVVIEW_BROWSER = standIn(dir, standOpts);
  const child = spawn('bash', [RUN, ...args], { env: e, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const run = { dir, tmp, child, out: '', err: '', exited: null };
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
    assert.match(run.out, /demo mode: 1-7 scenes, P pause, \[ \] slower\/faster; see --keys/);
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
  const run = start(['--live', '--no-browser']);
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
  } finally { run.finish(); }
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
    assert.match(run.out, /^Demo keys \(demo mode only; the demo player handles them, not the bar\):$/m);
    const { buildLoop } = await import('../../emulator/demo/scenes.js');
    const names = buildLoop(1).map((s) => s.name);
    assert.equal(names.length, 7);
    for (const n of names) assert.ok(run.out.includes(n), `scene ${n}`);
    assert.match(run.out, /^ {2}1-7 .*jump to a scene/m);
    assert.match(run.out, /^ {2}P +pause/m);
    assert.match(run.out, /\[ +slower/);
    assert.match(run.out, /\] +faster/);
    assert.match(run.out, /nothing is sent to a Claude/);
    assert.match(run.out, /REVVIEW_SPEECH=config\/speech\.json/);
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
  const run = start(['--print-aliases'], { browser: false, env: { HOME: home, XDG_RUNTIME_DIR: home } });
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

// --stop: another terminal stops a running run.sh through its pid file
test('--stop with nothing running says so and exits 0', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emu-stop-'));
  try {
    const r = spawnSync('bash', [RUN, '--stop'], { encoding: 'utf8', env: { ...process.env, XDG_RUNTIME_DIR: dir } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), 'not running');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('--stop removes a stale pid file and says not running', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emu-stop-'));
  try {
    fs.writeFileSync(path.join(dir, `revview-emu-${process.getuid()}-1.pid`), '999999\n');
    // a live pid that is not a run.sh must not be signalled
    const other = spawn('sleep', ['30']);
    fs.writeFileSync(path.join(dir, `revview-emu-${process.getuid()}-2.pid`), `${other.pid}\n`);
    const r = spawnSync('bash', [RUN, '--stop'], { encoding: 'utf8', env: { ...process.env, XDG_RUNTIME_DIR: dir } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), 'not running');
    assert.ok(alive(other.pid));
    other.kill();
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('--stop stops a running run.sh: server, demo player and temp dir are gone, the pid file too', async () => {
  const xdg = fs.mkdtempSync(path.join(os.tmpdir(), 'emu-xdg-'));
  const run = start(['--no-browser'], { browser: false, env: { XDG_RUNTIME_DIR: xdg } });
  try {
    await run.url();
    const pidfile = path.join(xdg, `revview-emu-${process.getuid()}-${run.child.pid}.pid`);
    await until(() => fs.existsSync(pidfile), 'pid file');
    const server = await until(() => run.serverPid(), 'server pid');
    assert.ok(alive(server));
    // async: this process is run.sh's parent and must reap it, or --stop would see a zombie
    const stopper = spawn('bash', [RUN, '--stop'], { env: { ...process.env, XDG_RUNTIME_DIR: xdg } });
    let said = '';
    stopper.stdout.on('data', (d) => { said += d; });
    const status = await new Promise((resolve) => stopper.on('exit', resolve));
    const r = { status, stdout: said };
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^stopped \(pid \d+\)$/m);
    assert.equal((await run.exit()).code, 0);
    assert.ok(!alive(server), 'server still running');
    assert.deepEqual(leftovers(run), []);
    assert.deepEqual(fs.readdirSync(xdg), []);
    const again = spawnSync('bash', [RUN, '--stop'], { encoding: 'utf8', env: { ...process.env, XDG_RUNTIME_DIR: xdg } });
    assert.equal(again.stdout.trim(), 'not running');
  } finally { run.finish(); fs.rmSync(xdg, { recursive: true, force: true }); }
});
