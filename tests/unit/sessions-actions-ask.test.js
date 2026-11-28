// Answering under CLAUDE ASKS with the wheel buttons (actions.js: answerAsk, approvePlan). Fakes only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createActions } from '../../src/sessions/index.js';
import { initialBoard, reduceBoard, shownAsk, boardView } from '../../src/state/index.js';

const load = (name) => fs.readFileSync(new URL(`../../fixtures/sessions/${name}.jsonl`, import.meta.url), 'utf8')
  .split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
const ASKQ = load('ask-question');
const PLAN = load('plan-approve');
const SID = ASKQ[0].session_id;
const PLAN_PANE = fs.readFileSync(new URL('../../fixtures/answers/pane-10-plan.txt', import.meta.url), 'utf8').split('\n');
const sidOf = (events) => events.map((e) => ({ ...e, session_id: SID }));
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const select = { hook_event_name: 'RevviewSelect', session_id: SID };
const askBoard = () => run([select], run(sidOf(ASKQ.slice(0, 4))));
const planBoard = () => run([select], run(sidOf(PLAN.slice(0, 9))));
const nav = (button) => ({ hook_event_name: 'RevviewNav', button, gesture: 'tap' });
const dev = (button, gesture = 'tap') => ({ button, gesture, source: 'device', dropped: false });
const optionsOf = (b) => shownAsk(b).ask.options;

function setup({ board = askBoard(), target = { id: SID, window: '@1' }, answerResult = { ok: true }, checkResult = { ok: true },
  capture = { ok: true, lines: PLAN_PANE }, sendResult = { sent: true } } = {}) {
  const st = { board, sent: [], applied: [], answers: [], checks: [], captures: 0, logs: [] };
  const runner = {
    target: async () => (typeof target === 'function' ? target(st) : target),
    send: async (k) => { st.sent.push(k); return sendResult; },
    capture: async () => {
      st.captures += 1;
      return typeof capture === 'function' ? capture(st) : capture;
    },
  };
  const registry = {
    answer: (kind, shown, chosen, opts) => { st.answers.push({ kind, shown, chosen, opts }); return answerResult; },
    check: (shown, chosen) => { st.checks.push({ shown, chosen }); return typeof checkResult === 'function' ? checkResult(st) : checkResult; },
  };
  st.a = createActions({
    runner, registry, getBoard: () => st.board, apply: (e) => { st.applied.push(e); st.board = reduceBoard(st.board, e); }, log: (m) => st.logs.push(m),
  });
  st.go = (e) => { st.board = reduceBoard(st.board, e); };
  st.noteOf = () => st.board.note;
  return st;
}

test('the fixtures give a pick and a plan ask', () => {
  assert.equal(boardView(askBoard()).view, 'asking');
  assert.equal(shownAsk(askBoard()).answer, 'pick');
  assert.equal(shownAsk(planBoard()).answer, 'plan');
  assert.equal(optionsOf(askBoard()).length, 3);
});

test('pick: down, down, allow answers the registry with choice 2 and the bar label; RevviewAnswered applied', async () => {
  const s = setup();
  await s.a.handle(dev('down'));
  await s.a.handle(dev('down'));
  assert.equal(shownAsk(s.board).choice, 2);
  const r = await s.a.handle(dev('press'));
  assert.deepEqual([r.action, r.done], ['allow', true]);
  assert.equal(s.answers.length, 1);
  assert.equal(s.answers[0].kind, 'allow');
  assert.equal(s.answers[0].chosen, SID);
  assert.deepEqual(s.answers[0].opts, { choice: 2, label: optionsOf(askBoard())[2] });
  const sh = s.answers[0].shown;
  assert.ok(s.applied.some((e) => e.hook_event_name === 'RevviewAnswered' && e.decision === 'allow' && e.since === sh.since && e.agent === sh.agent && e.session_id === SID));
  assert.deepEqual(s.sent, []);
});

test('pick: deny answers deny without a choice; no key', async () => {
  const s = setup();
  const r = await s.a.handle(dev('deny'));
  assert.equal(r.done, true);
  assert.deepEqual([s.answers[0].kind, s.answers[0].opts], ['deny', {}]);
  assert.ok(s.applied.some((e) => e.hook_event_name === 'RevviewAnswered' && e.decision === 'deny'));
  assert.deepEqual(s.sent, []);
});

test('a question that only the terminal answers: note, no registry call, no key', async () => {
  // a second question in the call: the bar cannot answer it
  const twin = ASKQ[3];
  const two = { ...twin, session_id: SID, tool_input: { questions: [...twin.tool_input.questions, ...twin.tool_input.questions] } };
  const b = run([select], run([...sidOf(ASKQ.slice(0, 3)), two]));
  assert.equal(shownAsk(b).answer, 'terminal');
  const s = setup({ board: b });
  const r = await s.a.handle(dev('press'));
  assert.deepEqual([r.action, r.done, r.reason], ['allow', false, 'answer in terminal']);
  assert.equal(s.noteOf().text, 'Answer in the terminal when parked');
  assert.equal(s.noteOf().kind, 'terminal');
  assert.deepEqual([s.answers, s.sent], [[], []]);
});

test('refusals by registry reason, each with its note', async () => {
  const table = [
    ['too-early', 'Too early: press again', 'too-early'],
    ['not-shown-long-enough', 'Not sent: the question changed', 'ask'],
    ['label-changed', 'Not sent: the question changed', 'ask'],
    ['no-request', 'Not sent: the question is not waiting any more', 'ask'],
    ['unbound', 'Answer in the terminal when parked', 'terminal'],
    ['ambiguous', 'Answer in the terminal when parked', 'terminal'],
    ['no-input', 'Answer in the terminal when parked', 'terminal'],
    ['not-one-question', 'Answer in the terminal when parked', 'terminal'],
    ['multi-select', 'Answer in the terminal when parked', 'terminal'],
    ['choice', 'Answer in the terminal when parked', 'terminal'],
    ['needs-choice', 'Answer in the terminal when parked', 'terminal'],
    ['session', 'Answer in the terminal when parked', 'terminal'],
  ];
  for (const [reason, text, kind] of table) {
    const s = setup({ answerResult: { ok: false, reason } });
    const r = await s.a.handle(dev('press'));
    assert.deepEqual([r.done, r.reason], [false, reason], reason);
    assert.deepEqual([s.noteOf().text, s.noteOf().kind], [text, kind], reason);
    assert.equal(s.applied.some((e) => e.hook_event_name === 'RevviewAnswered'), false);
    assert.deepEqual(s.sent, []);
  }
});

const CHANGED = 'Not sent: the question changed';

test('the question changed between dispatch and the target answer: refused, registry not asked', async () => {
  const s = setup({
    target: (st) => {
      for (const i of [5, 12, 13, 14]) st.go({ ...ASKQ[i], session_id: SID }); // answered in the terminal, a new question
      return { id: SID, window: '@1' };
    },
  });
  const r = await s.a.handle(dev('press'));
  assert.equal(r.done, false);
  assert.equal(s.noteOf().text, CHANGED);
  assert.deepEqual([s.answers, s.sent], [[], []]);
});

test('the choice moved meanwhile: refused', async () => {
  const s = setup({ target: (st) => { st.go(nav('down')); return { id: SID, window: '@1' }; } });
  const r = await s.a.handle(dev('press'));
  assert.equal(r.done, false);
  assert.equal(s.noteOf().text, CHANGED);
  assert.deepEqual(s.answers, []);
});

test('selection changed or a list opened meanwhile: refused', async () => {
  const other = '11111111-2222-4333-8444-555555555555';
  const s1 = setup({
    target: (st) => {
      st.go({ hook_event_name: 'SessionStart', session_id: other });
      st.go({ hook_event_name: 'RevviewSelect', session_id: other });
      return { id: SID, window: '@1' };
    },
  });
  assert.equal((await s1.a.handle(dev('press'))).done, false);
  assert.deepEqual(s1.answers, []);
  const s2 = setup({ target: (st) => { st.go(nav('menu')); return { id: SID, window: '@1' }; } });
  assert.equal((await s2.a.handle(dev('press'))).done, false);
  assert.deepEqual(s2.answers, []);
});

test('not a session revview started: note, nothing answered', async () => {
  const s = setup({ target: null });
  const r = await s.a.handle(dev('press'));
  assert.equal(r.done, false);
  assert.equal(s.noteOf().text, 'Not sent: not a session revview started');
  assert.deepEqual([s.answers, s.sent], [[], []]);
  const d = await s.a.handle(dev('deny'));
  assert.equal(d.done, false);
  assert.deepEqual(s.answers, []);
});

test('push-to-talk under CLAUDE ASKS is still refused and sends nothing', async () => {
  const s = setup();
  const r = await s.a.handle(dev('push-to-talk'));
  assert.equal(r.done, false);
  assert.deepEqual([s.sent, s.answers], [[], []]);
});

test('plan: allow sends exactly "2" once after the capture shows the dialog; applies RevviewAnswered allow; registry.answer never called', async () => {
  const s = setup({ board: planBoard() });
  const r = await s.a.handle(dev('press'));
  assert.deepEqual([r.action, r.done], ['allow', true]);
  assert.deepEqual(s.sent, ['2']);
  assert.equal(s.captures, 1);
  assert.equal(s.checks.length, 2); // before the capture and again right before the key
  assert.deepEqual(s.answers, []);
  const sh = shownAsk(planBoard());
  assert.ok(s.applied.some((e) => e.hook_event_name === 'RevviewAnswered' && e.decision === 'allow' && e.since === sh.since));
});

test('plan: the dialog with the cursor on 2 is recognised too', async () => {
  const lines = PLAN_PANE.map((l) => l.replace('❯ 1.', '  1.').replace('  2. Yes, manually', '❯ 2. Yes, manually'));
  assert.ok(lines.some((l) => l.includes('❯ 2.')));
  const s = setup({ board: planBoard(), capture: { ok: true, lines } });
  assert.equal((await s.a.handle(dev('press'))).done, true);
  assert.deepEqual(s.sent, ['2']);
});

test('plan: the real 80-column pane (the question line wrapped by Claude) is recognised', async () => {
  const lines = fs.readFileSync(new URL('../../fixtures/answers/trial-7-plan.txt', import.meta.url), 'utf8').split('\n');
  assert.ok(!lines.some((l) => /Would you like to proceed\?/.test(l)));
  const s = setup({ board: planBoard(), capture: { ok: true, lines } });
  assert.equal((await s.a.handle(dev('press'))).done, true);
  assert.deepEqual(s.sent, ['2']);
});

test('plan: a capture without the recorded lines sends no key and says so', async () => {
  const gap = (lines) => lines.flatMap((l) => (/2\. Yes, manually approve edits/.test(l) ? [l, '     something else'] : [l]));
  const cases = [/1\. Yes, and use auto mode/, /2\. Yes, manually approve edits/, /3\. Tell Claude what to change/]
    .map((drop) => PLAN_PANE.filter((l) => !drop.test(l)));
  cases.push(gap(PLAN_PANE)); // the three choices, but not on consecutive lines
  cases.push(PLAN_PANE.map((l) => l.replace('2. Yes, manually approve edits', '2. Yes, approve edits'))); // another wording
  for (const lines of cases) {
    const s = setup({ board: planBoard(), capture: { ok: true, lines } });
    const r = await s.a.handle(dev('press'));
    assert.equal(r.done, false);
    assert.equal(s.noteOf().text, 'Not sent: the terminal does not show the plan');
    assert.equal(s.noteOf().kind, 'ask');
    assert.deepEqual(s.sent, []);
  }
});

test('plan: a failing capture sends no key', async () => {
  for (const capture of [{ ok: false, reason: 'capture failed' }, null, { ok: true }]) {
    const s = setup({ board: planBoard(), capture });
    assert.equal((await s.a.handle(dev('press'))).done, false);
    assert.deepEqual(s.sent, []);
    assert.equal(s.noteOf().text, 'Not sent: the terminal does not show the plan');
  }
});

test('plan: the board changed during the capture sends no key', async () => {
  const s = setup({
    board: planBoard(),
    capture: (st) => { st.go(nav('menu')); return { ok: true, lines: PLAN_PANE }; },
  });
  const r = await s.a.handle(dev('press'));
  assert.equal(r.done, false);
  assert.deepEqual(s.sent, []);
});

test('plan: a registry check refusal means no capture and no key, with the plan wording', async () => {
  const s = setup({ board: planBoard(), checkResult: { ok: false, reason: 'unbound' } });
  assert.equal((await s.a.handle(dev('press'))).done, false);
  assert.equal(s.captures, 0);
  assert.deepEqual(s.sent, []);
  assert.deepEqual([s.noteOf().text, s.noteOf().kind], ['Approve in the terminal when parked', 'terminal']);
  const t = setup({ board: planBoard(), checkResult: { ok: false, reason: 'too-early' } });
  await t.a.handle(dev('press'));
  assert.deepEqual([t.noteOf().text, t.noteOf().kind, t.captures, t.sent], ['Too early: press again', 'too-early', 0, []]);
  const u = setup({ board: planBoard(), checkResult: { ok: false, reason: 'no-request' } });
  await u.a.handle(dev('press'));
  assert.equal(u.noteOf().text, 'Not sent: the question is not waiting any more');
});

test('plan: the held request ended during the capture (Esc in the terminal fires no event) sends no key (review finding)', async () => {
  const s = setup({ board: planBoard(), checkResult: (st) => (st.checks.length === 1 ? { ok: true } : { ok: false, reason: 'no-request' }) });
  const r = await s.a.handle(dev('press'));
  assert.deepEqual([r.done, r.reason], [false, 'no-request']);
  assert.equal(s.captures, 1);
  assert.deepEqual(s.sent, []);
  assert.equal(s.noteOf().text, 'Not sent: the question is not waiting any more');
});

test('plan: a key that was not sent is refused with its reason, nothing applied', async () => {
  const s = setup({ board: planBoard(), sendResult: { sent: false, reason: 'selected session gone' } });
  const r = await s.a.handle(dev('press'));
  assert.deepEqual([r.done, r.reason], [false, 'selected session gone']);
  assert.equal(s.applied.some((e) => e.hook_event_name === 'RevviewAnswered'), false);
});

test('plan: deny answers the registry deny with plan:true; no key, no capture', async () => {
  const s = setup({ board: planBoard() });
  const r = await s.a.handle(dev('deny'));
  assert.equal(r.done, true);
  assert.deepEqual([s.answers[0].kind, s.answers[0].opts], ['deny', { plan: true }]);
  assert.deepEqual([s.sent, s.captures], [[], 0]);
});

test('no key is ever sent for a question, whatever the gesture', async () => {
  const s = setup();
  for (const b of ['press', 'deny', 'up', 'down', 'push-to-talk']) await s.a.handle(dev(b));
  assert.deepEqual(s.sent, []);
});
