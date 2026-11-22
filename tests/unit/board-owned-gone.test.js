import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, reduceBoard, boardView, sessionOrder } from '../../src/state/index.js';

const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const start = (id, repo) => ev('SessionStart', { session_id: id, cwd: `/w/${repo}` });
const bash = (id) => ev('PreToolUse', { session_id: id, cwd: '/w/alpha', tool_name: 'Bash', tool_input: { command: 'sleep 9' }, tool_use_id: 't1' });
const owned = (...ids) => ev('RevviewOwned', { ids });

function twoWorking() {
  return run([owned(A, B), start(A, 'alpha'), start(B, 'beta'), ev('UserPromptSubmit', { session_id: A }), bash(A)]);
}

test('owned-gone: a listed window stays however silent (no timer)', () => {
  let b = twoWorking();
  for (let i = 0; i < 10; i++) b = run([owned(A, B), ev('RevviewNetwork', { online: true })], b);
  assert.deepEqual(sessionOrder(b).sort(), [A, B].sort());
  assert.equal(b.sessions[A].state.activity, 'working');
});

test('owned-gone: a window missing from the list ends its session; a late hook of it is dropped', () => {
  let b = twoWorking();
  b = reduceBoard(b, owned(B));
  assert.equal(b.sessions[A], undefined);
  assert.equal(b.ended.includes(A), true);
  const after = reduceBoard(b, ev('PostToolUse', { session_id: A, cwd: '/w/alpha', tool_name: 'Bash', tool_use_id: 't1' }));
  assert.deepEqual(after, b);
});

test('owned-gone: the last one gone gives phase ended', () => {
  let b = run([owned(A), start(A, 'alpha'), ev('UserPromptSubmit', { session_id: A })]);
  b = reduceBoard(b, owned());
  assert.equal(b.phase, 'ended');
  assert.deepEqual(sessionOrder(b), []);
});

test('owned-gone: the first list (owned null) ends nothing; a never-owned session survives', () => {
  let b = run([start(C, 'gamma'), start(A, 'alpha')]);
  assert.equal(b.owned, null);
  b = reduceBoard(b, owned(B));
  assert.ok(b.sessions[A] && b.sessions[C], 'sessions the runner never listed stay');
  b = reduceBoard(b, owned());
  assert.ok(b.sessions[A] && b.sessions[C]);
  assert.equal(b.ended.length, 0);
});

test('owned-gone: an unowned session survives next to a gone owned one', () => {
  let b = run([owned(A), start(A, 'alpha'), start(C, 'gamma')]);
  b = reduceBoard(b, owned());
  assert.equal(b.sessions[A], undefined);
  assert.ok(b.sessions[C]);
  assert.notEqual(b.phase, 'ended');
});

test('owned-gone: a posted SessionEnd for a live owned id comes back as a placeholder on the next poll (core hardening design)', () => {
  let b = run([owned(A), start(A, 'alpha'), ev('UserPromptSubmit', { session_id: A }), ev('SessionEnd', { session_id: A })]);
  assert.equal(b.ended.includes(A), false);
  b = reduceBoard(b, owned(A));
  assert.equal(b.sessions[A].quiet, true);
  b = run([ev('UserPromptSubmit', { session_id: A, cwd: '/w/alpha' })], b);
  assert.equal(b.sessions[A].state.activity, 'working');
  assert.notEqual(b.sessions[A].quiet, true);
});

test('r5-04: the selected session ends, others remain: note "<repo> ended"', () => {
  const b = run([owned(A, B), start(A, 'alpha'), start(B, 'beta'), ev('RevviewSelect', { session_id: A })]);
  assert.equal(b.selected, A);
  const e = reduceBoard(b, ev('SessionEnd', { session_id: A }));
  assert.equal(e.note, 'alpha ended');
  assert.equal(boardView(e).note, 'alpha ended');
  assert.equal(e.selected, B);
  assert.equal(reduceBoard(b, owned(B)).note, 'alpha ended');
  assert.equal(reduceBoard(e, ev('RevviewNav', { op: 'next' })).note, null);
});

test('r5-04: long labels are cut, a non-selected end sets no note, the last end sets none', () => {
  const b = run([owned(A, B), start(A, 'x'.repeat(150)), start(B, 'beta'), ev('RevviewSelect', { session_id: A })]);
  const e = reduceBoard(b, ev('SessionEnd', { session_id: A }));
  assert.ok(e.note.length <= 120 && e.note.endsWith(' ended'));
  assert.equal(reduceBoard(b, ev('SessionEnd', { session_id: B })).note, null);
  const one = run([start(A, 'alpha'), ev('RevviewSelect', { session_id: A }), ev('SessionEnd', { session_id: A })]);
  assert.equal(one.note, null);
});

test('r5-03: voice none: the quiet placeholder note does not hide the "no session chosen" voice', () => {
  const b = run([owned(A, B)]);
  assert.equal(boardView(b).voice, 'none');
  assert.equal(boardView(b).note, null);
  assert.equal(boardView(reduceBoard(b, ev('RevviewNote', { note: 'hello' }))).note, 'hello');
  assert.equal(boardView(reduceBoard(b, ev('RevviewSelect', { session_id: A }))).note, 'No events from this session yet');
});
