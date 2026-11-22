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
  assert.ok(b.sessions[A], 'one listing without it proves nothing');
  b = reduceBoard(b, owned(B));
  assert.equal(b.sessions[A], undefined);
  assert.equal(b.ended.includes(A), false, 'a gone window is not remembered as ended');
  const after = reduceBoard(b, ev('PostToolUse', { session_id: A, cwd: '/w/alpha', tool_name: 'Bash', tool_use_id: 't1' }));
  assert.equal(after.sessions[A] === undefined || after.sessions[A].quiet !== true, true);
});

test('owned-gone: the last one gone gives phase ended', () => {
  let b = run([owned(A), start(A, 'alpha'), ev('UserPromptSubmit', { session_id: A })]);
  b = run([owned(), owned()], b);
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
  b = run([owned(), owned()], b);
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
  assert.equal(reduceBoard(b, owned(B)).note, null, 'one listing: not ended yet');
  assert.equal(run([owned(B), owned(B)], b).note, 'alpha ended');
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

const U1 = A;
const U2 = B;
const perm = (id) => ev('PermissionRequest', { session_id: id, cwd: '/w/alpha', tool_name: 'Bash', tool_input: { command: 'rm x' } });

test('owned-gone: one transient empty listing does not end owned sessions for good', () => {
  let b = run([owned(U1, U2), start(U1, 'alpha'), start(U2, 'beta')]);
  b = run([owned(), owned(U1, U2)], b);
  assert.deepEqual(b.ended, []);
  b = run([ev('PreToolUse', { session_id: U1, cwd: '/w/alpha', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'x' }), perm(U1)], b);
  assert.ok(b.sessions[U1], 'the live session is still on the board');
  assert.equal(sessionOrder(b).includes(U1), true);
});

test('owned-gone: a window really gone ends after the second listing, and a flapping one never does', () => {
  let b = run([owned(U1, U2), start(U1, 'alpha'), start(U2, 'beta')]);
  b = reduceBoard(b, owned(U2));
  assert.ok(b.sessions[U1]);
  b = reduceBoard(b, owned(U2));
  assert.equal(b.sessions[U1], undefined);
  assert.ok(b.sessions[U2]);
  let f = run([owned(U1, U2), start(U1, 'alpha'), start(U2, 'beta')]);
  for (let i = 0; i < 5; i++) f = run([owned(U2), owned(U1, U2)], f);
  assert.ok(f.sessions[U1]);
});

test('owned-gone: a session missing from ONE listing is not evicted at the cap', () => {
  const ids = Array.from({ length: 8 }, (_, i) => `${String(i + 1).repeat(8)}-1111-4111-8111-111111111111`);
  // ids[0] is started last (most recently touched): only being treated as owned keeps it from being the victim
  let b = run([owned(...ids), ...ids.slice(1).map((id, i) => start(id, `r${i + 1}`)), start(ids[0], 'r0')]);
  assert.equal(Object.keys(b.sessions).length, 8);
  b = reduceBoard(b, owned(...ids.slice(1))); // ids[0] missing from one listing
  assert.deepEqual(b.missing, [ids[0]]);
  b = reduceBoard(b, start(C, 'gamma')); // an unowned session pushes over the cap
  assert.ok(b.sessions[ids[0]], 'the missing session survives the cap');
});

// KNOWN LIMIT (docs/agents/STATE.md "Known limits"): the late hook is not dropped. The id is not remembered in
// `ended`, so a late hook of an ended owned session puts it back on the board as a live (non-quiet) session.
test('owned-gone: KNOWN LIMIT: a late hook of an ended owned session shows it again', () => {
  let b = twoWorking();
  b = run([owned(B), owned(B)], b);
  assert.equal(b.sessions[A], undefined);
  for (const e of [
    ev('PostToolUse', { session_id: A, cwd: '/w/alpha', tool_name: 'Bash', tool_use_id: 't1' }),
    ev('UserPromptSubmit', { session_id: A, cwd: '/w/alpha' }),
  ]) {
    const after = reduceBoard(b, e);
    assert.ok(after.sessions[A], `${e.hook_event_name} brings it back`);
    assert.notEqual(after.sessions[A].quiet, true);
  }
});

test('a capacity eviction is not announced as "<repo> ended"', () => {
  const ids = Array.from({ length: 9 }, (_, i) => `${String(i + 1).repeat(8)}-1111-4111-8111-111111111111`);
  let b = run([owned(...ids.slice(0, 1)), start(ids[0], 'first'), ev('RevviewSelect', { session_id: ids[0] })]);
  for (let i = 1; i < ids.length; i++) b = run([owned(...ids.slice(0, i + 1)), start(ids[i], `r${i}`)], b);
  assert.notEqual(b.note && /ended$/.test(b.note), true);
});
