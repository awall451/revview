import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, reduceBoard, boardView } from '../../src/state/index.js';

const A = { session_id: 'A', cwd: '/w/alpha' };
const run = (steps, board = initialBoard()) => steps.reduce((b, [ev, at]) => reduceBoard(b, ev, at), board);
const bash = { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 't1' };

test('since: set on creation, kept across tool events while working', () => {
  const b = run([
    [{ hook_event_name: 'SessionStart', ...A }, 1000],
    [{ hook_event_name: 'UserPromptSubmit', ...A, prompt: 'go' }, 2000],
    [{ hook_event_name: 'PreToolUse', ...A, ...bash }, 3000],
    [{ hook_event_name: 'PostToolUse', ...A, ...bash, tool_response: { stdout: 'x' } }, 4000],
  ]);
  assert.equal(boardView(b).view, 'working');
  assert.equal(boardView(b).since, 2000);
});

test('since: waiting at creation, then working, permission and back', () => {
  let b = run([[{ hook_event_name: 'SessionStart', ...A }, 1000]]);
  assert.equal(boardView(b).since, 1000);
  b = run([[{ hook_event_name: 'UserPromptSubmit', ...A, prompt: 'go' }, 2000], [{ hook_event_name: 'PreToolUse', ...A, ...bash }, 2500]], b);
  b = run([[{ hook_event_name: 'PermissionRequest', ...A, ...bash }, 3000]], b);
  assert.equal(boardView(b).view, 'permission');
  assert.equal(boardView(b).since, 3000);
  b = run([[{ hook_event_name: 'PostToolUse', ...A, ...bash, tool_response: { stdout: 'x' } }, 5000]], b);
  assert.equal(boardView(b).view, 'working');
  assert.equal(boardView(b).since, 5000);
});

test('since: not reset by an offline overlay, nor by a note', () => {
  let b = run([[{ hook_event_name: 'SessionStart', ...A }, 1000], [{ hook_event_name: 'UserPromptSubmit', ...A, prompt: 'go' }, 2000]]);
  b = run([[{ hook_event_name: 'RevviewNetwork', online: false }, 3000]], b);
  assert.equal(boardView(b).view, 'offline');
  assert.equal(boardView(b).since, 2000);
  b = run([[{ hook_event_name: 'RevviewNetwork', online: true }, 4000]], b);
  assert.equal(boardView(b).since, 2000);
});

test('since: a failed turn is its own class', () => {
  const b = run([
    [{ hook_event_name: 'UserPromptSubmit', ...A, prompt: 'go' }, 2000],
    [{ hook_event_name: 'StopFailure', ...A, error: 'rate_limit' }, 3000],
  ]);
  assert.equal(boardView(b).since, 3000);
});

test('without at nothing about times changes', () => {
  const b = run([[{ hook_event_name: 'SessionStart', ...A }], [{ hook_event_name: 'UserPromptSubmit', ...A, prompt: 'go' }]]);
  const v = boardView(b);
  assert.equal(v.since, null);
  assert.equal(v.quietSince, null);
  assert.equal(v.tasks, null);
  assert.equal(Object.keys(b.sessions.A).some((k) => ['since', 'quietAt', 'lastAt'].includes(k)), false);
  assert.equal(reduceBoard(b, { hook_event_name: 'SubagentStop', ...A }, -5), b);
  assert.equal(reduceBoard(b, { hook_event_name: 'SubagentStop', ...A }, NaN), b);
});

test('an event that changes nothing keeps the same board even with at', () => {
  const b = run([[{ hook_event_name: 'UserPromptSubmit', ...A, prompt: 'go' }, 2000]]);
  assert.equal(reduceBoard(b, { hook_event_name: 'RevviewNetwork', online: true }, 9000), b);
  assert.equal(reduceBoard(b, { hook_event_name: 'SubagentStop', ...A }, 9000), b);
  assert.equal(boardView(b).since, 2000);
});
