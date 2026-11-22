// Integration: a REAL tmux server on a private socket, with a stand-in for claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createSessionRunner } from '../../src/sessions/index.js';

const fakePath = path.resolve(import.meta.dirname, 'fixtures/sessions/fake-claude.js');

test('tmux is installed', () => {
  assert.doesNotThrow(() => execFileSync('tmux', ['-V']), 'tmux not found: install tmux');
});

// Two runners share one socket; they differ only in the log path of their stand-in claude.
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-tmux-'));
  const sock = path.join(dir, 'sock');
  const logA = path.join(dir, 'a.log');
  const logB = path.join(dir, 'b.log');
  const mk = (log) => createSessionRunner({ socket: { path: sock }, claude: [process.execPath, fakePath, log] });
  const runner = mk(logA);
  const runnerB = mk(logB);
  t.after(async () => {
    await runner.killServer().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { sock, logA, logB, runner, runnerB };
}

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean) : []);
async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}
const settle = () => new Promise((r) => setTimeout(r, 300));

test('keys reach only the chosen session', async (t) => {
  const { logA, logB, runner, runnerB } = setup(t);
  const a = await runner.start({ cwd: os.tmpdir(), name: 'a' });
  const b = await runnerB.start({ cwd: os.tmpdir(), name: 'b' });
  assert.ok(await waitFor(() => read(logA).length >= 1 && read(logB).length >= 1), 'stand-ins started');
  assert.deepEqual(JSON.parse(read(logA)[0]), ['--session-id', a.id]);
  assert.deepEqual(JSON.parse(read(logB)[0]), ['--session-id', b.id]);
  assert.deepEqual((await runner.list()).map((s) => s.id).sort(), [a.id, b.id].sort());

  assert.equal(await runner.choose(a.id), true);
  assert.equal((await runner.send('Escape')).sent, true);
  assert.ok(await waitFor(() => read(logA).includes('1b')), 'A got Escape');
  assert.equal((await runner.send('C-c')).sent, true);
  assert.ok(await waitFor(() => read(logA).includes('03')), 'A got C-c');
  await settle();
  assert.equal(read(logA).filter((l) => l === '03').length, 1);
  assert.equal(read(logB).length, 1, 'B untouched');

  const aLen = read(logA).length;
  assert.equal(await runner.choose(b.id), true);
  assert.equal((await runner.send('Space')).sent, true);
  assert.ok(await waitFor(() => read(logB).includes('20')), 'B got Space');
  await settle();
  assert.equal(read(logA).length, aLen, 'A nothing new');
});

test('nothing chosen or window gone: nothing is sent', async (t) => {
  const { sock, logA, runner, runnerB } = setup(t);
  const a = await runner.start({ cwd: os.tmpdir(), name: 'a' });
  assert.ok(await waitFor(() => read(logA).length >= 1));
  const fresh = createSessionRunner({ socket: { path: sock } });
  assert.deepEqual(await fresh.send('Escape'), { sent: false, reason: 'no session chosen' });

  // window killed behind the runner's back
  const before = read(logA).length;
  const t0 = await runner.target();
  assert.equal(t0.id, a.id);
  execFileSync('tmux', ['-f', '/dev/null', '-S', sock, 'kill-window', '-t', t0.window]);
  assert.equal(await runner.target(), null);
  assert.equal(runner.chosen(), null);
  assert.equal((await runner.send('Escape')).sent, false);
  await settle();
  assert.equal(read(logA).length, before);

  // stop clears the choice
  const b = await runnerB.start({ cwd: os.tmpdir(), name: 'b' });
  assert.equal(await runnerB.stop(b.id), true);
  assert.equal(runnerB.chosen(), null);
  assert.equal((await runnerB.send('Space')).sent, false);
});

// tmux expands formats in -c and -n, and #(cmd) runs a shell command: revview must refuse such text.
function injectionSetup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-inj-'));
  const sock = path.join(dir, 'sock');
  const pwned = path.join(dir, 'pwned');
  const runner = createSessionRunner({ socket: { path: sock }, claude: [process.execPath, fakePath, path.join(dir, 'c.log')] });
  t.after(async () => {
    await runner.killServer().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, pwned, runner };
}

test('a #(...) directory name or window name runs nothing and starts nothing', async (t) => {
  const { dir, pwned, runner } = injectionSetup(t);
  // the file name goes through the environment so the directory name has no '/'
  process.env.RV_PWNED = pwned;
  t.after(() => { delete process.env.RV_PWNED; });
  const evil = path.join(dir, '#(touch $RV_PWNED)');
  fs.mkdirSync(evil);
  await assert.rejects(runner.start({ cwd: evil }), /cwd/);
  await assert.rejects(runner.start({ cwd: dir, name: '#(touch $RV_PWNED)' }), /name/);
  await assert.rejects(runner.start({ cwd: dir, name: 'a\nb' }), /name/);
  await settle();
  await settle();
  assert.equal(fs.existsSync(pwned), false);
  assert.deepEqual(await runner.list(), []);
});

test('a normal directory and name still start', async (t) => {
  const { dir, pwned, runner } = injectionSetup(t);
  const s = await runner.start({ cwd: dir, name: 'plain-name_1' });
  assert.deepEqual((await runner.list()).map((x) => x.id), [s.id]);
  assert.equal(fs.existsSync(pwned), false);
});
