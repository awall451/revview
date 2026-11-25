import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initialBoard, reduceBoard, boardView, shownAsk, shownPrompt, pendingPrompts, answerOf } from '../../src/state/index.js';

// The wheel buttons answer a question: up / down move the highlighted choice (state only; the server sends the key).
const load = (name) => fs.readFileSync(new URL(`../../fixtures/sessions/${name}.jsonl`, import.meta.url), 'utf8')
  .split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
const ASKQ = load('ask-question');
const APPROVE = load('plan-approve');
const NOTIF = { notification_type: 'permission_prompt' };
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const idx = (events, name, extra = {}, nth = 0) => events
  .map((e, i) => [e, i]).filter(([e]) => e.hook_event_name === name && Object.entries(extra).every(([k, v]) => e[k] === v))[nth][1];
const upTo = (events, name, extra, nth) => run(events.slice(0, idx(events, name, extra, nth) + 1));
const tap = (b, button) => reduceBoard(b, { hook_event_name: 'RevviewNav', button, gesture: 'tap' });
const askNote = (b) => reduceBoard(b, { hook_event_name: 'RevviewNote', kind: 'ask', note: 'Not sent: the question changed' });

const single = () => upTo(ASKQ, 'Notification', NOTIF, 0); // 3 options: Red, Green, Blue
const multi = () => upTo(ASKQ, 'Notification', NOTIF, 1); // two questions
const plan = () => upTo(APPROVE, 'Notification', NOTIF, 0);
const choiceOfEntry = (b) => b.sessions[Object.keys(b.sessions)[0]].pending[0].choice;

test('answerOf: pick, plan, terminal for every case', () => {
  const q = { kind: 'question', question: 'Q?', options: ['a', 'b'], more: 0, multiSelect: false, questions: 1 };
  assert.equal(answerOf(q), 'pick');
  assert.equal(answerOf({ ...q, options: ['a'] }), 'pick');
  assert.equal(answerOf({ ...q, options: ['a', 'b', 'c', 'd'] }), 'pick');
  assert.equal(answerOf({ ...q, options: [] }), 'terminal');
  assert.equal(answerOf({ ...q, question: null }), 'terminal');
  assert.equal(answerOf({ ...q, more: 1 }), 'terminal');
  assert.equal(answerOf({ ...q, multiSelect: true }), 'terminal');
  assert.equal(answerOf({ ...q, questions: 2 }), 'terminal');
  assert.equal(answerOf({ kind: 'plan', title: 'T', steps: 2 }), 'plan');
  assert.equal(answerOf({ kind: 'plan', title: null, steps: null }), 'plan');
  for (const bad of [null, undefined, 'x', 3, [], {}, { kind: 'other' }, { ...q, options: 'ab' }, { kind: 'plan', title: 5, steps: null }]) {
    assert.equal(answerOf(bad), 'terminal', JSON.stringify(bad));
  }
});

test('view: ask carries answer and choice (0 by default); plan and terminal have choice null', () => {
  const v = boardView(single());
  assert.equal(v.view, 'asking');
  assert.equal(v.ask.answer, 'pick');
  assert.equal(v.ask.choice, 0);
  assert.equal(boardView(plan()).ask.answer, 'plan');
  assert.equal(boardView(plan()).ask.choice, null);
  assert.equal(boardView(multi()).ask.answer, 'terminal');
  assert.equal(boardView(multi()).ask.choice, null);
  assert.equal(boardView(initialBoard()).ask, null);
});

test('down, down, up move the choice; the list stays closed', () => {
  let b = tap(single(), 'down');
  assert.equal(b.nav, null);
  assert.equal(boardView(b).ask.choice, 1);
  b = tap(b, 'down');
  assert.equal(boardView(b).ask.choice, 2);
  b = tap(b, 'up');
  assert.equal(boardView(b).ask.choice, 1);
  assert.equal(b.nav, null);
  assert.equal(shownAsk(b).choice, 1);
});

test('clamped at both ends: the same board comes back', () => {
  const b0 = single();
  assert.equal(tap(b0, 'up'), b0);
  const b2 = tap(tap(b0, 'down'), 'down');
  assert.equal(tap(b2, 'down'), b2);
  assert.equal(boardView(b2).ask.choice, 2);
});

test('hold and long-hold of down do not move the choice', () => {
  const b0 = single();
  for (const gesture of ['hold', 'long-hold']) {
    const b = reduceBoard(b0, { hook_event_name: 'RevviewNav', button: 'down', gesture });
    assert.equal(boardView(b).ask.choice, 0);
  }
});

test('up / down under a plan or a multi-question call still open the list', () => {
  for (const b of [plan(), multi()]) {
    for (const button of ['up', 'down']) assert.equal(tap(b, button).nav?.kind, 'list');
  }
});

test('with the list open the choice is not moved (the list moves)', () => {
  const open = tap(tap(single(), 'down'), 'press'); // press opens the list
  assert.equal(open.nav.kind, 'list');
  const moved = tap(open, 'down');
  assert.equal(choiceOfEntry(moved), 1);
  assert.equal(shownAsk(open), null);
});

test('a new question starts at choice 0 (new entry, new since)', () => {
  const sid = ASKQ[0].session_id;
  const input = (n) => ({ questions: [{ question: `Q${n}?`, header: 'H', multiSelect: false, options: [{ label: 'a' }, { label: 'b' }] }] });
  const ask = (n) => [
    { session_id: sid, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: `t${n}`, tool_input: input(n) },
    { session_id: sid, hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: input(n) },
  ];
  let b = run([{ session_id: sid, hook_event_name: 'SessionStart', source: 'startup' }, ...ask(1)]);
  b = tap(b, 'down');
  assert.equal(boardView(b).ask.choice, 1);
  const since = shownAsk(b).since;
  b = run([{ session_id: sid, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_use_id: 't1', tool_input: {} }, ...ask(2)], b);
  assert.equal(boardView(b).ask.question, 'Q2?');
  assert.notEqual(shownAsk(b).since, since);
  assert.equal(boardView(b).ask.choice, 0);
});

test('multiSelect and no-option questions are terminal; up/down open the list', () => {
  const sid = ASKQ[0].session_id;
  const mk = (extra) => {
    const tool_input = { questions: [{ question: 'Q?', header: 'H', multiSelect: false, options: [{ label: 'a' }], ...extra }] };
    return run([
      { session_id: sid, hook_event_name: 'SessionStart', source: 'startup' },
      { session_id: sid, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 't1', tool_input },
      { session_id: sid, hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input },
    ]);
  };
  const ms = mk({ multiSelect: true });
  assert.equal(boardView(ms).ask.answer, 'terminal');
  assert.equal(tap(ms, 'down').nav?.kind, 'list');
  assert.equal(boardView(mk({ options: [] })).ask.answer, 'terminal');
  assert.equal(boardView(mk({})).ask.answer, 'pick');
});

test('shownAsk: the prompt record plus answer and choice; null when nothing asks; shownPrompt unchanged', () => {
  const b = tap(single(), 'down');
  const a = shownAsk(b);
  assert.equal(a.session, ASKQ[0].session_id);
  assert.equal(a.agent, '');
  assert.equal(a.tool, 'AskUserQuestion');
  assert.equal(a.ask.kind, 'question');
  assert.equal(a.answer, 'pick');
  assert.equal(a.choice, 1);
  assert.equal(shownPrompt(b), null);
  assert.equal(shownAsk(initialBoard()), null);
  assert.equal(shownAsk(plan()).answer, 'plan');
  assert.equal(shownAsk(plan()).choice, null);
  assert.equal(shownAsk(multi()).answer, 'terminal');
  // the stored ask is still what isAsk validates: no answer / choice in the pending list
  assert.equal(pendingPrompts(b)[0].ask.answer, undefined);
});

test('shownAsk is null while a list is open, and follows the selected session', () => {
  const b = single();
  assert.ok(shownAsk(b));
  assert.equal(shownAsk({ ...b, nav: { kind: 'list', row: 0 } }), null);
  const two = run([{ session_id: 'other-session', hook_event_name: 'SessionStart', source: 'startup' }], b);
  const right = tap(two, 'right');
  const left = tap(two, 'left');
  const shownOther = [right, left].find((x) => boardView(x).view !== 'asking');
  assert.ok(shownOther, 'one direction selects the session that does not ask');
  assert.equal(shownAsk(shownOther), null);
  assert.equal(tap(shownOther, 'down').nav?.kind, 'list');
  const shownAsking = [right, left].find((x) => boardView(x).view === 'asking');
  if (shownAsking !== undefined) assert.equal(shownAsk(shownAsking).session, ASKQ[0].session_id);
});

test('the ask note: kept while the same question shows, gone on a gesture, when it is answered, or when it changes', () => {
  const b = askNote(single());
  assert.deepEqual(b.note, { kind: 'ask', text: 'Not sent: the question changed' });
  assert.deepEqual(reduceBoard(b, { hook_event_name: 'RevviewNetwork', online: true }).note, b.note);
  assert.equal(tap(b, 'down').note, null);
  // answered in the terminal: another view shows
  const post = idx(ASKQ, 'PostToolUse', { tool_name: 'AskUserQuestion' });
  assert.equal(reduceBoard(b, ASKQ[post]).note, null);
  // a different question replaces the shown one (the recorded call's pending entry is replaced by a new one)
  const sid = ASKQ[0].session_id;
  const q2 = { questions: [{ question: 'Other?', header: 'H', multiSelect: false, options: [{ label: 'x' }] }] };
  const replaced = run([
    { session_id: sid, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_use_id: ASKQ[idx(ASKQ, 'PreToolUse', { tool_name: 'AskUserQuestion' })].tool_use_id, tool_input: {} },
    { session_id: sid, hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: q2 },
  ], b);
  assert.equal(boardView(replaced).ask.question, 'Other?');
  assert.equal(replaced.note, null);
});

test('RevviewAnswered clears one ask entry: the view is no longer asking and the note goes', () => {
  const b = askNote(single());
  const a = shownAsk(b);
  const answered = (decision) => reduceBoard(b, { hook_event_name: 'RevviewAnswered', session_id: a.session, agent: a.agent, since: a.since, decision });
  for (const decision of ['allow', 'deny']) {
    const done = answered(decision);
    assert.notEqual(boardView(done).view, 'asking');
    assert.equal(boardView(done).ask, null);
    assert.equal(shownAsk(done), null);
    assert.equal(pendingPrompts(done).length, 0);
    assert.equal(done.note, null);
  }
});
