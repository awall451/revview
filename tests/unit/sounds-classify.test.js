import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, reduceBoard } from '../../src/state/index.js';
import { cueClass, cueFor } from '../../src/sounds/classify.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ev = (name, session_id, extra = {}) => ({ hook_event_name: name, session_id, ...extra });
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const base = () => run([
  ev('SessionStart', A, { cwd: '/w/a' }), ev('SessionStart', B, { cwd: '/w/b' }),
  { hook_event_name: 'RevviewSelect', session_id: A },
  ev('UserPromptSubmit', A, { prompt: 'go' }), ev('UserPromptSubmit', B, { prompt: 'go' }),
]);
const PERM = ev('PermissionRequest', A, { tool_name: 'Bash', tool_input: { command: 'ls' } });
const ASK = ev('PermissionRequest', A, {
  tool_name: 'AskUserQuestion',
  tool_input: { questions: [{ question: 'Colour?', header: 'C', multiSelect: false, options: [{ label: 'Red', description: 'r' }, { label: 'Blue', description: 'b' }] }] },
});
const step = (b, e) => { const n = reduceBoard(b, e); return { prev: b, next: n, cue: cueFor(b, n) }; };

test('cueClass: permission pending, asking, failed, done', () => {
  const b0 = base();
  assert.equal(cueClass(b0, A), null);
  assert.equal(cueClass(b0, 'nope'), null);
  assert.equal(cueClass(reduceBoard(b0, PERM), A), 'needs');
  assert.equal(cueClass(reduceBoard(b0, ASK), A), 'needs');
  assert.equal(cueClass(reduceBoard(b0, ev('Notification', A, { notification_type: 'permission_prompt' })), A), 'needs');
  assert.equal(cueClass(reduceBoard(b0, ev('StopFailure', A, { error: 'rate_limit' })), A), 'failed');
  assert.equal(cueClass(reduceBoard(b0, ev('Stop', A)), A), 'done');
});

test('cueClass: Stop with subagents running, idle_prompt waiting, working: no cue', () => {
  const b0 = base();
  const running = reduceBoard(b0, ev('Stop', A, { background_tasks: [{ id: 'x', type: 'subagent', status: 'running' }] }));
  assert.equal(cueClass(running, A), null);
  const idle = reduceBoard(reduceBoard(b0, ev('Stop', A)), ev('Notification', A, { notification_type: 'idle_prompt' }));
  assert.equal(cueClass(idle, A), null);
});

test('idle_prompt after a turn that did not end in Stop: waiting is no cue', () => {
  const b = reduceBoard(base(), ev('Notification', A, { notification_type: 'idle_prompt' }));
  assert.equal(cueClass(b, A), null);
});

test('cueFor: the selected session gives needs, done, failed once each', () => {
  let r = step(base(), PERM);
  assert.deepEqual(r.cue, { cue: 'needs', session: A });
  r = step(r.next, PERM);
  assert.equal(r.cue, null);
  r = step(base(), ev('Stop', A));
  assert.deepEqual(r.cue, { cue: 'done', session: A });
  assert.equal(step(r.next, ev('Stop', A)).cue, null);
  r = step(base(), ev('StopFailure', A, { error: 'rate_limit' }));
  assert.deepEqual(r.cue, { cue: 'failed', session: A });
  assert.equal(step(r.next, ev('StopFailure', A, { error: 'rate_limit' })).cue, null);
});

test('cueFor: a question gives needs', () => {
  assert.deepEqual(step(base(), ASK).cue, { cue: 'needs', session: A });
});

test('cueFor: the state stays (a tool event during the permission, a note, selection) -> null', () => {
  const asked = reduceBoard(base(), ev('Notification', A, { notification_type: 'permission_prompt' }));
  assert.equal(step(asked, ev('Notification', A, { notification_type: 'permission_prompt' })).cue, null);
  assert.equal(step(base(), { hook_event_name: 'RevviewSelect', session_id: B }).cue, null);
  assert.equal(step(base(), { hook_event_name: 'RevviewNav', button: 'menu', gesture: 'tap' }).cue, null);
  assert.equal(cueFor(base(), base()), null);
});

test('cueFor: a change in a session that is not selected gives other', () => {
  const r = step(base(), ev('Stop', B));
  assert.deepEqual(r.cue, { cue: 'other', session: B });
  assert.deepEqual(step(base(), ev('PermissionRequest', B, { tool_name: 'Bash', tool_input: { command: 'ls' } })).cue, { cue: 'other', session: B });
});

test('cueFor: selected and other change in one step -> the selected cue wins', () => {
  const b0 = base();
  const both = run([ev('Stop', B), ev('Stop', A)], b0);
  assert.deepEqual(cueFor(b0, both), { cue: 'done', session: A });
  const both2 = run([ev('Stop', A), ev('Stop', B)], b0);
  assert.deepEqual(cueFor(b0, both2), { cue: 'done', session: A });
});

test('cueFor: compaction (PreCompact, SessionStart compact) gives nothing', () => {
  const b0 = base();
  assert.equal(step(b0, ev('PreCompact', A)).cue, null);
  assert.equal(step(b0, ev('SessionStart', A, { source: 'compact', cwd: '/w/a' })).cue, null);
});

test('cueFor: without a selection the shown session counts as selected', () => {
  const b0 = run([ev('SessionStart', A, { cwd: '/w/a' }), ev('UserPromptSubmit', A, { prompt: 'go' })]);
  const r = step(b0, ev('Stop', A));
  assert.deepEqual(r.cue, { cue: 'done', session: A });
});

test('cueFor: a new session that arrives already done (missing in prev) counts as a change', () => {
  const b0 = initialBoard();
  const b1 = run([ev('SessionStart', A, { cwd: '/w/a' }), ev('Stop', A)], b0);
  assert.equal(cueFor(b0, b1)?.session, A);
});
