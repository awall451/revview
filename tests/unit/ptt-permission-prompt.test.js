import test from 'node:test';
import assert from 'node:assert/strict';
import { createActions, PROMPT_PTT_NOTE } from '../../src/sessions/actions.js';
import { initialBoard, reduceBoard } from '../../src/state/index.js';

const SID = '7de4c978-52e0-4e1a-ad17-826801362ee2';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ev = (sid, name, extra = {}) => ({ session_id: sid, hook_event_name: name, ...extra });
const select = (sid) => ({ hook_event_name: 'RevviewSelect', session_id: sid });
const perm = (sid, extra = {}) => [
  ev(sid, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'ls' }, ...extra }),
  ev(sid, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' }, ...extra }),
];
const feed = (events, b = initialBoard()) => events.reduce(reduceBoard, b);
const base = () => feed([ev(SID, 'UserPromptSubmit', { prompt: 'x' }), ev(OTHER, 'UserPromptSubmit', { prompt: 'y' }), select(SID)]);

// a live board: apply runs the real reducer
function setup(events = []) {
  let board = feed(events, base());
  const sent = [];
  const runner = { target: async () => ({ id: SID }), send: async (k) => { sent.push(k); return { sent: true, id: SID }; } };
  const a = createActions({ runner, registry: {}, getBoard: () => board, apply: (e) => { board = reduceBoard(board, e); }, log: () => {} });
  return {
    sent,
    tap: () => a.handle({ button: 'push-to-talk', gesture: 'tap', source: 'device', dropped: false }),
    get: () => board,
    push: (e) => { board = reduceBoard(board, e); },
  };
}
const refused = { action: 'push-to-talk', done: false, reason: 'permission prompt shown' };

test('the note text', () => assert.equal(PROMPT_PTT_NOTE, 'Answer the prompt first'));

test('a pending prompt in the selected session: no key, note, refusal', async () => {
  const s = setup(perm(SID));
  assert.deepEqual(await s.tap(), refused);
  assert.deepEqual(s.sent, []);
  assert.equal(s.get().note?.text, 'Answer the prompt first');
});

test('a subagent prompt in the selected session refuses too', async () => {
  const s = setup(perm(SID, { agent_id: 'sub1' }));
  assert.ok(s.get().sessions[SID].pending.length > 0);
  assert.deepEqual(await s.tap(), refused);
  assert.deepEqual(s.sent, []);
});

test('no prompt: Space is sent as before', async () => {
  const s = setup();
  assert.deepEqual(await s.tap(), { action: 'push-to-talk', done: true });
  assert.deepEqual(s.sent, ['Space']);
});

test('a prompt only in another session does not block', async () => {
  const s = setup(perm(OTHER));
  assert.equal((await s.tap()).done, true);
  assert.deepEqual(s.sent, ['Space']);
});

test('after the prompt is answered a tap sends Space again', async () => {
  const s = setup(perm(SID));
  assert.equal((await s.tap()).done, false);
  s.push(ev(SID, 'PostToolUse', { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'ls' }, tool_response: {} }));
  assert.equal(s.get().sessions[SID].pending.length, 0);
  assert.equal((await s.tap()).done, true);
  assert.deepEqual(s.sent, ['Space']);
});

test('the note is cleared by the next gesture', async () => {
  const s = setup(perm(SID));
  await s.tap();
  assert.equal(s.get().note?.text, 'Answer the prompt first');
  s.push({ hook_event_name: 'RevviewNav', button: 'up', gesture: 'tap' });
  assert.equal(s.get().note, null);
});

test('the note goes by itself when the prompt is answered elsewhere (in the terminal)', async () => {
  const s = setup(perm(SID));
  await s.tap();
  assert.equal(s.get().note?.text, 'Answer the prompt first');
  s.push(ev(SID, 'PostToolUse', { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'ls' }, tool_response: {} }));
  assert.equal(s.get().sessions[SID].pending.length, 0);
  assert.equal(s.get().note, null);
});

test('the note stays while the prompt is pending, whatever another session does', async () => {
  const s = setup(perm(SID));
  await s.tap();
  for (const e of perm(OTHER)) s.push(e);
  s.push(ev(OTHER, 'PostToolUse', { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'ls' }, tool_response: {} }));
  s.push(ev(SID, 'Notification', { message: 'Claude needs your permission to use Bash' }));
  assert.ok(s.get().sessions[SID].pending.length > 0);
  assert.equal(s.get().note?.text, 'Answer the prompt first');
});

test('a plain note is not cleared by the selected session having no prompt', () => {
  let b = reduceBoard(base(), { hook_event_name: 'RevviewNote', note: 'Answer the prompt first' });
  b = reduceBoard(b, ev(SID, 'PreToolUse', { tool_name: 'Read', tool_use_id: 'r1', tool_input: { file_path: '/x' } }));
  assert.deepEqual(b.note, { kind: 'plain', text: 'Answer the prompt first' });
});
