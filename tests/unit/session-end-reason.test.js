// Cycle 39: why a session revview started ended: last screen lines to the log, a short reason on the bar.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSessionRunner } from '../../src/sessions/index.js';
import { cleanScreen } from '../../src/sessions/runner.js';
import { initialBoard, reduceBoard, boardView } from '../../src/state/index.js';
import { startLiveServer } from '../../src/server/index.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const fold = (b, ...events) => events.reduce((x, e) => reduceBoard(x, e), b);
const exitFixture = path.resolve(import.meta.dirname, 'fixtures/sessions/fake-claude-exit.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(50); }
  return null;
}

// ---- cleanScreen ----
test('cleanScreen: ANSI and control characters go, trailing blanks and the tmux dead-pane line go, 20 lines at most', () => {
  const raw = ['\u001b[31mred\u001b[0m text\u0007', 'ok\u0000\u001b]0;title\u0007 done', '', '   ', 'Pane is dead (status 1, Tue)', ''].join('\n');
  assert.deepEqual(cleanScreen(raw), ['red text', 'ok done']);
  const many = Array.from({ length: 50 }, (_, i) => `l${i}`).join('\n');
  const out = cleanScreen(many);
  assert.equal(out.length, 20);
  assert.equal(out[19], 'l49');
  assert.deepEqual(cleanScreen(''), []);
  assert.deepEqual(cleanScreen(null), []);
  assert.ok(cleanScreen('x'.repeat(1000))[0].length <= 300);
});

// ---- runner against a real tmux ----
function mk(t, claude, newId = () => A) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-reap-'));
  const runner = createSessionRunner({ socket: { path: path.join(dir, 'sock') }, claude, newId });
  t.after(async () => { await runner.killServer().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }); });
  return runner;
}
const reaped = (runner) => until(async () => { const r = await runner.reap(); return r.length > 0 ? r : null; });

test('tmux: a claude that prints and exits is reaped once, with its last lines and status, and no window is left', async (t) => {
  const runner = mk(t, [process.execPath, exitFixture, '3', 'first line', '\\e[1mAuthentication failed\\e[0m: run claude to sign in']);
  await runner.start({ cwd: os.tmpdir(), name: 'dead' });
  const got = await reaped(runner);
  assert.ok(got, 'the dead window was found');
  assert.equal(got.length, 1);
  assert.equal(got[0].id, A);
  assert.equal(got[0].name, 'dead');
  // strict: tmux 3.4 can miss the SIGCHLD of a pane started with the server (its status then never comes); reap makes the
  // server wait for one more child (run-shell true), which collects the zombie and fills in pane_dead_status
  assert.equal(got[0].status, 3);
  assert.deepEqual(got[0].lines.slice(-2), ['first line', 'Authentication failed: run claude to sign in']);
  assert.deepEqual(await runner.list(), []);
  assert.deepEqual(await runner.reap(), [], 'nothing is left to reap: no dead window piles up');
});

test('tmux: a dead window is not a live session; a window stopped on purpose is never reaped', async (t) => {
  const dead = mk(t, [process.execPath, exitFixture, '0', 'bye']);
  await dead.start({ cwd: os.tmpdir() });
  await until(async () => (await dead.list()).length === 0 || null); // exited but still there: list hides it
  assert.deepEqual(await dead.list(), []);
  assert.equal((await reaped(dead)).length, 1);
  const live = mk(t, [process.execPath, path.resolve(import.meta.dirname, 'fixtures/sessions/fake-claude.js'), path.join(os.tmpdir(), `rv-log-${process.pid}`)], () => B);
  await live.start({ cwd: os.tmpdir() });
  assert.equal((await live.list()).length, 1);
  assert.equal(await live.stop(B), true);
  assert.deepEqual(await live.reap(), []);
  assert.deepEqual(await live.list(), []);
});

test('tmux: no server gives nothing; an empty screen gives no lines', async (t) => {
  assert.deepEqual(await mk(t, ['true']).reap(), []);
  const runner = mk(t, ['true']);
  await runner.start({ cwd: os.tmpdir() });
  const got = await reaped(runner);
  assert.deepEqual(got[0].lines, []);
});

// ---- board ----
test('board: the reason of a session that ended is on the bar, cut and cleaned; no reason keeps the old notes', () => {
  let b = fold(initialBoard(), ev('RevviewOwned', { ids: [A], names: ['alpha'] }), ev('RevviewSelect', { session_id: A }), ev('RevviewLaunching', { session_id: A }));
  b = fold(b, ev('RevviewEndReason', { session_id: A, text: '\u001b[31mError:\u001b[0m   not signed in\u0007' }), ev('RevviewOwned', { ids: [], names: [] }));
  assert.equal(boardView(b).note, 'Session ended: Error: not signed in');
  const long = fold(initialBoard(), ev('RevviewOwned', { ids: [A], names: ['alpha'] }), ev('RevviewSelect', { session_id: A }),
    ev('RevviewEndReason', { session_id: A, text: 'x'.repeat(500) }), ev('RevviewOwned', { ids: [], names: [] }));
  assert.ok(boardView(long).note.length <= 100, String(boardView(long).note.length));
  assert.ok(boardView(long).note.endsWith('…'));
  const none = fold(initialBoard(), ev('RevviewOwned', { ids: [A], names: ['alpha'] }), ev('RevviewSelect', { session_id: A }), ev('RevviewOwned', { ids: [], names: [] }));
  assert.equal(boardView(none).note, 'alpha ended: open the menu for New session');
});

test('board: a reason that arrives after the end note replaces it; an empty screen says so; the memory is bounded', () => {
  let b = fold(initialBoard(), ev('RevviewOwned', { ids: [A], names: ['alpha'] }), ev('RevviewSelect', { session_id: A }), ev('RevviewOwned', { ids: [] }));
  assert.equal(b.note, 'alpha ended: open the menu for New session');
  b = reduceBoard(b, ev('RevviewEndReason', { session_id: A, text: '   ' }));
  assert.equal(b.note, 'Session ended: no output');
  for (let i = 0; i < 20; i++) b = reduceBoard(b, ev('RevviewEndReason', { session_id: `s${i}`, text: 't' }));
  assert.ok(Object.keys(b.endReasons).length <= 8);
  assert.equal(reduceBoard(b, ev('RevviewEndReason', { session_id: 5, text: 'x' })), b);
});

test('board: a press with no session clears the reason note like the other ended notes', () => {
  let b = fold(initialBoard(), ev('RevviewOwned', { ids: [A] }), ev('RevviewSelect', { session_id: A }), ev('RevviewEndReason', { session_id: A, text: 'boom' }), ev('RevviewOwned', { ids: [] }));
  assert.equal(b.note, 'Session ended: boom');
  b = reduceBoard(b, ev('RevviewNoSessionPress'));
  assert.notEqual(b.note, 'Session ended: boom');
});

// ---- server: log and bar ----
test('server: reaped lines go to the log (bounded) and the last non-empty line to the bar', async (t) => {
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.join(' '));
  t.after(() => { console.error = orig; });
  let listed = [{ id: A, window: '@0', cwd: '/x', name: 'alpha' }];
  let dead = [];
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const runner = { list: async () => listed, reap: async () => { const r = dead; dead = []; return r; } };
  const live = await startLiveServer({ port: 0, boot: true, sessions: runner });
  t.after(() => live.close());
  await live.refreshOwned();
  live.select(A);
  listed = [];
  dead = [{ id: A, name: 'alpha', status: 1, lines }];
  await live.refreshOwned();
  assert.equal(live.state().note, 'Session ended: line 19');
  assert.equal(logs.filter((l) => l.startsWith('  | ')).length, 20);
  assert.ok(logs.some((l) => /ended with status 1/.test(l) && l.includes(A)), logs.join('\n'));
});

// ---- review round: reap races, unknown status, foreign windows, other sessions' notes ----
function fakeTmux(state) {
  const calls = [];
  const exec = async (bin, args) => {
    const cmd = args.find((a) => ['list-panes', 'display-message', 'capture-pane', 'kill-window'].includes(a));
    calls.push(cmd);
    if (cmd === 'list-panes') return { stdout: state.panes.map((p) => p.join('\t')).join('\n') + '\n' };
    if (cmd === 'display-message') return { stdout: `${state.late ?? ''}\n` };
    if (cmd === 'capture-pane') {
      if (state.captureFails) throw new Error("can't find pane");
      return { stdout: 'boom\n' };
    }
    if (cmd === 'kill-window') {
      if (state.killFails) throw new Error("can't find window");
      return { stdout: '' };
    }
    return { stdout: '' };
  };
  return { calls, exec };
}
const mkFake = (state, clock) => {
  const f = fakeTmux(state);
  const runner = createSessionRunner({ exec: f.exec, now: () => clock.t, sleep: async () => {} });
  return { runner, calls: f.calls };
};

test('reap: a dead pane whose exit status is not known yet is left for a later poll, then reported with null', async () => {
  const clock = { t: 1000 };
  const state = { panes: [['@1', '%1', '1', '', A, 'w']] };
  const { runner, calls } = mkFake(state, clock);
  assert.deepEqual(await runner.reap(), []);
  assert.ok(!calls.includes('kill-window'), 'the window is kept so that the status can still arrive');
  state.late = '3'; // the status arrives (asked again on the next poll)
  clock.t += 5000;
  const got = await runner.reap();
  assert.equal(got.length, 1);
  assert.equal(got[0].status, 3);
  state.panes = [['@2', '%2', '1', '', B, 'x']];
  state.late = '';
  clock.t += 5000;
  assert.deepEqual(await runner.reap(), []);
  clock.t += 5000;
  const last = await runner.reap();
  assert.equal(last.length, 1);
  assert.equal(last[0].status, null);
});

test('reap: a status that shows up on the second ask is used at once', async () => {
  const state = { panes: [['@1', '%1', '1', '', A, 'w']], late: '9' };
  const { runner } = mkFake(state, { t: 1 });
  assert.equal((await runner.reap())[0].status, 9);
});

test('reap: two reaps at once report one ended session once', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-reap-'));
  const clock = { t: 1000 };
  const runner = createSessionRunner({ socket: { path: path.join(dir, 'sock') }, claude: [process.execPath, exitFixture, '2', 'only once'], newId: () => A, now: () => clock.t });
  t.after(async () => { await runner.killServer().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }); });
  await runner.start({ cwd: os.tmpdir() });
  await until(async () => (await runner.list()).length === 0 || null);
  // the exit status can take a poll to show up: the pair is run again a poll later, and the session comes out of one of them, once
  const all = [];
  for (let round = 0; round < 2; round++) {
    const [x, y] = await Promise.all([runner.reap(), runner.reap()]);
    all.push(...x, ...y);
    clock.t += 5000;
  }
  assert.equal(all.length, 1, JSON.stringify(all));
  assert.deepEqual(all[0].lines.slice(-1), ['only once']);
});

test('reap: a capture that fails because the window is gone is dropped, not reported as an empty screen', async () => {
  const state = { panes: [['@1', '%1', '1', '4', A, 'w']], captureFails: true, killFails: true };
  const { runner } = mkFake(state, { t: 1 });
  assert.deepEqual(await runner.reap(), []);
  state.killFails = false; // the window is still there and could be killed: that is reported (empty lines)
  const got = await runner.reap();
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].lines, []);
});

test('reap: a dead window without @revview_id (opened by hand) is killed after the grace time, never reported', async () => {
  const clock = { t: 1000 };
  const state = { panes: [['@5', '%5', '1', '0', '', 'hand']] };
  const { runner, calls } = mkFake(state, clock);
  assert.deepEqual(await runner.reap(), []);
  assert.ok(!calls.includes('kill-window'), 'not at the first sight: start() may not have tagged it yet');
  clock.t += 5000;
  assert.deepEqual(await runner.reap(), []);
  assert.ok(calls.includes('kill-window'));
});

test('board: the reason of one session does not replace the end note of another', () => {
  const C = '33333333-3333-4333-8333-333333333333';
  let b = fold(initialBoard(), ev('RevviewOwned', { ids: [A, C], names: ['alpha', 'gamma'] }), ev('RevviewSelect', { session_id: A }), ev('RevviewOwned', { ids: [C], names: ['gamma'] }));
  assert.equal(b.note, 'alpha ended');
  b = reduceBoard(b, ev('RevviewEndReason', { session_id: C, text: 'gamma died' }));
  assert.equal(b.note, 'alpha ended', 'C is still on the board; its reason waits');
  b = reduceBoard(b, ev('RevviewEndReason', { session_id: A, text: 'alpha died' }));
  assert.equal(b.note, 'Session ended: alpha died');
});

test('server: a reaped session is logged once (no extra "disappeared" line)', async (t) => {
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.join(' '));
  t.after(() => { console.error = orig; });
  let listed = [{ id: A, window: '@0', cwd: '/x', name: 'alpha' }];
  let dead = [];
  const runner = { list: async () => listed, reap: async () => { const r = dead; dead = []; return r; } };
  const live = await startLiveServer({ port: 0, boot: true, sessions: runner });
  t.after(() => live.close());
  await live.refreshOwned();
  listed = [];
  dead = [{ id: A, name: 'alpha', status: 1, lines: ['x'] }];
  await live.refreshOwned();
  await live.refreshOwned();
  assert.equal(logs.filter((l) => /disappeared/.test(l)).length, 0, logs.join('\n'));
  assert.equal(logs.filter((l) => /ended with status 1/.test(l)).length, 1);
});

// ---- review round 2: a lost SIGCHLD (the dead pane's status never comes until the server reaps another child) ----
test('reap: an unknown status makes tmux run one child (run-shell true) before asking again, once per reap', async () => {
  const calls = [];
  let nudged = false;
  const exec = async (bin, args) => {
    const cmd = args.find((a) => ['list-panes', 'display-message', 'capture-pane', 'kill-window', 'run-shell'].includes(a));
    calls.push(cmd);
    if (cmd === 'run-shell') { assert.deepEqual(args.slice(args.indexOf('run-shell')), ['run-shell', 'true']); nudged = true; }
    if (cmd === 'list-panes') return { stdout: `@1\t%1\t1\t\t${A}\tw\n@2\t%2\t1\t\t${B}\tx\n` };
    if (cmd === 'display-message') return { stdout: nudged ? '3\n' : '\n' };
    return { stdout: '' };
  };
  const runner = createSessionRunner({ exec, sleep: async () => {} });
  const got = await runner.reap();
  assert.deepEqual(got.map((g) => g.status), [3, 3]);
  assert.equal(calls.filter((c) => c === 'run-shell').length, 1);
  assert.ok(calls.indexOf('run-shell') < calls.indexOf('display-message'));
});

// ---- review round 2: a tmux command that hangs ----
test('runner: a tmux command that never answers times out and is a failure for every caller, and later calls still run', async () => {
  let hang = true;
  const exec = () => (hang ? new Promise(() => {}) : Promise.resolve({ stdout: '' }));
  const runner = createSessionRunner({ exec, timeoutMs: 50, sleep: async () => {} });
  await assert.rejects(runner.reap(), /timed out/);
  await assert.rejects(runner.list(), /timed out/);
  await assert.rejects(runner.killServer(), /timed out/);
  await assert.rejects(runner.send('Escape', A), /timed out/);
  await assert.rejects(runner.start({ cwd: os.tmpdir() }), /timed out/, 'has-session timing out is not "no server"');
  const pending = [runner.reap(), runner.reap(), runner.reap()];
  for (const p of pending) await assert.rejects(p, /timed out/);
  hang = false;
  assert.deepEqual(await runner.reap(), [], 'the reap queue is not stuck');
  assert.deepEqual(await runner.list(), []);
});

test('runner: a stand-in tmux that sleeps is killed at the timeout', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-hang-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'tmux');
  const pidFile = path.join(dir, 'pid');
  fs.writeFileSync(bin, `#!/bin/sh\necho $$ > '${pidFile}'\nexec sleep 30\n`, { mode: 0o755 });
  const runner = createSessionRunner({ tmux: bin, socket: { path: path.join(dir, 'sock') }, timeoutMs: 300 });
  const t0 = Date.now();
  await assert.rejects(runner.list(), /timed out/);
  assert.ok(Date.now() - t0 < 5000);
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  const gone = await until(async () => { try { process.kill(pid, 0); return null; } catch { return true; } }, 3000);
  assert.ok(gone, `the hung child ${pid} was killed`);
});

test('server: owned polls do not pile up behind a reap that hangs (one running, at most one more waiting)', async (t) => {
  let calls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const runner = { list: async () => [], reap: async () => { calls++; if (calls === 2) await gate; return []; } };
  const live = await startLiveServer({ port: 0, boot: true, sessions: runner });
  t.after(() => live.close());
  assert.equal(calls, 1, 'the first refresh at start');
  const first = live.refreshOwned();
  await wait(20);
  const more = Array.from({ length: 10 }, () => live.refreshOwned());
  await wait(20);
  assert.equal(calls, 2);
  release();
  await Promise.all([first, ...more]);
  assert.equal(calls, 3, 'the waiting callers share one later run');
});

test('server: no end reason is applied once the server is closing', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let hang = false;
  let listed = [{ id: A, window: '@0', cwd: '/x', name: 'alpha' }];
  const runner = { list: async () => listed, reap: async () => { if (!hang) return []; await gate; return [{ id: A, name: 'alpha', status: 1, lines: ['late'] }]; } };
  const live = await startLiveServer({ port: 0, boot: true, sessions: runner });
  live.select(A);
  listed = [];
  await live.refreshOwned();
  assert.match(String(live.state().note), /^alpha ended/, 'the end note is A\'s: a reason for A would replace it');
  hang = true;
  const p = live.refreshOwned();
  await wait(20);
  await live.close();
  const before = JSON.stringify(live.state());
  release();
  await p;
  assert.equal(JSON.stringify(live.state()), before, 'the board did not change after close');
});
