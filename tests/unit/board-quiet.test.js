import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, reduceBoard, boardView } from '../../src/state/index.js';

const A = { session_id: 'A', cwd: '/w/alpha' };
const B = { session_id: 'B', cwd: '/w/beta' };
const run = (steps, board = initialBoard()) => steps.reduce((b, [ev, at]) => reduceBoard(b, ev, at), board);
const working = () => run([
  [{ hook_event_name: 'UserPromptSubmit', ...A, prompt: 'go' }, 1000],
  [{ hook_event_name: 'PreToolUse', ...A, tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 't1' }, 2000],
]);
const quiet = { hook_event_name: 'RevviewQuiet', session_id: 'A' };

test('RevviewQuiet marks a working session quiet since its last hook event', () => {
  const b = reduceBoard(working(), quiet, 9000);
  const v = boardView(b);
  assert.equal(v.quietSince, 2000);
  assert.equal(v.since, 1000);
  assert.equal(reduceBoard(b, quiet, 9500), b); // already quiet
});

test('RevviewQuiet: unknown id, no id, not working: same board', () => {
  const b = working();
  assert.equal(reduceBoard(b, { hook_event_name: 'RevviewQuiet', session_id: 'Z' }, 9000), b);
  assert.equal(reduceBoard(b, { hook_event_name: 'RevviewQuiet' }, 9000), b);
  const w = run([[{ hook_event_name: 'Stop', ...A }, 3000]], b);
  assert.equal(reduceBoard(w, quiet, 9000), w);
});

test('RevviewQuiet without a last time uses its since field, else does nothing', () => {
  const b = run([[{ hook_event_name: 'UserPromptSubmit', ...A, prompt: 'go' }]]);
  assert.equal(reduceBoard(b, quiet), b);
  assert.equal(boardView(reduceBoard(b, { ...quiet, since: 1234 })).quietSince, 1234);
});

test('RevviewQuiet prefers its since field (the server saw a later event the board ignored) over lastAt', () => {
  assert.equal(boardView(reduceBoard(working(), { ...quiet, since: 4000 }, 9000)).quietSince, 4000);
});

test('any hook event of the session clears quiet, even an ignored one', () => {
  for (const name of ['SubagentStop', 'PostToolBatch', 'SomethingNew', 'PostToolUse']) {
    const q = reduceBoard(working(), quiet, 9000);
    const b = reduceBoard(q, { hook_event_name: name, ...A }, 10000);
    assert.equal(boardView(b).quietSince, null, name);
    assert.notEqual(b, q, name);
  }
});

test('another session event, and Revview events, do not clear it', () => {
  const q = reduceBoard(working(), quiet, 9000);
  const b = reduceBoard(q, { hook_event_name: 'UserPromptSubmit', ...B, prompt: 'x' }, 10000);
  assert.equal(b.sessions.A.quietAt, 2000);
  const n = reduceBoard(q, { hook_event_name: 'RevviewNetwork', online: false }, 10000);
  assert.equal(n.sessions.A.quietAt, 2000);
});

test('Stop clears quiet', () => {
  const q = reduceBoard(working(), quiet, 9000);
  const s = reduceBoard(q, { hook_event_name: 'Stop', ...A }, 10000);
  assert.equal(boardView(s).quietSince, null);
  assert.equal(s.sessions.A.quietAt, undefined);
});

test('nav list rows carry quiet', () => {
  let b = run([[{ hook_event_name: 'UserPromptSubmit', ...B, prompt: 'y' }, 500]], working());
  b = reduceBoard(b, quiet, 9000);
  b = reduceBoard(b, { hook_event_name: 'RevviewNav', button: 'up', gesture: 'tap' });
  const v = boardView(b);
  assert.equal(v.nav.kind, 'list');
  assert.deepEqual(v.nav.rows.map((r) => r.quiet), [true, false]);
});
