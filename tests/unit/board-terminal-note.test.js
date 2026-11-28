// The note kind 'terminal' ("Answer in the terminal when parked", "Approve in the terminal when parked"): made by
// actions.js, hidden by the board (never by the view's text) while the bar shows an ask only the terminal answers,
// because the hint row says the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initialBoard, reduceBoard, boardView, shownAsk } from '../../src/state/index.js';

const load = (name) => fs.readFileSync(new URL(`../../fixtures/sessions/${name}.jsonl`, import.meta.url), 'utf8')
  .split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
const ASKQ = load('ask-question');
const PLAN = load('plan-approve');
const SID = ASKQ[0].session_id;
const sidOf = (events) => events.map((e) => ({ ...e, session_id: SID }));
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const select = { hook_event_name: 'RevviewSelect', session_id: SID };
const pickBoard = () => run([select], run(sidOf(ASKQ.slice(0, 4))));
const planBoard = () => run([select], run(sidOf(PLAN.slice(0, 9))));
const terminalBoard = () => {
  const twin = ASKQ[3];
  const two = { ...twin, session_id: SID, tool_input: { questions: [...twin.tool_input.questions, ...twin.tool_input.questions] } };
  return run([select], run([...sidOf(ASKQ.slice(0, 3)), two]));
};
const NOTE = 'Answer in the terminal when parked';
const post = (b, text = NOTE, kind = 'terminal') => reduceBoard(b, { hook_event_name: 'RevviewNote', note: text, kind });

test('a terminal note is kept as kind terminal, but null in the view state under a terminal ask', () => {
  const b = post(terminalBoard());
  assert.deepEqual(b.note, { kind: 'terminal', text: NOTE });
  assert.equal(shownAsk(b).answer, 'terminal');
  assert.equal(boardView(b).view, 'asking');
  assert.equal(boardView(b).note, null);
});

test('a terminal note is shown under a pick ask, a plan ask and in other views', () => {
  assert.equal(boardView(post(pickBoard())).note, NOTE);
  assert.equal(boardView(post(planBoard(), 'Approve in the terminal when parked')).note, 'Approve in the terminal when parked');
  const idle = run([{ hook_event_name: 'SessionStart', session_id: SID }, select]);
  assert.equal(boardView(post(idle)).note, NOTE);
});

test('the same text as a plain note is never hidden (the rule goes by kind)', () => {
  assert.equal(boardView(post(terminalBoard(), NOTE, 'plain')).note, NOTE);
});

test('a terminal note goes at the next gesture', () => {
  const b = post(pickBoard());
  assert.equal(reduceBoard(b, { hook_event_name: 'RevviewNav', button: 'down', gesture: 'tap' }).note, null);
});
