import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialBoard, reduceBoard, boardView, reduce, initialState,
} from '../../src/state/index.js';

// QA round 3 (r3-01, r3-06, r3-04): permission details, untied prompts, offline vs permission.
const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const view = (events, b) => boardView(run(events, b));
const REV = '/home/user/src/revview';
const R3 = { session_id: 'r3', cwd: REV };
const start = [ev('SessionStart', R3), ev('UserPromptSubmit', R3)];
const BASH = { tool_name: 'Bash', tool_input: { command: 'npm test' } };
const bashDone = [
  ...start,
  ev('PreToolUse', { ...R3, tool_name: 'Bash', tool_input: { command: 'make test' }, tool_use_id: 'q0' }),
  ev('PostToolUse', { ...R3, tool_name: 'Bash', tool_input: { command: 'make test' }, tool_use_id: 'q0', tool_response: { stdout: '12 passed' } }),
];
const EDIT = { tool_name: 'Edit', tool_input: { file_path: `${REV}/src/app.py`, old_string: 'a', new_string: 'b' } };
const RD = { tool_name: 'Read', tool_input: { file_path: `${REV}/a.txt` } };

test('r3-01: an Edit request after a Bash shows the Edit only, no old command or output', () => {
  assert.equal(view(bashDone).output, '12 passed');
  const asking = [...bashDone, ev('PreToolUse', { ...R3, ...EDIT, tool_use_id: 'e1' }), ev('PermissionRequest', { ...R3, ...EDIT })];
  const v = view(asking);
  assert.equal(v.view, 'permission');
  assert.equal(v.tool, 'Edit');
  assert.equal(v.file, 'src/app.py');
  assert.equal(v.command, null);
  assert.equal(v.output, null);
  assert.deepEqual(v.outputLines, []);
  const done = view([...asking, ev('PostToolUse', { ...R3, ...EDIT, tool_use_id: 'e1' })]);
  assert.equal(done.view, 'working');
  assert.equal(done.tool, 'Edit');
  assert.equal(done.command, 'make test');
  assert.equal(done.output, '12 passed');
});

test('r3-01: WebFetch, an MCP tool and a subagent Edit request carry no stale command', () => {
  for (const tool_name of ['WebFetch', 'mcp__x__y']) {
    const input = { tool_name, tool_input: { url: 'https://x' } };
    const v = view([...bashDone, ev('PreToolUse', { ...R3, ...input, tool_use_id: 'w1' }), ev('PermissionRequest', { ...R3, ...input })]);
    assert.equal(v.view, 'permission');
    assert.equal(v.tool, tool_name === 'mcp__x__y' ? 'x: y' : tool_name); // r5-05: MCP reads "server: tool"
    assert.equal(v.command, null);
    assert.equal(v.output, null);
    assert.deepEqual(v.outputLines, []);
  }
  const sub = view([...bashDone, ev('PreToolUse', { ...R3, ...EDIT, agent_id: 'ag1', tool_use_id: 'e2' }),
    ev('PermissionRequest', { ...R3, ...EDIT, agent_id: 'ag1' })]);
  assert.equal(sub.view, 'permission');
  assert.equal(sub.tool, 'Edit');
  assert.equal(sub.command, null);
  assert.equal(sub.output, null);
});

test('r3-01: a Bash request after an earlier Bash shows the new command and no old output', () => {
  const b2 = { tool_name: 'Bash', tool_input: { command: 'make deploy' } };
  const v = view([...bashDone, ev('PreToolUse', { ...R3, ...b2, tool_use_id: 'q1' }), ev('PermissionRequest', { ...R3, ...b2 })]);
  assert.equal(v.view, 'permission');
  assert.equal(v.command, 'make deploy');
  assert.equal(v.output, null);
  assert.deepEqual(v.outputLines, []);
});

test('r3-01: reduce alone shows no stale output under permission; the board keeps the state unchanged', () => {
  const s = run(bashDone).sessions.r3.state;
  const p = reduce(s, ev('PermissionRequest', { ...R3, ...EDIT }));
  assert.equal(p.activity, 'permission');
  assert.equal(p.command, null);
  assert.equal(p.output, null);
  assert.deepEqual(p.outputLines, []);
  const bash = reduce(s, ev('PermissionRequest', { ...R3, ...BASH }));
  assert.equal(bash.command, 'npm test');
  assert.equal(bash.output, null);
  assert.equal(reduce(initialState(), ev('PermissionRequest', { tool_name: 'Bash', tool_input: {} })).command, null);
  const edit = reduceBoard(run(bashDone), ev('PermissionRequest', { ...R3, ...EDIT }));
  assert.equal(edit.sessions.r3.state.activity, 'working');
  assert.equal(edit.sessions.r3.state.command, 'make test');
});

test('r3-01: the generic permission_prompt entry describes the open call only', () => {
  const note = ev('Notification', { ...R3, notification_type: 'permission_prompt' });
  let v = view([...bashDone, ev('PreToolUse', { ...R3, ...EDIT, tool_use_id: 'e1' }), note]);
  assert.equal(v.view, 'permission');
  assert.equal(v.tool, 'Edit');
  assert.equal(v.file, 'src/app.py');
  assert.equal(v.command, null);
  assert.equal(v.output, null);
  assert.deepEqual(v.outputLines, []);
  v = view([...bashDone, ev('PreToolUse', { ...R3, tool_name: 'Bash', tool_input: { command: 'make deploy' }, tool_use_id: 'q1' }), note]);
  assert.equal(v.tool, 'Bash');
  assert.equal(v.command, 'make deploy');
  assert.equal(v.output, null);
  assert.deepEqual(v.outputLines, []);
  v = view([...bashDone, note]);
  assert.equal(v.view, 'permission');
  assert.equal(v.tool, null);
  assert.equal(v.file, null);
  assert.equal(v.command, null);
  assert.equal(v.output, null);
  assert.deepEqual(v.outputLines, []);
});

test('r3-06: a request that arrives after its Post is cleared by the next tool event', () => {
  const q = { tool_name: 'Bash', tool_input: { command: 'make deploy' } };
  let b = run([...start, ev('PreToolUse', { ...R3, ...q, tool_use_id: 'q1' }),
    ev('PostToolUse', { ...R3, ...q, tool_use_id: 'q1', tool_response: { stdout: 'ok' } }), ev('PermissionRequest', { ...R3, ...q })]);
  assert.equal(boardView(b).view, 'permission');
  assert.equal(b.sessions.r3.pending[0].tuid, null);
  b = run([ev('PreToolUse', { ...R3, ...RD, tool_use_id: 'r1' })], b);
  assert.equal(boardView(b).view, 'working');
  assert.equal(boardView(b).tool, 'Read');
  assert.equal(boardView(b).file, 'a.txt');
  b = run([ev('PostToolUse', { ...R3, ...RD, tool_use_id: 'r1' }), ev('PreToolUse', { ...R3, ...EDIT, tool_use_id: 'e1' }),
    ev('PostToolUse', { ...R3, ...EDIT, tool_use_id: 'e1', tool_response: { structuredPatch: [{ lines: ['-a', '+b', '+c'] }] } })], b);
  assert.equal(boardView(b).view, 'working');
  assert.deepEqual(boardView(b).diff, { added: 2, removed: 1 });
  for (const name of ['PostToolUse', 'PostToolUseFailure', 'PermissionDenied']) {
    const c = run([...start, ev('PermissionRequest', { ...R3, ...q }), ev(name, { ...R3, tool_name: 'Read', tool_use_id: 'zz' })]);
    assert.equal(boardView(c).view, 'working', name);
  }
});

test('r3-06: a tied main-thread entry survives a subagent; an untied subagent entry survives main-thread and sibling events', () => {
  const tied = run([...start, ev('PreToolUse', { ...R3, ...BASH, tool_use_id: 't1' }), ev('PermissionRequest', { ...R3, ...BASH })]);
  assert.equal(tied.sessions.r3.pending[0].tuid, 't1');
  let b = run([ev('PreToolUse', { ...R3, ...RD, agent_id: 'ag1', tool_use_id: 'r1' }), ev('PostToolUse', { ...R3, ...RD, agent_id: 'ag1', tool_use_id: 'r1' })], tied);
  assert.equal(boardView(b).view, 'permission');
  // a tied entry may be one of several parallel calls: another call of its own agent does not clear it
  b = run([ev('PreToolUse', { ...R3, ...RD, tool_use_id: 'r2' }), ev('PostToolUse', { ...R3, ...RD, tool_use_id: 'r2' })], tied);
  assert.equal(boardView(b).view, 'permission');
  const sub = run([...start, ev('PreToolUse', { ...R3, ...BASH, agent_id: 'ag1', tool_use_id: 's1' }),
    ev('PostToolUse', { ...R3, ...BASH, agent_id: 'ag1', tool_use_id: 's1' }), ev('PermissionRequest', { ...R3, ...BASH, agent_id: 'ag1' })]);
  assert.equal(sub.sessions.r3.pending[0].tuid, null);
  b = run([ev('PreToolUse', { ...R3, ...RD, tool_use_id: 'm1' }), ev('PostToolUse', { ...R3, ...RD, tool_use_id: 'm1' }),
    ev('PreToolUse', { ...R3, ...RD, agent_id: 'ag2', tool_use_id: 'x1' }), ev('PostToolUse', { ...R3, ...RD, agent_id: 'ag2', tool_use_id: 'x1' })], sub);
  assert.equal(boardView(b).view, 'permission');
  b = run([ev('PreToolUse', { ...R3, ...RD, agent_id: 'ag1', tool_use_id: 'y1' })], b);
  assert.equal(boardView(b).view, 'working');
});

test('r3-04: needing the driver outranks OFFLINE; offline stays a flag', () => {
  const asking = [...bashDone, ev('PreToolUse', { ...R3, ...EDIT, tool_use_id: 'e1' }), ev('PermissionRequest', { ...R3, ...EDIT })];
  let b = run([...asking, ev('RevviewNetwork', { online: false })]);
  assert.equal(boardView(b).view, 'permission');
  assert.equal(boardView(b).offline, true);
  b = run([ev('PostToolUse', { ...R3, ...EDIT, tool_use_id: 'e1' })], b);
  assert.equal(boardView(b).view, 'offline');
  assert.equal(boardView(b).offline, true);
  b = run([ev('PreToolUse', { ...R3, ...EDIT, tool_use_id: 'e2' }), ev('PermissionRequest', { ...R3, ...EDIT }), ev('RevviewDataLock', { locked: true })], b);
  assert.equal(boardView(b).view, 'insert-key');
  assert.equal(view([ev('SessionStart', R3), ev('RevviewNetwork', { online: false })]).view, 'offline');
  // the single-session reducer agrees
  const p = reduce(reduce(initialState(), ev('RevviewNetwork', { online: false })), ev('PermissionRequest', { ...R3, ...EDIT }));
  assert.equal(p.view, 'permission');
  assert.equal(p.offline, true);
});
