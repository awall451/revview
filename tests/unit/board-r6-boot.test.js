// QA r6-01/r6-06: RevviewBootDone ends the boot STARTING; a quiet placeholder shows STARTING while it lasts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, reduceBoard, boardView } from '../../src/state/index.js';

const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const A = '11111111-1111-4111-8111-111111111111';
const fold = (b, ...events) => events.reduce((x, e) => reduceBoard(x, e), b);
const starting = () => reduceBoard(initialBoard(), ev('RevviewStarting'));

test('BootDone: starting -> unknown (voice no-session with an empty owned list), buttons work', () => {
  let b = fold(starting(), ev('RevviewOwned', { ids: [] }));
  assert.equal(boardView(b).view, 'starting');
  b = reduceBoard(b, ev('RevviewBootDone'));
  const v = boardView(b);
  assert.equal(v.view, 'unknown');
  assert.equal(v.voice, 'no-session');
  b = reduceBoard(b, ev('RevviewNav', { button: 'menu', gesture: 'tap' }));
  assert.equal(boardView(b).nav.kind, 'menu');
});

test('BootDone: a valid note is kept; an invalid one is ignored but the phase still leaves starting', () => {
  const b = reduceBoard(starting(), ev('RevviewBootDone', { note: 'No session yet: open the menu for New session' }));
  assert.equal(boardView(b).note, 'No session yet: open the menu for New session');
  for (const note of ['', 'x'.repeat(121), 5, null]) {
    const c = reduceBoard(starting(), ev('RevviewBootDone', { note }));
    assert.equal(c.phase, 'unknown');
    assert.equal(c.note, null);
  }
});

test('BootDone outside starting is a no-op (same object, note not set)', () => {
  const b = initialBoard();
  assert.equal(reduceBoard(b, ev('RevviewBootDone', { note: 'late' })), b);
  const done = reduceBoard(starting(), ev('RevviewBootDone'));
  assert.equal(reduceBoard(done, ev('RevviewBootDone', { note: 'late' })), done);
});

test('r6-06: a quiet placeholder shows STARTING while the boot lasts, then UNKNOWN "No events yet" after BootDone', () => {
  let b = fold(starting(), ev('RevviewOwned', { ids: [A] }), ev('RevviewSelect', { session_id: A }));
  let v = boardView(b);
  assert.equal(v.view, 'starting');
  assert.notEqual(v.note, 'No events from this session yet');
  b = reduceBoard(b, ev('RevviewBootDone'));
  v = boardView(b);
  assert.equal(v.view, 'unknown');
  assert.equal(v.note, 'No events from this session yet');
});

test('r6-06: overlays still apply over the starting placeholder; a real hook event shows at once', () => {
  const b = fold(starting(), ev('RevviewOwned', { ids: [A] }), ev('RevviewSelect', { session_id: A }));
  assert.equal(boardView(reduceBoard(b, ev('RevviewDataLock', { locked: true }))).view, 'insert-key');
  assert.equal(boardView(reduceBoard(b, ev('RevviewNetwork', { online: false }))).view, 'offline');
  const w = reduceBoard(b, ev('UserPromptSubmit', { session_id: A, cwd: '/w/a' }));
  assert.equal(boardView(w).view, 'working');
});
