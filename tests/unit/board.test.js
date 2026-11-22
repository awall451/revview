import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  initialBoard, reduceBoard, boardView, replayView, MAX_SESSIONS,
} from '../../src/state/index.js';

const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const view = (events, b) => boardView(run(events, b));
const A = { session_id: 'A', cwd: '/w/alpha' };
const B = { session_id: 'B', cwd: '/w/beta' };
const BASH = { tool_name: 'Bash', tool_input: { command: 'npm test' } };

test('fresh board is unknown; RevviewStarting -> starting and clears sessions; SessionStart -> waiting', () => {
  assert.equal(boardView(initialBoard()).view, 'unknown');
  assert.equal(boardView(initialBoard()).activity, 'unknown');
  const b = run([ev('SessionStart', A), ev('UserPromptSubmit', A)]);
  assert.equal(boardView(b).view, 'working');
  const s = reduceBoard(b, ev('RevviewStarting'));
  assert.equal(boardView(s).view, 'starting');
  assert.deepEqual(s.sessions, {});
  assert.equal(boardView(run([ev('SessionStart', A)])).view, 'waiting');
});

test('initialBoard shape', () => {
  assert.deepEqual(initialBoard(), {
    phase: 'unknown', offline: false, locked: false, context: { repo: null, branch: null },
    sessions: {}, ended: [], tick: 0,
  });
});

test('boardView always has exactly the same keys', () => {
  const keys = Object.keys(boardView(initialBoard())).sort();
  assert.deepEqual(keys, ['activity', 'branch', 'command', 'diff', 'diffIncomplete', 'file', 'locked', 'offline',
    'others', 'output', 'repo', 'tool', 'view']);
  const b = run([ev('SessionStart', A), ev('PreToolUse', { ...A, ...BASH })]);
  assert.deepEqual(Object.keys(boardView(b)).sort(), keys);
});

test('two sessions: permission beats waiting/working; repo does not switch', () => {
  let b = run([
    ev('SessionStart', A), ev('UserPromptSubmit', A),
    ev('PermissionRequest', { ...A, ...BASH }),
    ev('SessionStart', B), ev('Notification', { ...B, notification_type: 'idle_prompt' }),
  ]);
  let v = boardView(b);
  assert.equal(v.view, 'permission');
  assert.equal(v.command, 'npm test');
  assert.equal(v.others, 1);
  assert.equal(v.repo, 'alpha');
  b = run([ev('UserPromptSubmit', A)], b);
  b = run([ev('Stop', B)], b);
  v = boardView(b);
  assert.equal(v.view, 'working');
  assert.equal(v.repo, 'alpha');
});

test('tie on priority picks the most recently touched', () => {
  const v = view([ev('UserPromptSubmit', A), ev('UserPromptSubmit', B)]);
  assert.equal(v.repo, 'beta');
});

test('subagent events share the session and create no second one', () => {
  const b = run([ev('SessionStart', A), ev('UserPromptSubmit', A),
    ev('PreToolUse', { ...A, agent_id: 'x', agent_type: 'Explore', ...BASH }), ev('SubagentStop', { ...A, agent_id: 'x' })]);
  assert.equal(boardView(b).others, 0);
  assert.equal(Object.keys(b.sessions).length, 1);
});

test('SessionEnd: only session -> ended, repo kept; two sessions -> other shown; late events ignored; restart', () => {
  const one = run([ev('SessionStart', A), ev('UserPromptSubmit', A), ev('SessionEnd', A)]);
  let v = boardView(one);
  assert.equal(v.view, 'ended');
  assert.equal(v.repo, 'alpha');
  const late = reduceBoard(one, ev('Notification', { ...A, notification_type: 'idle_prompt' }));
  assert.equal(late, one);
  const again = reduceBoard(one, ev('SessionStart', A));
  assert.equal(boardView(again).view, 'waiting');
  assert.deepEqual(again.ended, []);

  const two = run([ev('SessionStart', A), ev('SessionStart', B), ev('UserPromptSubmit', B), ev('SessionEnd', B)]);
  v = boardView(two);
  assert.equal(v.view, 'waiting');
  assert.equal(v.repo, 'alpha');
  assert.equal(v.others, 0);
});

test('late Post after Stop keeps done, updates fields; unknown id ignored; Pre after Stop -> working', () => {
  const edit = {
    tool_name: 'Edit', tool_input: { file_path: '/w/alpha/a.js', old_string: 'a', new_string: 'b\nc' },
  };
  let b = run([ev('SessionStart', A), ev('UserPromptSubmit', A),
    ev('PreToolUse', { ...A, ...BASH, tool_use_id: 'X' }),
    ev('PreToolUse', { ...A, ...edit, tool_use_id: 'Y' }), ev('Stop', A)]);
  assert.deepEqual(b.sessions.A.open, ['X', 'Y']);
  b = reduceBoard(b, ev('PostToolUse', { ...A, ...BASH, tool_use_id: 'X', tool_response: { stdout: '2 passed' } }));
  let v = boardView(b);
  assert.equal(v.view, 'done');
  assert.equal(v.output, '2 passed');
  b = reduceBoard(b, ev('PostToolUse', { ...A, ...edit, tool_use_id: 'Y', tool_response: {} }));
  v = boardView(b);
  assert.equal(v.view, 'done');
  assert.deepEqual(v.diff, { added: 2, removed: 1 });
  assert.deepEqual(b.sessions.A.open, []);
  assert.equal(reduceBoard(b, ev('PostToolUse', { ...A, ...BASH, tool_use_id: 'Z' })), b);
  assert.equal(reduceBoard(b, ev('PermissionDenied', A)), b);
  assert.equal(boardView(reduceBoard(b, ev('PreToolUse', { ...A, ...BASH, tool_use_id: 'W' }))).view, 'working');
});

test('RevviewDropped marks the session, UserPromptSubmit resets; without id marks all', () => {
  let b = run([ev('SessionStart', A), ev('SessionStart', B), ev('RevviewDropped', A)]);
  assert.equal(b.sessions.A.dropped, true);
  assert.equal(b.sessions.B.dropped, false);
  b = reduceBoard(b, ev('UserPromptSubmit', A));
  assert.equal(b.sessions.A.dropped, false);
  b = reduceBoard(b, ev('RevviewDropped'));
  assert.ok(b.sessions.A.dropped && b.sessions.B.dropped);
  assert.equal(boardView(b).diffIncomplete, true);
  const empty = initialBoard();
  assert.equal(reduceBoard(empty, ev('RevviewDropped')), empty);
});

test('RevviewContext goes to a live session, else to the board', () => {
  let b = run([ev('SessionStart', A), ev('RevviewContext', { session_id: 'A', cwd: '/w/alpha', branch: 'dev' })]);
  assert.equal(boardView(b).branch, 'dev');
  assert.equal(b.context.branch, null);
  b = run([ev('RevviewContext', { cwd: '/x/gamma', branch: 'main' })]);
  assert.deepEqual(b.context, { repo: 'gamma', branch: 'main' });
  assert.equal(boardView(b).repo, 'gamma');
});

test('overlays', () => {
  const b = run([ev('SessionStart', A), ev('RevviewNetwork', { online: false })]);
  assert.equal(boardView(b).view, 'offline');
  assert.equal(boardView(reduceBoard(b, ev('RevviewDataLock', { locked: true }))).view, 'insert-key');
  assert.equal(reduceBoard(b, ev('RevviewNetwork', { online: 'x' })), b);
});

test('MAX_SESSIONS drops the least recently touched', () => {
  const events = [];
  for (let i = 0; i < MAX_SESSIONS; i += 1) events.push(ev('SessionStart', { session_id: `s${i}` }));
  events.push(ev('UserPromptSubmit', { session_id: 's0' }));
  events.push(ev('SessionStart', { session_id: 'new' }));
  const b = run(events);
  assert.equal(Object.keys(b.sessions).length, MAX_SESSIONS);
  assert.ok(!('s1' in b.sessions));
  assert.ok('s0' in b.sessions && 'new' in b.sessions);
});

test('__proto__ and constructor session ids are safe', () => {
  const b = run([ev('SessionStart', { session_id: '__proto__' }), ev('UserPromptSubmit', { session_id: '__proto__' }),
    ev('SessionStart', { session_id: 'constructor' })]);
  assert.equal(Object.getPrototypeOf(b.sessions), Object.prototype);
  assert.equal({}.activity, undefined);
  assert.equal(Object.keys(b.sessions).length, 2);
  assert.equal(Object.hasOwn(b.sessions, '__proto__'), true);
  assert.equal(boardView(b).others, 1);
  const e = reduceBoard(b, ev('SessionEnd', { session_id: '__proto__' }));
  assert.equal(Object.keys(e.sessions).length, 1);
  assert.equal(Object.hasOwn(e.sessions, '__proto__'), false);
});

test('events without a usable session_id use one anonymous session', () => {
  assert.equal(view([ev('SessionStart'), ev('UserPromptSubmit', { session_id: 42 })]).view, 'working');
});

test('same reference for ignored events; no session for ignored events', () => {
  const b = run([ev('SessionStart', A)]);
  for (const e of [ev('SubagentStop', B), ev('Whatever', B), ev('PreCompact', A), null, 1, [], 'x', {}, { hook_event_name: 3 }]) {
    assert.equal(reduceBoard(b, e), b);
  }
  assert.equal(Object.keys(reduceBoard(b, ev('SubagentStop', B)).sessions).length, 1);
  assert.equal(reduceBoard(b, ev('SessionStart', A)), b);
});

test('never throws on garbage', () => {
  const junk = [null, undefined, 1, 'x', [], {}, { hook_event_name: 'SessionStart', session_id: {} },
    { hook_event_name: 'PreToolUse', session_id: ['a'], tool_use_id: 5, tool_name: 'Bash', tool_input: 5 },
    { hook_event_name: 'RevviewDropped', session_id: 7 }, { hook_event_name: 'SessionEnd', session_id: null }];
  for (const j of junk) {
    assert.doesNotThrow(() => reduceBoard(initialBoard(), j));
    assert.doesNotThrow(() => reduceBoard(j, ev('SessionStart', A)));
    assert.doesNotThrow(() => boardView(j));
  }
  assert.equal(reduceBoard('bad', ev('SessionStart', A)).sessions.A.state.activity, 'waiting');
  assert.equal(boardView(null).view, 'unknown');
});

test('replayView of every recording ends in ended', () => {
  const dir = new URL('../../fixtures/sessions/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    const events = fs.readFileSync(new URL(f, dir), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    const out = replayView(events);
    assert.equal(out.length, events.length);
    assert.equal(out.at(-1).view, 'ended', f);
  }
});
