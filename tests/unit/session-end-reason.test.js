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
  assert.equal((await dead.reap()).length, 1);
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
