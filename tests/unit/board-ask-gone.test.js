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
