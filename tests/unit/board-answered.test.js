import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, reduceBoard, boardView, pendingPrompts } from '../../src/state/index.js';

// QA r4-04: after a wheel-button answer the bar says what was answered (view.answered), not only that the prompt is gone.
const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const A = { session_id: 'A', cwd: '/w/alpha' };
const B = { session_id: 'B', cwd: '/w/beta' };
const BASH = { tool_name: 'Bash', tool_input: { command: 'npm test' } };
const asking = (S, tuid = 't1') => [
  ev('SessionStart', S), ev('UserPromptSubmit', S),
  ev('PreToolUse', { ...S, ...BASH, tool_use_id: tuid }), ev('PermissionRequest', { ...S, ...BASH, tool_use_id: tuid }),
];
const ANS = (id, p, decision) => ev('RevviewAnswered', { session_id: id, agent: p.agent, since: p.since, decision });
const answeredAfter = (decision, more = []) => {
  const b = run(asking(A));
  return run([ANS('A', pendingPrompts(b)[0], decision), ...more], b);
};

test('a deny stays through Stop: done shows the same command, answered deny', () => {
  const b = answeredAfter('deny');
  let v = boardView(b);
  assert.equal(v.view, 'working');
  assert.equal(v.answered, 'deny');
  assert.equal(v.command, 'npm test');
  assert.deepEqual(b.sessions.A.answer, { decision: 'deny', tool: 'Bash', file: null, command: 'npm test' });
  v = boardView(reduceBoard(b, ev('Stop', A)));
  assert.equal(v.view, 'done');
  assert.equal(v.answered, 'deny');
  assert.equal(v.tool, 'Bash');
  assert.equal(v.command, 'npm test');
});

test('an allow shows until the next PreToolUse', () => {
  const b = answeredAfter('allow');
  assert.equal(boardView(b).answered, 'allow');
  assert.equal(boardView(reduceBoard(b, ev('PostToolUse', { ...A, ...BASH, tool_use_id: 't1' }))).answered, 'allow');
  const next = reduceBoard(b, ev('PreToolUse', { ...A, tool_name: 'Read', tool_input: { file_path: '/w/x' }, tool_use_id: 't2' }));
  assert.equal(boardView(next).answered, null);
  assert.equal(next.sessions.A.answer, undefined);
});

test('cleared by a driver prompt, a new permission request and a restart; null without any answer', () => {
  assert.equal(boardView(answeredAfter('deny', [ev('UserPromptSubmit', A)])).answered, null);
  assert.equal(boardView(answeredAfter('deny', [ev('Stop', A), ev('UserPromptSubmit', A)])).answered, null);
  assert.equal(boardView(answeredAfter('deny', [ev('SessionStart', A)])).answered, null);
  assert.equal(boardView(answeredAfter('allow', [ev('PermissionRequest', { ...A, ...BASH })])).answered, null);
  assert.equal(boardView(run(asking(A))).answered, null);
  assert.equal(boardView(initialBoard()).answered, null);
});

test("another session's events do not touch the mark; an old session without the field is valid", () => {
  const b = answeredAfter('deny', [ev('SessionStart', B), ev('UserPromptSubmit', B)]);
  assert.equal(b.sessions.A.answer.decision, 'deny');
  assert.equal(b.sessions.B.answer, undefined);
  assert.equal('answer' in run(asking(A)).sessions.A, false);
  assert.equal(boardView(run(asking(A))).view, 'permission');
});

test('the mark lasts through a subagent PostToolUse of another tool: the bar keeps the answered call', () => {
  const edit = { tool_name: 'Edit', tool_input: { file_path: '/w/alpha/a.js' } };
  const S = A;
  let b = run([ev('SessionStart', S), ev('UserPromptSubmit', S), ev('PreToolUse', { ...S, ...edit, tool_use_id: 'e1' }), ev('PermissionRequest', { ...S, ...edit, tool_use_id: 'e1' })]);
  b = run([ANS('A', pendingPrompts(b)[0], 'allow'),
    ev('PostToolUse', { ...S, agent_id: 'sub1', tool_name: 'Read', tool_input: { file_path: '/w/alpha/b.js' }, tool_use_id: 'r1' })], b);
  const v = boardView(b);
  assert.equal(v.answered, 'allow');
  assert.equal(v.tool, 'Edit');
});

test('two pending, one answered: answered stays null while the other prompt shows', () => {
  const b = run([ev('SessionStart', A), ev('UserPromptSubmit', A),
    ev('PreToolUse', { ...A, ...BASH, tool_use_id: 't1' }), ev('PermissionRequest', { ...A, ...BASH, tool_use_id: 't1' }),
    ev('PreToolUse', { ...A, agent_id: 'sub', ...BASH, tool_use_id: 't2' }), ev('PermissionRequest', { ...A, agent_id: 'sub', ...BASH, tool_use_id: 't2' })]);
  const ps = pendingPrompts(b);
  assert.equal(ps.length, 2);
  const after = reduceBoard(b, ANS('A', ps[0], 'deny'));
  assert.equal(boardView(after).answered, null);
  assert.equal(boardView(after).view, 'permission');
});

test('failed is not shown while an answer is shown', () => {
  const b = answeredAfter('deny', [ev('StopFailure', { ...A, error: 'rate_limit', last_assistant_message: 'slow' })]);
  const v = boardView(b);
  assert.equal(v.answered, 'deny');
  assert.equal(v.failed, null);
  assert.equal(v.command, 'npm test');
});
