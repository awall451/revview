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
const withQuiet = (b, key, quietAt) => ({ ...b, sessions: { ...b.sessions, [key]: { ...b.sessions[key], quietAt } } });
const PERM = ev('PermissionRequest', A, { tool_name: 'Bash', tool_input: { command: 'ls' } });

test('cueClass: quiet only while working with a finite quiet mark', () => {
  const b0 = base();
  assert.equal(cueClass(b0, A), null);
  assert.equal(cueClass(withQuiet(b0, A, 1000), A), 'quiet');
  assert.equal(cueClass(withQuiet(b0, A, null), A), null);
  assert.equal(cueClass(withQuiet(b0, A, NaN), A), null);
  assert.equal(cueClass(withQuiet(b0, A, 'x'), A), null);
  assert.equal(cueClass(withQuiet(reduceBoard(b0, ev('Stop', A)), A, 1000), A), 'done');
  assert.equal(cueClass(withQuiet(reduceBoard(b0, ev('StopFailure', A, { error: 'rate_limit' })), A, 1000), A), 'failed');
  assert.equal(cueClass(withQuiet(reduceBoard(b0, PERM), A, 1000), A), 'needs');
});

test('cueFor: quiet appearing gives quiet for the selected session, other for another', () => {
  const b0 = base();
  assert.deepEqual(cueFor(b0, withQuiet(b0, A, 1000)), { cue: 'quiet', session: A });
  assert.deepEqual(cueFor(b0, withQuiet(b0, B, 1000)), { cue: 'other', session: B });
});

test('cueFor: clearing, an unchanged mark and a changed value give nothing', () => {
  const q = withQuiet(base(), A, 1000);
  assert.equal(cueFor(q, withQuiet(q, A, null)), null);
  assert.equal(cueFor(q, withQuiet(q, A, 1000)), null);
  assert.equal(cueFor(q, withQuiet(q, A, 2000)), null);
});

test('cueFor: a prompt appearing on a quiet session gives needs', () => {
  const q = withQuiet(base(), A, 1000);
  assert.deepEqual(cueFor(q, reduceBoard(q, PERM)), { cue: 'needs', session: A });
});
