// QA r6b-01 (push-to-talk note ends with STARTING), r6b-02 (key-on Claude that exits says so), r6b-03, r6b-07.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, reduceBoard, boardView } from '../../src/state/index.js';
import { createActions } from '../../src/sessions/index.js';
import { startLiveServer, bootSessions } from '../../src/server/index.js';

const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const A = '11111111-1111-4111-8111-111111111111';
const fold = (b, ...events) => events.reduce((x, e) => reduceBoard(x, e), b);
const PTT = 'Claude is still starting: push-to-talk not sent';

test('r6b-01: LaunchExpired clears the push-to-talk refusal note: UNKNOWN says "No events from this session yet"', () => {
  let b = fold(initialBoard(), ev('RevviewOwned', { ids: [A] }), ev('RevviewSelect', { session_id: A }), ev('RevviewLaunching', { session_id: A }), ev('RevviewNote', { note: PTT }));
  assert.equal(boardView(b).note, PTT);
  b = reduceBoard(b, ev('RevviewLaunchExpired', { session_id: A }));
  assert.equal(boardView(b).view, 'unknown');
  assert.equal(boardView(b).note, 'No events from this session yet');
});

test('r6b-01: the first hook clears it too; another note is not touched by LaunchExpired', () => {
  let b = fold(initialBoard(), ev('RevviewOwned', { ids: [A] }), ev('RevviewSelect', { session_id: A }), ev('RevviewLaunching', { session_id: A }), ev('RevviewNote', { note: PTT }));
  assert.equal(reduceBoard(b, ev('UserPromptSubmit', { session_id: A, cwd: '/w/a' })).note, null);
  b = fold(b, ev('RevviewNote', { note: 'Too early: press again' }), ev('RevviewLaunchExpired', { session_id: A }));
  assert.equal(b.note, 'Too early: press again');
});

test('r6b-02: the only (quiet, selected) session vanishing from the owned list says "<repo> ended"', () => {
  let b = fold(initialBoard(), ev('RevviewOwned', { ids: [A], names: ['alpha'] }), ev('RevviewSelect', { session_id: A }), ev('RevviewLaunching', { session_id: A }));
  b = reduceBoard(b, ev('RevviewOwned', { ids: [], names: [] }));
  assert.equal(boardView(b).note, 'alpha ended: open the menu for New session'); // r7-01: the last session
});

test('r6b-02: the boot path logs the window that disappeared and says Claude exited at once', async (t) => {
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.join(' '));
  t.after(() => { console.error = orig; });
  let listed = [];
  const runner = { list: async () => listed, start: async () => { listed = [{ id: A, window: '@0', cwd: '/x', name: 'alpha' }]; return { id: A, window: '@0', cwd: '/x' }; } };
  const live = await startLiveServer({ port: 0, boot: true, sessions: runner });
  t.after(() => live.close());
  await bootSessions({ runner, live, dirs: ['/x'], log: (m) => logs.push(m) });
  listed = [];
  await live.refreshOwned();
  assert.ok(logs.some((l) => l.includes(A) && l.includes('alpha') && /disappeared/.test(l)), logs.join('\n'));
  assert.equal(live.state().note, 'Key-on session ended at once: see the server log'); // r7-01: key-on, still STARTING
  const failing = { list: async () => [], start: async () => { throw new Error('Command failed: tmux set-option\nno server running on /tmp/revview'); } };
  const l2 = [];
  await bootSessions({ runner: failing, live, dirs: ['/x'], log: (m) => l2.push(m) });
  assert.ok(l2.some((l) => /Claude exited at once/.test(l)), l2.join('\n'));
});

test('r6b-03: New session refused for the data lock says what to do on the bar', async () => {
  let b = fold(initialBoard(), ev('RevviewProjects', { paths: ['/p/a'] }), ev('RevviewNav', { button: 'menu', gesture: 'tap' }));
  b = fold(b, ev('RevviewNav', { button: 'press', gesture: 'tap' }));
  assert.equal(b.nav?.kind, 'new');
  const notes = [];
  const runner = { start: async () => { throw new Error('data is locked: insert the key stick'); }, list: async () => [] };
  const a = createActions({
    runner, registry: {}, projects: ['/p/a'], getBoard: () => b,
    apply: (e) => { if (e.hook_event_name === 'RevviewNote') notes.push(e.note); }, log: () => {},
  });
  const r = await a.handle({ button: 'press', gesture: 'tap', source: 'device' });
  assert.equal(r.done, false);
  assert.deepEqual(notes, ['New session not started: data locked, insert the key stick']);
});

test('r6b-07: with no session the board is UNKNOWN with voice no-session (the view drops the fixed line; emulator layout.spec)', () => {
  const b = fold(initialBoard(), ev('RevviewOwned', { ids: [] }), ev('RevviewNote', { note: 'x' }));
  assert.equal(boardView(b).voice, 'no-session');
  assert.equal(boardView(b).view, 'unknown');
});
