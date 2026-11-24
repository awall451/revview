// r6 part D: a session revview just started shows STARTING (not UNKNOWN) until its first hook or the launch limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, reduceBoard, boardView } from '../../src/state/index.js';

const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const A = '11111111-1111-4111-8111-111111111111';
const fold = (b, ...events) => events.reduce((x, e) => reduceBoard(x, e), b);
const placeholder = () => fold(initialBoard(), ev('RevviewOwned', { ids: [A] }), ev('RevviewSelect', { session_id: A }));

test('without launching a quiet placeholder is UNKNOWN with the note (as before)', () => {
  const v = boardView(placeholder());
  assert.equal(v.view, 'unknown');
  assert.equal(v.note, 'No events from this session yet');
});

test('launching: STARTING, no note; overlays win; first hook shows at once; expiry falls back', () => {
  const b = reduceBoard(placeholder(), ev('RevviewLaunching', { session_id: A }));
  const v = boardView(b);
  assert.equal(v.view, 'starting');
  assert.equal(v.activity, 'starting');
  assert.equal(v.note, null);
  assert.equal(boardView(reduceBoard(b, ev('RevviewDataLock', { locked: true }))).view, 'insert-key');
  assert.equal(boardView(reduceBoard(b, ev('RevviewNetwork', { online: false }))).view, 'offline');
  assert.equal(boardView(reduceBoard(b, ev('UserPromptSubmit', { session_id: A, cwd: '/w/a' }))).view, 'working');
  const e = boardView(reduceBoard(b, ev('RevviewLaunchExpired', { session_id: A })));
  assert.equal(e.view, 'unknown');
  assert.equal(e.note, 'No events from this session yet');
});

test('launching: bad ids ignored, duplicates no-op, bounded to 8 (oldest dropped), expiry of unknown id no-op', () => {
  const b = initialBoard();
  for (const id of [undefined, '', 5, 'not-a-uuid']) assert.equal(reduceBoard(b, ev('RevviewLaunching', { session_id: id })), b);
  const one = reduceBoard(b, ev('RevviewLaunching', { session_id: A }));
  assert.equal(reduceBoard(one, ev('RevviewLaunching', { session_id: A })), one);
  assert.equal(reduceBoard(one, ev('RevviewLaunchExpired', { session_id: '22222222-2222-4222-8222-222222222222' })), one);
  const ids = Array.from({ length: 10 }, (_, i) => `0000000${i}-0000-4000-8000-000000000000`);
  const many = fold(b, ...ids.map((session_id) => ev('RevviewLaunching', { session_id })));
  assert.deepEqual(many.launching, ids.slice(2));
});

test('an old board without the key still works', () => {
  const old = placeholder();
  delete old.launching;
  assert.equal(boardView(old).view, 'unknown');
  assert.equal(boardView(reduceBoard(old, ev('RevviewLaunching', { session_id: A }))).view, 'starting');
  assert.equal(reduceBoard(old, ev('RevviewLaunchExpired', { session_id: A })), old);
});
