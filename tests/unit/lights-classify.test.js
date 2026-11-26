import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, reduceBoard } from '../../src/state/index.js';
import { lightStates, nightOf, lightsOn } from '../../src/lights/classify.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const ev = (name, session_id, extra = {}) => ({ hook_event_name: name, session_id, ...extra });
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const base = () => run([
  ev('SessionStart', A, { cwd: '/w/a' }), ev('SessionStart', B, { cwd: '/w/b' }),
  ev('UserPromptSubmit', A, { prompt: 'go' }), ev('UserPromptSubmit', B, { prompt: 'go' }),
]);
const PERM = ev('PermissionRequest', A, { tool_name: 'Bash', tool_input: { command: 'ls' } });
const ASK = ev('PermissionRequest', A, {
  tool_name: 'AskUserQuestion',
  tool_input: { questions: [{ question: 'Colour?', header: 'C', multiSelect: false, options: [{ label: 'Red', description: 'r' }, { label: 'Blue', description: 'b' }] }] },
});
const states = (b) => [...lightStates(b)].sort();

test('working, done, failed, permission, asking', () => {
  const b0 = base();
  assert.deepEqual(lightStates(b0), ['working', 'working']);
  assert.deepEqual(states(reduceBoard(b0, ev('Stop', A))), ['done', 'working']);
  assert.deepEqual(states(reduceBoard(b0, ev('StopFailure', A, { error: 'rate_limit' }))), ['failed', 'working']);
  assert.deepEqual(states(reduceBoard(b0, PERM)), ['permission', 'working']);
  assert.deepEqual(states(reduceBoard(b0, ASK)), ['asking', 'working']);
  assert.deepEqual(states(reduceBoard(b0, ev('Notification', A, { notification_type: 'permission_prompt' }))), ['permission', 'working']);
});

test('waiting after idle_prompt', () => {
  const b = run([ev('Stop', A), ev('Notification', A, { notification_type: 'idle_prompt' })], base());
  assert.ok(lightStates(b).includes('waiting'));
});

test('needs outranks failed', () => {
  // the reducer drops a prompt after a failure, so graft a real failed record onto a board with a pending prompt
  const failed = reduceBoard(base(), ev('StopFailure', A, { error: 'x' })).sessions[A].state.failed;
  assert.ok(failed);
  const p = reduceBoard(base(), PERM);
  const b = { ...p, sessions: { ...p.sessions, [A]: { ...p.sessions[A], state: { ...p.sessions[A].state, failed } } } };
  assert.deepEqual(states(b), ['permission', 'working']);
});

test('starting placeholder (revview launched it), ended session goes, new one appears', () => {
  let b = reduceBoard(base(), { hook_event_name: 'RevviewLaunching', session_id: C });
  b = reduceBoard(b, { hook_event_name: 'RevviewOwned', ids: [A, B, C] });
  assert.deepEqual(states(b), ['starting', 'working', 'working']);
  const n = lightStates(b).length;
  b = reduceBoard(b, ev('SessionEnd', B));
  assert.equal(lightStates(b).length, n - 1);
  b = reduceBoard(b, ev('SessionStart', B, { cwd: '/w/b' }));
  assert.equal(lightStates(b).length, n);
});

test('empty board, night, lights', () => {
  assert.deepEqual(lightStates(initialBoard()), []);
  assert.deepEqual(lightStates(null), []);
  const b = initialBoard();
  assert.equal(nightOf(b), false);
  assert.equal(nightOf(reduceBoard(b, { hook_event_name: 'RevviewLook', mode: 'night' })), true);
  assert.equal(nightOf(reduceBoard(reduceBoard(b, { hook_event_name: 'RevviewLook', mode: 'auto' }), { hook_event_name: 'RevviewLookClock', night: true })), true);
  assert.equal(lightsOn(b), false);
  assert.equal(lightsOn(reduceBoard(b, { hook_event_name: 'RevviewLights', mode: 'on' })), true);
  assert.equal(lightsOn(reduceBoard(b, { hook_event_name: 'RevviewLights', mode: 'off' })), false);
});
