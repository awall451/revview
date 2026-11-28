import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initialBoard, reduceBoard, boardView, shownPrompt } from '../../src/state/index.js';

// RevviewAskGone: a held question / plan request ended without revview answering (QA r11-02; the server's side is in
// server-permission.test.js). Built on the recorded question (fixtures/sessions/ask-question.jsonl).
const ASKQ = fs.readFileSync(new URL('../../fixtures/sessions/ask-question.jsonl', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const REQ = ASKQ.findIndex((e) => e.hook_event_name === 'PermissionRequest');
const SID = ASKQ[0].session_id;
const upToAsk = () => run(ASKQ.slice(0, REQ + 1));
const sinceOf = (b) => b.sessions[SID].pending[0].since;
const gone = (b, how, since = sinceOf(b), extra = {}) => reduceBoard(b, {
  hook_event_name: 'RevviewAskGone', session_id: SID, agent: '', since, how, ...extra,
});

test('closed: exactly that entry leaves, no note, the session is what it otherwise is', () => {
  const b = upToAsk();
  assert.equal(boardView(b).view, 'asking');
  const g = gone(b, 'closed');
  assert.notEqual(boardView(g).view, 'asking');
  assert.equal(g.note, null);
  assert.equal(shownPrompt(g), null);
});

test('timeout: the note kind left says the question is left for the terminal', () => {
  const g = gone(upToAsk(), 'timeout');
  assert.deepEqual(g.note, { kind: 'left', text: 'Question left for the terminal' });
  assert.notEqual(boardView(g).view, 'asking');
});

test('another since, a bad event, or an entry that is not an ask changes nothing', () => {
  const b = upToAsk();
  const since = sinceOf(b);
  assert.equal(gone(b, 'closed', since + 1), b);
  assert.equal(gone(b, 'nope'), b);
  assert.equal(gone(b, 'closed', 'x'), b);
  assert.equal(gone(b, 'closed', since, { agent: 'sub' }), b);
  assert.equal(gone(b, 'closed', since, { session_id: 'other' }), b);
  const perm = run([
    { hook_event_name: 'SessionStart', session_id: 's' },
    { hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'go' },
    { hook_event_name: 'PermissionRequest', session_id: 's', tool_name: 'Bash', tool_input: { command: 'ls' } },
  ]);
  const p = perm.sessions.s.pending[0];
  assert.equal(reduceBoard(perm, { hook_event_name: 'RevviewAskGone', session_id: 's', agent: '', since: p.since, how: 'timeout' }), perm);
});

test('a newer question of the session stays when an older request ends', () => {
  const b = upToAsk();
  const first = sinceOf(b);
  const input = { questions: [{ question: 'Which size?', header: 'Size', options: [{ label: 'S', description: 's' }, { label: 'L', description: 'l' }], multiSelect: false }] };
  const second = reduceBoard(b, { ...ASKQ[REQ], tool_input: input });
  assert.equal(second.sessions[SID].pending.length, 2);
  const g = gone(second, 'timeout', first);
  assert.equal(boardView(g).view, 'asking');
  assert.equal(g.note, null, 'a question is on the bar: no "left" note');
});

// ---- Esc on the picker (fixtures/answers/events-esc.jsonl): Claude's turn ends, no hook event comes ----
const workingAsk = () => upToAsk(); // the session is in a turn, asking
const stateOf = (b) => b.sessions[SID].state;

test('closed, main agent: the session waits for the driver, as after RevviewInterrupted', () => {
  const b = workingAsk();
  const g = gone(b, 'closed');
  assert.equal(stateOf(g).activity, 'waiting');
  assert.equal(boardView(g).view, 'waiting');
  assert.deepEqual([g.sessions[SID].pending, g.sessions[SID].open, g.sessions[SID].pre], [[], [], []]);
  assert.equal(stateOf(g).compacting, false);
  assert.equal(g.note, null);
  // the same board an interrupt makes
  const i = reduceBoard(b, { hook_event_name: 'RevviewInterrupted', session_id: SID });
  assert.deepEqual(stateOf(g), stateOf(i));
});

test('closed, main agent, offline or locked: the offline / insert-key view', () => {
  const off = gone(reduceBoard(upToAsk(), { hook_event_name: 'RevviewNetwork', online: false }), 'closed');
  assert.equal(boardView(off).view, 'offline');
  assert.equal(stateOf(off).activity, 'waiting');
  const lock = gone(reduceBoard(upToAsk(), { hook_event_name: 'RevviewDataLock', locked: true }), 'closed');
  assert.equal(boardView(lock).view, 'insert-key');
});

test('closed, a subagent question: only the entry is dropped, the session stays working', () => {
  const b = upToAsk();
  const input = ASKQ[REQ].tool_input;
  const sub = reduceBoard(b, { ...ASKQ[REQ], agent_id: 'sub1', tool_input: input });
  const since = sub.sessions[SID].pending.find((p) => p.agent === 'sub1').since;
  const g = reduceBoard(sub, { hook_event_name: 'RevviewAskGone', session_id: SID, agent: 'sub1', since, how: 'closed' });
  assert.equal(g.sessions[SID].pending.some((p) => p.agent === 'sub1'), false);
  assert.equal(g.sessions[SID].pending.length, 1, 'the main agent question stays');
  assert.equal(stateOf(g).activity, stateOf(sub).activity);
});

test('closed, a subagent only: still working, not waiting', () => {
  const b = run([ASKQ[0], ...ASKQ.slice(1, REQ), { ...ASKQ[REQ], agent_id: 'sub1' }]);
  const p = b.sessions[SID].pending[0];
  assert.equal(p.agent, 'sub1');
  const g = reduceBoard(b, { hook_event_name: 'RevviewAskGone', session_id: SID, agent: 'sub1', since: p.since, how: 'closed' });
  assert.equal(g.sessions[SID].pending.length, 0);
  assert.equal(stateOf(g).activity, 'working');
});

test('timeout: the session stays what it was (working), only the note', () => {
  const g = gone(upToAsk(), 'timeout');
  assert.equal(stateOf(g).activity, 'working');
});

test('a question answered (PostToolUse) before the AskGone: the AskGone is a no-op, the session stays working', () => {
  const b = upToAsk();
  const since = sinceOf(b);
  const post = ASKQ.slice(REQ + 1).find((e) => e.hook_event_name === 'PostToolUse');
  assert.ok(post, 'the recording has the PostToolUse');
  const answered = reduceBoard(b, post);
  assert.equal(answered.sessions[SID].pending.length, 0);
  assert.equal(stateOf(answered).activity, 'working');
  assert.equal(gone(answered, 'closed', since), answered);
});

test('a prompt typed in the terminal removes the question too: the AskGone is a no-op', () => {
  const b = upToAsk();
  const since = sinceOf(b);
  const typed = reduceBoard(b, { hook_event_name: 'UserPromptSubmit', session_id: SID, prompt: 'hello' });
  assert.equal(typed.sessions[SID].pending.length, 0);
  assert.equal(gone(typed, 'closed', since), typed);
});
