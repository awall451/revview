import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, reduceBoard, boardView, sessionOrder } from '../../src/state/index.js';

const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const R = { session_id: 'h1', cwd: '/w/h1' };
const EDIT = { tool_name: 'Edit', tool_input: { file_path: '/w/h1/a.py', old_string: 'a', new_string: 'b\nc\nd' } };
const bashIn = (id, cmd) => ({ ...R, tool_name: 'Bash', tool_input: { command: cmd }, tool_use_id: id });
const idle = ev('Notification', { ...R, notification_type: 'idle_prompt' });

test('WB4 follow-up: an id-less permission request is not routed to a quiet owned placeholder', () => {
  let b = run([ev('RevviewOwned', { ids: [U1] })]);
  assert.equal(b.sessions[U1].quiet, true);
  b = run([ev('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }),
    ev('Notification', { notification_type: 'permission_prompt' })], b);
  assert.deepEqual(b.sessions[U1].pending, []);
  assert.equal(b.sessions[U1].quiet, true);
  assert.equal(b.sessions[U1].state.activity, 'unknown');
  assert.deepEqual(Object.keys(b.sessions).filter((k) => k !== U1), ['']); // it lands on the anonymous session, as with no session at all
});

test('WB4 follow-up: an id-less event still goes to the one real live session next to a placeholder', () => {
  const b = run([ev('SessionStart', R), ev('RevviewOwned', { ids: [U1] }), ev('UserPromptSubmit', {})]);
  assert.equal(b.sessions.h1.state.activity, 'working');
  assert.equal(b.sessions[U1].quiet, true);
  assert.deepEqual(Object.keys(b.sessions).sort(), ['h1', U1].sort());
});

test('WB4 follow-up: a posted SessionEnd for a quiet owned placeholder does not hide it', () => {
  let b = run([ev('RevviewOwned', { ids: [U1] }), ev('SessionEnd', { session_id: U1 })]);
  assert.equal(b.sessions[U1]?.quiet, true);
  assert.equal(b.ended.includes(U1), false);
  b = run([ev('SessionStart', { session_id: U1, cwd: '/w/x' }), ev('UserPromptSubmit', { session_id: U1 })], b);
  assert.equal(b.sessions[U1].state.activity, 'working');
});

test('WB4 follow-up: a SessionEnd for an owned id is not remembered as ended; for a foreign id it is', () => {
  let b = run([ev('RevviewOwned', { ids: [U1] })]);
  b = reduceBoard(b, ev('SessionEnd', { session_id: U2 }));
  assert.equal(b.ended.includes(U2), true);
  b = run([ev('SessionStart', { session_id: U1, cwd: '/w/x' }), ev('SessionEnd', { session_id: U1 })], b);
  assert.equal(b.ended.includes(U1), false);
  b = reduceBoard(b, ev('RevviewOwned', { ids: [U1] }));
  assert.equal(b.sessions[U1].quiet, true);
  assert.deepEqual(sessionOrder(b), [U1]);
});

test('r3-07: a duplicated PostToolUse (same tool_use_id) adds nothing', () => {
  const post = ev('PostToolUse', { ...R, ...EDIT, tool_use_id: 't1', tool_response: { structuredPatch: [{ lines: ['-a', '+b', '+c', '+d'] }] } });
  const once = run([ev('SessionStart', R), ev('UserPromptSubmit', R), ev('PreToolUse', { ...R, ...EDIT, tool_use_id: 't1' }), post]);
  const twice = reduceBoard(once, post);
  assert.equal(twice, once);
  const afterStop = run([ev('Stop', R), post], once);
  assert.equal(boardView(afterStop).diffIncomplete, false);
});

test('r3-07: a reused tool_use_id after a new Pre counts again', () => {
  const post = ev('PostToolUse', { ...R, ...EDIT, tool_use_id: 't1', tool_response: { structuredPatch: [{ lines: ['-a', '+b'] }] } });
  const pre = ev('PreToolUse', { ...R, ...EDIT, tool_use_id: 't1' });
  const one = run([ev('SessionStart', R), ev('UserPromptSubmit', R), pre, post]);
  const two = run([pre, post], one);
  assert.equal(boardView(two).diff.added, 2 * boardView(one).diff.added);
});

test('r3-08: a late Post after Stop and idle_prompt keeps WAITING FOR ME', () => {
  const b = run([ev('SessionStart', R), ev('UserPromptSubmit', R), ev('PreToolUse', bashIn('t2', 'pytest')), ev('Stop', R), idle]);
  assert.equal(b.sessions.h1.state.activity, 'waiting');
  const late = reduceBoard(b, ev('PostToolUse', { ...bashIn('t2', 'pytest'), tool_response: { stdout: '3 passed' } }));
  assert.equal(late.sessions.h1.state.activity, 'waiting');
  assert.deepEqual(late.sessions.h1.open, []);
});

test('r3-08: an idle_prompt during an unanswered prompt (no Stop) still lets the Post mean working', () => {
  const b = run([ev('SessionStart', R), ev('UserPromptSubmit', R), ev('PreToolUse', bashIn('t3', 'make')), idle]);
  assert.equal(b.sessions.h1.state.activity, 'waiting');
  const post = reduceBoard(b, ev('PostToolUse', bashIn('t3', 'make')));
  assert.equal(post.sessions.h1.state.activity, 'working');
});

test('r3-08: a new prompt after Stop ends the stopped turn: later Posts work again', () => {
  const b = run([ev('SessionStart', R), ev('UserPromptSubmit', R), ev('Stop', R), ev('UserPromptSubmit', R),
    ev('PreToolUse', bashIn('t4', 'ls')), idle]);
  const post = reduceBoard(b, ev('PostToolUse', bashIn('t4', 'ls')));
  assert.equal(post.sessions.h1.state.activity, 'working');
});
