import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, reduceBoard, boardView, pendingPrompts } from '../../src/state/index.js';

// QA r5-01: the Allowed/Denied mark belongs to the answered call, whatever Bash ran earlier in the turn.
const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const A = { session_id: 'A', cwd: '/w/alpha' };
const CMD = 'git -c color.ui=always diff --stat && printf "x\\n2 passed in 0.01s\\n"';
const BASH = { tool_name: 'Bash', tool_input: { command: CMD } };
const earlier = [
  ev('SessionStart', A), ev('UserPromptSubmit', A),
  ev('PreToolUse', { ...A, ...BASH, tool_use_id: 'b1' }),
  ev('PostToolUse', { ...A, ...BASH, tool_use_id: 'b1', tool_response: { stdout: ' src/app.py | 2 +-\n2 passed in 0.01s\n' } }),
];
const ANS = (p, decision) => ev('RevviewAnswered', { session_id: 'A', agent: p.agent, since: p.since, decision });
const asked = (call) => run([
  ...earlier,
  ev('PreToolUse', { ...A, ...call, tool_use_id: 'e1' }),
  ev('PermissionRequest', { ...A, ...call, tool_use_id: 'e1' }),
]);

const CALLS = [
  ['Edit', { tool_name: 'Edit', tool_input: { file_path: '/w/alpha/src/app.py', old_string: 'a', new_string: 'b' } }, /app\.py$/],
  ['Write', { tool_name: 'Write', tool_input: { file_path: '/w/alpha/src/new.py', content: 'x' } }, /new\.py$/],
  ['WebFetch', { tool_name: 'WebFetch', tool_input: { url: 'https://example.com/a', prompt: 'p' } }, null],
  ['mcp__x__y', { tool_name: 'mcp__x__y', tool_input: { q: 1 } }, null],
  ['Task', { tool_name: 'Task', tool_input: { description: 'd', prompt: 'p', subagent_type: 'general-purpose' } }, null],
];

for (const [tool, call, fileRe] of CALLS) {
  for (const decision of ['deny', 'allow']) {
    test(`${decision} of ${tool} after an earlier Bash: marked, no old command or output`, () => {
      const b = asked(call);
      assert.equal(boardView(b).view, 'permission');
      const after = reduceBoard(b, ANS(pendingPrompts(b)[0], decision));
      const check = (v, view) => {
        assert.equal(v.view, view);
        assert.equal(v.answered, decision);
        assert.equal(v.tool, tool === 'mcp__x__y' ? 'x: y' : tool); // r5-05: MCP reads "server: tool"
        assert.equal(v.command, null);
        assert.deepEqual(v.outputLines, []);
        assert.equal(v.output, null);
        if (fileRe !== null) assert.match(v.file, fileRe);
      };
      check(boardView(after), 'working');
      check(boardView(reduceBoard(after, ev('Stop', A))), 'done');
      if (decision === 'allow') check(boardView(reduceBoard(after, ev('PostToolUse', { ...A, ...call, tool_use_id: 'e1' }))), 'working');
    });
  }
}

test('the diff counter stays through a denied Edit', () => {
  const b = asked(CALLS[0][1]);
  const before = boardView(b).diff;
  assert.deepEqual(boardView(reduceBoard(b, ANS(pendingPrompts(b)[0], 'deny'))).diff, before);
});

test('an allowed Bash after an earlier different Bash shows its own output after Post', () => {
  const next = { tool_name: 'Bash', tool_input: { command: 'npm test' } };
  const b = run([...earlier, ev('PreToolUse', { ...A, ...next, tool_use_id: 'b2' }), ev('PermissionRequest', { ...A, ...next, tool_use_id: 'b2' })]);
  const a = reduceBoard(b, ANS(pendingPrompts(b)[0], 'allow'));
  let v = boardView(a);
  assert.equal(v.answered, 'allow');
  assert.equal(v.command, 'npm test');
  assert.deepEqual(v.outputLines, []);
  v = boardView(reduceBoard(a, ev('PostToolUse', { ...A, ...next, tool_use_id: 'b2', tool_response: { stdout: 'all good\n' } })));
  assert.equal(v.answered, 'allow');
  assert.equal(v.command, 'npm test');
  assert.deepEqual(v.outputLines, ['all good']);
});

test('the answer record carries the answered call (tool, file, command, decision)', () => {
  const b = asked(CALLS[0][1]);
  const a = reduceBoard(b, ANS(pendingPrompts(b)[0], 'deny'));
  assert.equal(a.sessions.A.answer.decision, 'deny');
  assert.equal(a.sessions.A.answer.tool, 'Edit');
});

test('r5-02: OFFLINE keeps the answer in the view (answered, tool)', () => {
  const b = asked(CALLS[0][1]);
  const a = run([ANS(pendingPrompts(b)[0], 'deny'), ev('RevviewNetwork', { online: false })], b);
  const v = boardView(a);
  assert.equal(v.view, 'offline');
  assert.equal(v.answered, 'deny');
  assert.equal(v.tool, 'Edit');
});
