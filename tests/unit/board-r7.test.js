// QA r7-01: the note when the last session ends says what to do; a push-to-talk tap with no session clears it;
// a key-on session that vanishes while STARTING gets the key-on note.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, reduceBoard, boardView } from '../../src/state/index.js';
import { startLiveServer, bootSessions } from '../../src/server/index.js';

const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const fold = (b, ...events) => events.reduce((x, e) => reduceBoard(x, e), b);
const KEYON = 'Key-on session ended at once: see the server log';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GONE = ev('RevviewOwned', { ids: [], names: [] });

test('r7-01: the last session gone (its window): "<repo> ended: open the menu for New session"', () => {
  let q = fold(initialBoard(), ev('RevviewOwned', { ids: [A], names: ['alpha'] }), ev('RevviewSelect', { session_id: A }));
  q = reduceBoard(q, GONE);
  assert.equal(boardView(q).note, 'alpha ended: open the menu for New session');
});

test('r7-01: with other sessions left the note stays "<repo> ended"', () => {
  let b = fold(initialBoard(), ev('RevviewOwned', { ids: [A, B], names: ['alpha', 'beta'] }), ev('RevviewSelect', { session_id: A }));
  b = reduceBoard(b, ev('RevviewOwned', { ids: [B], names: ['beta'] }));
  assert.equal(boardView(b).note, 'alpha ended');
});

test('r7-01: a key-on session that vanishes while STARTING gets the key-on note; a plain launched one does not', () => {
  const base = (keyOn) => fold(initialBoard(), ev('RevviewOwned', { ids: [A], names: ['alpha'] }), ev('RevviewSelect', { session_id: A }), ev('RevviewLaunching', { session_id: A, ...(keyOn ? { keyon: true } : {}) }));
  assert.equal(boardView(reduceBoard(base(true), GONE)).note, KEYON);
  assert.equal(boardView(reduceBoard(base(false), GONE)).note, 'alpha ended: open the menu for New session');
  // past the launch limit it is no longer "at once"
  const late = reduceBoard(base(true), ev('RevviewLaunchExpired', { session_id: A }));
  assert.equal(boardView(reduceBoard(late, GONE)).note, 'alpha ended: open the menu for New session');
});

test('r7-01: RevviewNoSessionPress clears an ended note, not other notes', () => {
  const b = fold(initialBoard(), ev('RevviewOwned', { ids: [A], names: ['alpha'] }), ev('RevviewSelect', { session_id: A }), GONE);
  assert.ok(boardView(b).note);
  assert.equal(boardView(reduceBoard(b, ev('RevviewNoSessionPress'))).note, null);
  const o = fold(initialBoard(), ev('RevviewNote', { note: 'Read aloud: no speech engine installed' }));
  assert.equal(reduceBoard(o, ev('RevviewNoSessionPress')).note, 'Read aloud: no speech engine installed');
});

test('r7-01 (server): key-on window gone at the first poll gives the key-on note; a push-to-talk tap then shows the no-session line', async (t) => {
  const orig = console.error;
  console.error = () => {};
  t.after(() => { console.error = orig; });
  let listed = [];
  const runner = { list: async () => listed, start: async () => { listed = [{ id: A, window: '@0', cwd: '/x', name: 'alpha' }]; return { id: A, window: '@0', cwd: '/x' }; }, send: async () => ({ sent: true }) };
  const live = await startLiveServer({ port: 0, boot: true, sessions: runner, devBridge: true });
  t.after(() => live.close());
  await bootSessions({ runner, live, dirs: ['/x'], log: () => {} });
  listed = [];
  await live.refreshOwned();
  assert.equal(live.state().note, KEYON);
  const n = live.gestures().length;
  await fetch(`${live.url}/dev/key`, { method: 'POST', body: JSON.stringify({ code: 'F13', type: 'down' }) });
  await fetch(`${live.url}/dev/key`, { method: 'POST', body: JSON.stringify({ code: 'F13', type: 'up' }) });
  for (let i = 0; i < 100 && live.gestures().length === n; i++) await sleep(10);
  await sleep(100);
  assert.equal(live.state().note, null);
  assert.equal(live.state().voice, 'no-session');
});

test('r7-01 (server): a non-key-on session whose window goes: "<repo> ended: open the menu for New session", tap clears it', async (t) => {
  const orig = console.error;
  console.error = () => {};
  t.after(() => { console.error = orig; });
  let listed = [{ id: A, window: '@0', cwd: '/x', name: 'alpha' }];
  const runner = { list: async () => listed, send: async () => ({ sent: true }) };
  const live = await startLiveServer({ port: 0, sessions: runner, devBridge: true });
  t.after(() => live.close());
  live.select(A);
  listed = [];
  await live.refreshOwned();
  assert.equal(live.state().note, 'alpha ended: open the menu for New session');
  const n = live.gestures().length;
  await fetch(`${live.url}/dev/key`, { method: 'POST', body: JSON.stringify({ code: 'F13', type: 'down' }) });
  await fetch(`${live.url}/dev/key`, { method: 'POST', body: JSON.stringify({ code: 'F13', type: 'up' }) });
  for (let i = 0; i < 100 && live.gestures().length === n; i++) await sleep(10);
  await sleep(100);
  assert.equal(live.state().note, null);
});
