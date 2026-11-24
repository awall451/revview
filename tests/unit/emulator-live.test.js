import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { liveFixture } from './emu-live-helpers.js';

// emulator/run.sh --live with a stand-in `claude` (a shim on PATH running fixtures/sessions/fake-claude-live.js) and a REAL tmux
// on a private socket inside the run's own work dir. Every run has a private TMPDIR, XDG_RUNTIME_DIR, fallback dirs and a fresh
// HOME; nothing here ever starts the real claude or touches the default tmux socket.
const RUN = fileURLToPath(new URL('../../emulator/run.sh', import.meta.url));
const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const BASH = '/bin/bash';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, what, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await sleep(50);
  }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

const runDirs = [];
const sockets = []; // every tmux socket a test used: the guard kills those servers (only those) at the end
const fixtures = [];
const tmux = (sock, ...args) => spawnSync('tmux', ['-f', '/dev/null', '-S', sock, ...args], { encoding: 'utf8' });

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

// The guard: after the file's last test, no tmux server, stand-in claude, server or browser stand-in is left.
after(() => {
  for (const s of sockets) tmux(s, 'kill-server');
  const left = procsInDirs(...runDirs, ...fixtures);
  for (const p of left) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
  for (const d of [...runDirs, ...fixtures]) fs.rmSync(d, { recursive: true, force: true });
  assert.deepEqual(left, [], 'processes left behind by the --live tests');
});

function standIn(dir) {
  const file = path.join(dir, 'stand-in.sh');
  fs.writeFileSync(file, `#!/bin/bash
printf '%s\\n' "$@" > "${dir}/args.txt"
echo $$ > "${dir}/pid.txt"
while [ ! -e "${dir}/close" ]; do sleep 0.05; done
`, { mode: 0o755 });
  return file;
}

// opts: fx (a liveFixture; made when absent), env (null unsets), browser (stand-in browser, default none), setup, path (replaces PATH)
function startLive(args, { fx = liveFixture(), env = {}, browser = false, setup, cwd } = {}) {
  fixtures.push(fx.dir);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emu-live-test-'));
  runDirs.push(dir);
  const tmp = path.join(dir, 'tmp');
  const xdg = path.join(dir, 'xdg');
  const fallback = path.join(dir, 'fallback');
  const runUser = path.join(dir, 'runuser');
  fs.mkdirSync(tmp);
  fs.mkdirSync(xdg, { mode: 0o700 });
  fs.mkdirSync(fallback);
  fs.mkdirSync(runUser);
  if (setup) setup({ dir, tmp, xdg, fallback });
  const e = {
    ...process.env, ...fx.env, TMPDIR: tmp, XDG_RUNTIME_DIR: xdg, REVVIEW_EMU_FALLBACK_TMP: fallback, REVVIEW_EMU_FALLBACK_RUN: runUser, ...env,
  };
  for (const k of Object.keys(e)) if (e[k] === null) delete e[k];
  if (browser) e.REVVIEW_BROWSER = standIn(dir);
  const child = spawn(BASH, [RUN, ...args], { env: e, cwd: cwd ?? fx.proj, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const run = { dir, tmp, xdg, fallback, fx, child, env: e, out: '', err: '', exited: null };
  child.stdout.on('data', (d) => { run.out += d; });
  child.stderr.on('data', (d) => { run.err += d; });
  child.on('exit', (code, sig) => { run.exited = { code, sig }; });
  run.exit = () => until(() => run.exited, 'run.sh exit');
  run.pidFiles = () => { try { return fs.readdirSync(path.join(xdg, 'revview-emu')).filter((f) => f.endsWith('.pid')); } catch { return []; } };
  run.url = async () => (await until(() => /view: {2}(\S+)/.exec(run.out), 'view line'))[1];
  run.origin = async () => new URL(await run.url()).origin;
  run.attach = async () => {
    const m = await until(() => /^attach: tmux -S (\S+) attach -t revview$/m.exec(run.out), 'attach line');
    sockets.push(m[1]);
    return { line: m[0].slice('attach: '.length), sock: m[1] };
  };
  run.serverPid = () => {
    for (const p of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
      try {
        if (fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(') ')[1].split(' ')[1] === String(child.pid)
          && fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').includes('src/server/index.js')) return Number(p);
      } catch { /* gone */ }
    }
    return null;
  };
  // everything is up: the stand-in claude has started (its info file) and the server is known
  run.up = async () => {
    const { sock } = await run.attach();
    const info = await until(() => fx.stand(), 'stand-in claude info');
    const spid = await until(() => run.serverPid(), 'server pid');
    return { sock, info, spid };
  };
  run.stopped = async ({ sock, info, spid }) => {
    await until(() => tmux(sock, 'has-session', '-t', 'revview').status !== 0, 'the private tmux server gone');
    await until(() => !alive(spid), 'node server gone');
    await until(() => !alive(info.pid), 'stand-in claude gone');
    assert.equal(fs.existsSync(path.dirname(sock)), false, 'the work dir is removed');
    // before finish() kills anything: no process of this run is left, and no tmux server answers on its socket
    await until(() => procsInDirs(run.tmp).length === 0, `no process left in the run's work directory (${procsInDirs(run.tmp)})`);
    assert.notEqual(tmux(sock, 'list-sessions').status, 0, 'no tmux server answers on the socket');
  };
  run.finish = () => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    for (const s of sockets) tmux(s, 'kill-server');
    for (const p of procsInDirs(dir, fx.dir)) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
    fs.rmSync(dir, { recursive: true, force: true });
    fx.cleanup();
  };
  return run;
}

const listing = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).sort() : null);

// ---- a. the preflight ----
function minimalPath(fx, withNames) {
  const d = path.join(fx.dir, 'minbin');
  fs.mkdirSync(d);
  for (const n of withNames) {
    const found = n === 'claude' ? path.join(fx.shim, 'claude') : spawnSync(BASH, ['-c', `command -v ${n}`], { encoding: 'utf8' }).stdout.trim();
    fs.symlinkSync(found, path.join(d, n));
  }
  return d;
}

for (const [missing, re] of [
  ['tmux', /run\.sh: --live needs tmux on PATH \(not found\); install tmux/],
  ['claude', /run\.sh: --live needs Claude Code \(claude\) on PATH \(not found\); install Claude Code/],
]) {
  test(`--live without ${missing} on PATH: exit 1 with the message, nothing made, nothing started`, async () => {
    const fx = liveFixture();
    const names = ['node', 'dirname', 'id', ...(missing === 'tmux' ? ['claude'] : ['tmux'])];
    const run = startLive(['--live', '--no-browser'], { fx, env: { PATH: minimalPath(fx, names) } });
    try {
      const { code } = await run.exit();
      assert.equal(code, 1);
      assert.match(run.err, re);
      assert.deepEqual(run.pidFiles(), []);
      assert.deepEqual(fs.readdirSync(run.tmp), []);
      assert.deepEqual(fs.readdirSync(run.fallback), []);
      assert.equal(run.serverPid(), null);
      assert.equal(run.out, '');
    } finally { run.finish(); }
  });
}

test('--live with a project dir that is not a directory exits 2', async () => {
  const run = startLive(['--live', '/no/such/dir-for-revview', '--no-browser']);
  try {
    assert.equal((await run.exit()).code, 2);
    assert.match(run.err, /run\.sh: .*\/no\/such\/dir-for-revview/);
    assert.deepEqual(fs.readdirSync(run.tmp), []);
  } finally { run.finish(); }
});

test('--live PROJECT_DIR: a bare word elsewhere is still an unknown option', async () => {
  const run = startLive(['--live', '--no-browser', 'stray']);
  try {
    assert.equal((await run.exit()).code, 2);
    assert.match(run.err, /unknown option: stray/);
  } finally { run.finish(); }
});

// ---- b. start ----
test('--live DIR: the session runs in DIR in a private tmux server; claude gets --settings from the work dir; nothing in HOME or the project', async () => {
  const fx = liveFixture();
  const projLink = path.join(fx.dir, 'projlink'); // given through a symlink: the physical path is used
  fs.symlinkSync(fx.proj, projLink);
  const homeBefore = listing(fx.home);
  const run = startLive(['--live', projLink, '--no-browser'], { fx, cwd: os.tmpdir() });
  try {
    const { sock, info } = await run.up();
    const att = await run.attach();
    assert.equal(att.line, `tmux -S ${sock} attach -t revview`);
    assert.ok(sock.startsWith(run.tmp + path.sep), `the socket is in the work dir under TMPDIR: ${sock}`);
    assert.match(run.out, /live mode: no demo; Claude Code runs in .* and sends its real Claude Code hook events to 127\.0\.0\.1:\d+/);
    assert.match(run.out, /detach again with Ctrl-b d; closing the window, Ctrl\+C or run\.sh --stop ends this Claude session/);
    assert.doesNotMatch(run.out, /TMUX is set/);
    const wins = tmux(sock, 'list-windows', '-t', 'revview', '-F', '#{pane_current_path}');
    assert.equal(wins.status, 0, wins.stderr);
    assert.equal(wins.stdout.trim(), fx.proj);
    assert.equal(info.cwd, fx.proj);
    const settings = info.argv[info.argv.indexOf('--settings') + 1];
    assert.ok(settings.startsWith(path.dirname(sock) + path.sep), settings);
    assert.ok(info.argv.includes('--session-id'));
    const port = Number(new URL(await run.url()).port);
    assert.equal(info.port, String(port), 'the hooks know the server port');
    const hooks = JSON.parse(read(settings)).hooks;
    assert.ok(hooks.PermissionRequest && hooks.SessionStart && hooks.Stop);
    const cmds = Object.values(hooks).flatMap((g) => g.flatMap((x) => x.hooks.map((h) => h.command)));
    assert.ok(cmds.every((c) => c.includes(`${REPO}/hooks/`) && c.endsWith(' # revview-hook')), cmds.join('\n'));
    // nothing written where the user's own Claude lives
    assert.equal(fs.existsSync(path.join(fx.home, '.claude')), false);
    assert.equal(fs.existsSync(path.join(fx.home, '.claude.json')), false);
    assert.deepEqual(listing(fx.home), homeBefore);
    assert.equal(fs.existsSync(path.join(fx.proj, '.claude')), false);
    process.kill(run.child.pid, 'SIGTERM');
    assert.equal((await run.exit()).code, 0);
  } finally { run.finish(); }
});

test('--live without a dir uses the current directory; with TMUX set a hint about the attach line is printed', async () => {
  const fx = liveFixture();
  const run = startLive(['--live', '--no-browser'], { fx, env: { TMUX: '/nonexistent/sock,1,0' } });
  try {
    const { sock } = await run.up();
    assert.equal(tmux(sock, 'list-windows', '-t', 'revview', '-F', '#{pane_current_path}').stdout.trim(), fx.proj);
    assert.match(run.out, /TMUX=/);
    process.kill(run.child.pid, 'SIGTERM');
    assert.equal((await run.exit()).code, 0);
  } finally { run.finish(); }
});

// ---- c. permission answers through the dev bridge key route ----
test('the stand-in claude asks twice; Enter in the page allows, N denies; its hook output says so', async () => {
  const run = startLive(['--live', '--no-browser']);
  try {
    const { info } = await run.up();
    const origin = await run.origin();
    const log = (f) => path.join(run.fx.log, f);
    const view = async () => (await (await fetch(`${origin}/state`)).json()).state.view;
    const press = async (code) => {
      for (const type of ['down', 'up']) {
        const r = await fetch(`${origin}/dev/key`, { method: 'POST', body: JSON.stringify({ code, type }) });
        assert.equal(r.status, 204);
      }
    };
    const decision = async (n) => JSON.parse(await until(() => read(log(`decision-${n}.json`)).trim(), `decision-${n}`)).hookSpecificOutput;
    await until(() => fs.existsSync(log('prompt-1')), 'the first prompt');
    await until(async () => (await view()) === 'permission', 'the bar shows the prompt');
    await sleep(1800); // the bar must have shown the prompt for 1.5 s before a button answers
    await press('Enter');
    const d1 = await decision(1);
    assert.equal(d1.hookEventName, 'PermissionRequest');
    assert.deepEqual(d1.decision, { behavior: 'allow' });
    await until(() => fs.existsSync(log('prompt-2')), 'the second prompt');
    await until(async () => (await view()) === 'permission', 'the bar shows the second prompt');
    await sleep(1800);
    await press('KeyN');
    const d2 = await decision(2);
    assert.equal(d2.decision.behavior, 'deny');
    assert.ok(d2.decision.message.length > 0);
    assert.ok(alive(info.pid));
    process.kill(run.child.pid, 'SIGTERM');
    assert.equal((await run.exit()).code, 0);
  } finally { run.finish(); }
});

// ---- d. every way to stop ----
for (const [name, stop] of [
  ['SIGTERM', (run) => process.kill(run.child.pid, 'SIGTERM')],
  ['SIGINT', (run) => process.kill(run.child.pid, 'SIGINT')],
  ['SIGHUP', (run) => process.kill(run.child.pid, 'SIGHUP')],
  ['run.sh --stop', async (run) => {
    // asynchronous: the event loop must stay free to reap the stopped run.sh (a zombie looks alive to --stop)
    const second = spawn(BASH, [RUN, '--stop'], { env: run.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    second.stdout.on('data', (d) => { out += d; });
    second.stderr.on('data', (d) => { err += d; });
    const code = await new Promise((r) => second.on('exit', r));
    assert.equal(code, 0, err);
    assert.match(out, /stopped \(pid \d+\)/);
  }],
]) {
  test(`${name} ends the Claude session, the private tmux server, the server and the work dir`, async () => {
    const run = startLive(['--live', '--no-browser']);
    try {
      const up = await run.up();
      assert.equal(tmux(up.sock, 'has-session', '-t', 'revview').status, 0);
      await stop(run);
      assert.equal((await run.exit()).code, 0);
      await run.stopped(up);
      assert.deepEqual(fs.readdirSync(run.tmp), []);
      assert.deepEqual(run.pidFiles(), []);
    } finally { run.finish(); }
  });
}

test('the window closing ends the Claude session and the private tmux server', async () => {
  const run = startLive(['--live'], { browser: true, env: { REVVIEW_QUICK_EXIT_SECS: '0' } });
  try {
    const up = await run.up();
    await until(() => fs.existsSync(path.join(run.dir, 'args.txt')), 'the browser stand-in');
    fs.writeFileSync(path.join(run.dir, 'close'), '');
    assert.equal((await run.exit()).code, 0);
    await run.stopped(up);
    assert.deepEqual(fs.readdirSync(run.tmp), []);
  } finally { run.finish(); }
});

test('a socket path over 100 bytes fails before anything starts', async () => {
  const long = fs.mkdtempSync(path.join(os.tmpdir(), 'emu-long-'));
  runDirs.push(long);
  const deep = path.join(long, 'x'.repeat(90));
  fs.mkdirSync(deep);
  const run = startLive(['--live', '--no-browser'], { env: { TMPDIR: deep } });
  try {
    assert.equal((await run.exit()).code, 1);
    assert.match(run.err, /tmux socket path is too long \(\d+ bytes/);
    assert.ok(run.err.includes(deep), 'names the path');
    assert.match(run.err, /shorter TMPDIR/);
    assert.equal(run.fx.stand(), null, 'the stand-in claude was not started');
    assert.deepEqual(procsInDirs(run.dir, long), []);
    assert.equal(run.serverPid(), null);
  } finally { run.finish(); }
});

// ---- e. an unrelated tmux server is left alone ----
test('another tmux server on its own socket is not touched by a run or its stop', async () => {
  const other = { sock: null };
  const run = startLive(['--live', '--no-browser'], {
    setup: ({ dir }) => {
      other.sock = path.join(dir, 'other.sock');
      sockets.push(other.sock);
      const r = tmux(other.sock, 'new-session', '-d', '-s', 'mine', '--', 'sleep', '300'); // argv form: exec'd directly, no shell (the gate user's SHELL may be nologin)
      assert.equal(r.status, 0, r.stderr);
    },
  });
  try {
    const up = await run.up();
    assert.notEqual(up.sock, other.sock);
    assert.equal(tmux(other.sock, 'has-session', '-t', 'mine').status, 0);
    process.kill(run.child.pid, 'SIGTERM');
    assert.equal((await run.exit()).code, 0);
    await run.stopped(up);
    assert.equal(tmux(other.sock, 'has-session', '-t', 'mine').status, 0, 'the other server still has its session');
  } finally {
    tmux(other.sock, 'kill-server');
    run.finish();
  }
});

// ---- f. QA round 9 ----
const REPO_DOC = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const pressKey = async (origin, code) => {
  for (const type of ['down', 'up']) {
    const r = await fetch(`${origin}/dev/key`, { method: 'POST', body: JSON.stringify({ code, type }) });
    assert.equal(r.status, 204);
  }
};
const stateOf = async (origin) => (await (await fetch(`${origin}/state`)).json()).state;
const windowsOf = (sock) => tmux(sock, 'list-windows', '-t', 'revview', '-F', '#{pane_current_path}').stdout.trim().split('\n').filter(Boolean);

// menu -> New session -> the (only) row. The bar may show a permission prompt: Enter only moves in the menu and the list.
async function newSession(origin) {
  await pressKey(origin, 'KeyM');
  await sleep(300);
  await pressKey(origin, 'Enter'); // the menu row "New session"
  await until(async () => (await stateOf(origin)).nav?.kind === 'new', 'the New session list');
  await sleep(300);
  await pressKey(origin, 'Enter'); // the row
}

test('r9-01: menu -> New session starts a second real session in DIR (the projects file run.sh made); the bar counts 2', async () => {
  const run = startLive(['--live', '--no-browser']);
  try {
    const up = await run.up();
    const origin = await run.origin();
    await until(async () => (await stateOf(origin)).position?.count === 1, 'the first session on the bar');
    const argv = fs.readFileSync(`/proc/${up.spid}/cmdline`, 'utf8').split('\0');
    const pf = argv[argv.indexOf('--projects') + 1];
    assert.ok(pf.startsWith(run.tmp), 'the projects file is in the run\'s own temp dir');
    assert.deepEqual(JSON.parse(fs.readFileSync(pf, 'utf8')), { projects: [run.fx.proj] });
    await newSession(origin);
    await until(() => windowsOf(up.sock).length === 2, 'a second window');
    assert.deepEqual(windowsOf(up.sock), [run.fx.proj, run.fx.proj]);
    await until(async () => (await stateOf(origin)).position?.count === 2, 'the bar shows 2 sessions');
    process.kill(run.child.pid, 'SIGTERM');
    assert.equal((await run.exit()).code, 0);
    await run.stopped(up);
  } finally { run.finish(); }
});

test('r9-01: REVVIEW_PROJECTS set by the owner is honoured and no projects file is made', async () => {
  const fx = liveFixture();
  const other = path.join(fx.dir, 'other');
  fs.mkdirSync(other);
  const file = path.join(fx.dir, 'mine.json');
  fs.writeFileSync(file, JSON.stringify({ projects: [other] }));
  const run = startLive(['--live', '--no-browser'], { fx, env: { REVVIEW_PROJECTS: file } });
  try {
    const up = await run.up();
    const origin = await run.origin();
    assert.equal(fs.readFileSync(`/proc/${up.spid}/cmdline`, 'utf8').includes('--projects'), false);
    await until(async () => (await stateOf(origin)).position?.count === 1, 'the first session on the bar');
    await newSession(origin);
    await until(() => windowsOf(up.sock).length === 2, 'a second window');
    assert.deepEqual(windowsOf(up.sock).sort(), [fx.proj, other].sort());
    process.kill(run.child.pid, 'SIGTERM');
    assert.equal((await run.exit()).code, 0);
    await run.stopped(up);
  } finally { run.finish(); }
});

test('r9-02: the pattern the guide and the bench item give for leftover processes matches the real command lines of a run', async () => {
  const guide = REPO_DOC('docs/EMULATOR-LAPTOP.md');
  const bench = REPO_DOC('docs/BENCH-TEST.md');
  const g = /grep -E\s+'([^']*src\/server\/index\.js)'/.exec(guide);
  assert.ok(g, 'the guide has the grep -E pattern');
  const l11 = bench.slice(bench.indexOf('| L11 |'), bench.indexOf('| L12 |'));
  assert.ok(l11.includes(g[1].replace(/\|/g, '\\|')), 'the bench item L11 has the same pattern');
  const pattern = new RegExp(g[1]);
  const run = startLive(['--live', '--no-browser']);
  try {
    const up = await run.up();
    const mine = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)).map((p) => {
      try { return fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').replace(/\0/g, ' '); } catch { return ''; }
    }).filter((c) => c.includes(run.tmp));
    assert.ok(mine.some((c) => pattern.test(c) && c.includes('src/server/index.js')), 'finds the node server');
    assert.ok(mine.some((c) => /^tmux /.test(c) && pattern.test(c)), `finds the private tmux server (${mine.join(' | ')})`);
    process.kill(run.child.pid, 'SIGTERM');
    assert.equal((await run.exit()).code, 0);
    await run.stopped(up);
  } finally { run.finish(); }
});

test('r9-03: a claude that exits at once gives a plain message, exit 1, nothing left', async () => {
  const fx = liveFixture();
  fs.writeFileSync(path.join(fx.shim, 'claude'), '#!/bin/bash\necho "not signed in" >&2\nexit 1\n', { mode: 0o755 });
  const run = startLive(['--live', '--no-browser'], { fx });
  try {
    assert.equal((await run.exit()).code, 1);
    assert.match(run.err, /Claude exited at once/);
    assert.match(run.err, /Run `claude` once in a normal terminal/);
    assert.doesNotMatch(run.err, /server stopped while starting/);
    assert.doesNotMatch(run.err, /Command failed/);
    assert.deepEqual(procsInDirs(run.tmp), []);
    assert.deepEqual(fs.readdirSync(run.tmp), []);
  } finally { run.finish(); }
});

test('r9-04: a DIR with "#" or a control character is refused before anything starts, exit 2', async () => {
  for (const name of ['d#h', 'd\u0001x', 'd\nx']) {
    for (const viaArg of [true, false]) {
      const fx = liveFixture(); // run.finish() removes it
      const bad = path.join(fx.dir, name);
      fs.mkdirSync(bad);
      const [args, cwd] = viaArg ? [['--live', bad, '--no-browser'], undefined] : [['--live', '--no-browser'], bad];
      const run = startLive(args, { fx, cwd });
      try {
        assert.equal((await run.exit()).code, 2, JSON.stringify(name));
        assert.match(run.err, /--live: DIR must not contain/);
        assert.equal(fx.stand(), null);
        assert.deepEqual(fs.readdirSync(run.tmp), []);
      } finally { run.finish(); }
    }
  }
  assert.match(REPO_DOC('docs/EMULATOR-LAPTOP.md'), /DIR[^.]*`#`/);
});

test('r9-06: the pid directory under TMPDIR is removed when empty after the run; --stop with another TMPDIR says where it looked', async () => {
  const run = startLive(['--live', '--no-browser'], { env: { XDG_RUNTIME_DIR: null } });
  try {
    const up = await run.up();
    const dir = path.join(run.tmp, `revview-emu-${process.getuid()}`);
    await until(() => fs.existsSync(dir), 'the pid dir under TMPDIR');
    const other = fs.mkdtempSync(path.join(run.dir, 'othertmp-'));
    const env = { ...run.env, TMPDIR: other };
    delete env.XDG_RUNTIME_DIR;
    const s = spawnSync(BASH, [RUN, '--stop'], { env, encoding: 'utf8' });
    assert.equal(s.status, 0);
    assert.equal(s.stdout.trim(), 'not running');
    assert.match(s.stderr, /looked only under this shell's TMPDIR=.*another TMPDIR is not found/);
    assert.equal(alive(run.child.pid), true, 'the run was not touched');
    process.kill(run.child.pid, 'SIGTERM');
    assert.equal((await run.exit()).code, 0);
    await run.stopped(up);
    assert.deepEqual(fs.readdirSync(run.tmp), [], 'no empty revview-emu-<uid> left');
  } finally { run.finish(); }
});

test('r9-05: the guide says what "Too early: press again" means', () => {
  assert.match(REPO_DOC('docs/EMULATOR-LAPTOP.md'), /Too early: press again/);
});

// ---- cycle 36: the known gaps of --live ----
test('c36-01: the first session of a --live run shows STARTING (not UNKNOWN) until its first hook', async () => {
  const fx = liveFixture();
  // a claude that stays up and sends no hook: only the STARTING mark can explain the view
  fs.writeFileSync(path.join(fx.shim, 'claude'), '#!/bin/bash\nwhile :; do sleep 0.1; done\n', { mode: 0o755 });
  const run = startLive(['--live', '--no-browser'], { fx });
  try {
    const { sock } = await run.attach();
    const origin = await run.origin();
    const s = await until(async () => { const st = await stateOf(origin); return st.position?.count === 1 ? st : null; }, 'the first session on the bar');
    assert.equal(s.view, 'starting');
    process.kill(-run.child.pid, 'SIGTERM');
    assert.equal((await run.exit()).code, 0);
    assert.notEqual(tmux(sock, 'list-sessions').status, 0);
  } finally { run.finish(); }
});

for (const [name, body] of [
  ['exits after 1.5 s', 'sleep 1.5\necho "not signed in" >&2\nexit 1'],
  ['is killed after 1.5 s', 'sleep 1.5\nkill -9 $$'],
]) {
  for (const browser of [false, true]) {
    test(`c36-02: a claude that ${name}, after the server is up (browser ${browser}), gives the Claude exited message, exit 1, nothing left`, async () => {
      const fx = liveFixture();
      fs.writeFileSync(path.join(fx.shim, 'claude'), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
      const run = startLive(browser ? ['--live'] : ['--live', '--no-browser'], { fx, browser });
      try {
        assert.equal((await run.exit()).code, 1);
        // on a slow machine the server may answer after the stand-in has ended: the older message then
        assert.match(run.err, /run\.sh: Claude exited (within \d+ s of starting|at once)/);
        assert.match(run.err, /Run `claude` once in a normal terminal/);
        assert.doesNotMatch(run.err, /server stopped/);
        assert.deepEqual(procsInDirs(run.tmp), []);
        assert.deepEqual(fs.readdirSync(run.tmp), []);
        assert.deepEqual(run.pidFiles(), []);
        assert.equal(fs.existsSync(path.join(run.xdg, 'revview-emu')), false, 'the pid directory is removed');
      } finally { run.finish(); }
    });
  }
}

test('c36-02b: a claude that ends a clear time after the server is up gives the within-window message (only the new path)', async () => {
  const fx = liveFixture();
  const marker = path.join(fx.dir, 'end-now');
  fs.writeFileSync(path.join(fx.shim, 'claude'), `#!/bin/bash\nwhile [ ! -e "${marker}" ]; do sleep 0.05; done\nexit 1\n`, { mode: 0o755 });
  const run = startLive(['--live', '--no-browser'], { fx });
  try {
    await run.attach(); // printed once the server answers
    await sleep(1000);
    fs.writeFileSync(marker, '');
    assert.equal((await run.exit()).code, 1);
    assert.match(run.err, /run\.sh: Claude exited within 10 s of starting/);
    assert.doesNotMatch(run.err, /Claude exited at once/);
    assert.match(run.err, /Run `claude` once in a normal terminal/);
    assert.deepEqual(fs.readdirSync(run.tmp), []);
  } finally { run.finish(); }
});

test('c36-03: a claude that ends later than the window is not reported as an error (the run goes on as before)', async () => {
  const fx = liveFixture();
  // REVVIEW_EMU_CLAUDE_WINDOW is a test-only override (default 10): window 3 s, claude ends 12 s after it started, so the
  // margin is large even when the machine is loaded
  fs.writeFileSync(path.join(fx.shim, 'claude'), '#!/bin/bash\nsleep 12\nexit 0\n', { mode: 0o755 });
  const run = startLive(['--live', '--no-browser'], { fx, env: { REVVIEW_EMU_CLAUDE_WINDOW: '3' } });
  try {
    await run.attach();
    await sleep(14500);
    assert.equal(run.exited, null, 'still serving');
    assert.doesNotMatch(run.err, /Claude exited/);
    process.kill(-run.child.pid, 'SIGTERM');
    assert.equal((await run.exit()).code, 0);
    assert.deepEqual(fs.readdirSync(run.tmp), []);
  } finally { run.finish(); }
});
