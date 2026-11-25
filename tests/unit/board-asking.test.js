import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  initialBoard, reduceBoard, boardView, replayView, pendingPrompts, shownPrompt,
} from '../../src/state/index.js';
import { createActions } from '../../src/sessions/index.js';

// The "asks me" state, from the real recordings (fixtures/sessions/ask-*.jsonl, plan-*.jsonl; Claude Code 2.1.331).
// Synthetic cases below change only tool_input of recorded events.
const load = (name) => fs.readFileSync(new URL(`../../fixtures/sessions/${name}.jsonl`, import.meta.url), 'utf8')
  .split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
const ASKQ = load('ask-question');
const BYPASS = load('ask-bypass');
const APPROVE = load('plan-approve');
const FEEDBACK = load('plan-feedback');

const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
// the view after event index i (inclusive)
const at = (events, i) => boardView(run(events.slice(0, i + 1)));
const idx = (events, name, extra = {}, nth = 0) => events
  .map((e, i) => [e, i]).filter(([e]) => e.hook_event_name === name && Object.entries(extra).every(([k, v]) => e[k] === v))[nth][1];
// the stored ask, without what only the view adds (who answers, the highlighted choice)
const bare = (ask) => Object.fromEntries(Object.entries(ask).filter(([k]) => k !== 'answer' && k !== 'choice'));
const NOTIF = { notification_type: 'permission_prompt' };

test('every recording event is one of the known kinds (the fixtures are what the notes say)', () => {
  const known = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Notification', 'PostToolUse', 'PostToolBatch', 'Stop', 'SubagentStop', 'SessionEnd']);
  for (const e of [...ASKQ, ...BYPASS, ...APPROVE, ...FEEDBACK]) assert.ok(known.has(e.hook_event_name), e.hook_event_name);
});

test('question: asking at the PermissionRequest and the Notification, working again at the answer', () => {
  const want = { kind: 'question', question: 'Which colour should the new file use?', options: ['Red', 'Green', 'Blue'], more: 0, multiSelect: false, questions: 1, answer: 'pick', choice: 0 };
  const pre = idx(ASKQ, 'PreToolUse', { tool_name: 'AskUserQuestion' });
  assert.equal(at(ASKQ, pre).view, 'working');
  assert.equal(at(ASKQ, pre).ask, null);
  const perm = idx(ASKQ, 'PermissionRequest');
  assert.equal(at(ASKQ, perm).view, 'asking');
  assert.equal(at(ASKQ, perm).activity, 'asking');
  assert.deepEqual(at(ASKQ, perm).ask, want);
  const v = at(ASKQ, idx(ASKQ, 'Notification', NOTIF));
  assert.equal(v.view, 'asking');
  assert.deepEqual(v.ask, want);
  const post = idx(ASKQ, 'PostToolUse', { tool_name: 'AskUserQuestion' });
  assert.equal(at(ASKQ, post).view, 'working');
  assert.equal(at(ASKQ, post).ask, null);
  // and the rest of the first turn never asks
  const states = replayView(ASKQ.slice(0, idx(ASKQ, 'UserPromptSubmit', {}, 1)));
  assert.ok(states.slice(post).every((s) => s.ask === null));
});

test('a call with two questions: the first is shown, questions is 2', () => {
  const v = at(ASKQ, idx(ASKQ, 'Notification', NOTIF, 1));
  assert.equal(v.view, 'asking');
  assert.equal(v.ask.questions, 2);
  assert.equal(v.ask.question, 'Which shell should the script use?');
  assert.deepEqual(v.ask.options, ['Bash', 'Zsh']);
  assert.equal(at(ASKQ, idx(ASKQ, 'PostToolUse', { tool_name: 'AskUserQuestion' }, 1)).view, 'working');
  assert.equal(at(ASKQ, idx(ASKQ, 'Stop', {}, 1)).view, 'done');
});

test('a question dismissed with Esc: nothing fires afterwards, so it stays asking until SessionEnd', () => {
  const n = idx(ASKQ, 'Notification', NOTIF, 2);
  assert.equal(n, ASKQ.length - 2, 'recorded fact: only SessionEnd follows the third notification');
  assert.equal(ASKQ.at(-1).hook_event_name, 'SessionEnd');
  const v = at(ASKQ, n);
  assert.equal(v.view, 'asking');
  assert.equal(v.ask.question, 'Should I delete marker.txt?');
  const end = at(ASKQ, ASKQ.length - 1);
  assert.equal(end.view, 'ended');
  assert.equal(end.ask, null);
});

test('bypassPermissions: the PermissionRequest still fires, same view', () => {
  const v = at(BYPASS, idx(BYPASS, 'PermissionRequest'));
  assert.equal(v.view, 'asking');
  assert.equal(v.ask.question, 'Which port should the server use?');
  assert.deepEqual(v.ask.options, ['8080', '3000']);
  assert.equal(at(BYPASS, idx(BYPASS, 'Notification', NOTIF)).view, 'asking');
  assert.equal(at(BYPASS, idx(BYPASS, 'PostToolUse')).view, 'working');
  assert.equal(at(BYPASS, idx(BYPASS, 'Stop')).view, 'done');
});

test('plan: asking with the recorded title and 3 steps; Esc then the next prompt clears it', () => {
  const n = idx(APPROVE, 'Notification', NOTIF);
  const v = at(APPROVE, n);
  assert.equal(v.view, 'asking');
  assert.deepEqual(v.ask, { kind: 'plan', title: 'add hello.sh and README line', steps: 3, answer: 'plan', choice: null });
  // rejected with Esc: nothing fires, the driver's next prompt follows
  assert.equal(APPROVE[n + 1].hook_event_name, 'UserPromptSubmit');
  assert.equal(at(APPROVE, n + 1).view, 'working');
  assert.equal(at(APPROVE, n + 1).ask, null);
});

test('plan approved: PostToolUse ExitPlanMode (tool_input {}) clears it', () => {
  const n = idx(APPROVE, 'Notification', NOTIF, 1);
  assert.deepEqual(at(APPROVE, n).ask, { kind: 'plan', title: 'add hello.sh', steps: 3, answer: 'plan', choice: null });
  const post = idx(APPROVE, 'PostToolUse', { tool_name: 'ExitPlanMode' });
  assert.deepEqual(APPROVE[post].tool_input, {});
  assert.equal(at(APPROVE, post).view, 'working');
  assert.equal(at(APPROVE, post).ask, null);
  assert.equal(at(APPROVE, idx(APPROVE, 'Stop')).view, 'done');
});

test('plan feedback: the plain UserPromptSubmit with the text clears it; the later Esc leaves it asking until SessionEnd', () => {
  const n = idx(FEEDBACK, 'Notification', NOTIF);
  assert.deepEqual(at(FEEDBACK, n).ask, { kind: 'plan', title: 'Add notes.txt', steps: 2, answer: 'plan', choice: null });
  assert.equal(FEEDBACK[n + 1].hook_event_name, 'UserPromptSubmit');
  assert.equal(at(FEEDBACK, n + 1).view, 'working');
  const n2 = idx(FEEDBACK, 'Notification', NOTIF, 1);
  assert.equal(n2, FEEDBACK.length - 2);
  assert.deepEqual(at(FEEDBACK, n2).ask, { kind: 'plan', title: 'Add todo.txt', steps: 2, answer: 'plan', choice: null });
  assert.equal(at(FEEDBACK, n2).view, 'asking');
  assert.equal(at(FEEDBACK, n2 + 1).view, 'ended');
});

// ---- synthetic: recorded events with only tool_input changed -------------------------------------------------

// `input === undefined` removes tool_input; PostToolUse events keep theirs
const withInput = (events, tool, input) => events.map((e) => {
  if (e.tool_name !== tool || e.hook_event_name === 'PostToolUse' || !('tool_input' in e)) return e;
  if (input === undefined) return Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'tool_input'));
  return { ...e, tool_input: input };
});
const askOnly = (events, tool, input) => {
  const ev = withInput(events, tool, input);
  return at(ev, idx(ev, 'Notification', NOTIF)).ask;
};
const q = (extra) => ({ questions: [{ question: 'Q?', header: 'H', multiSelect: false, options: [{ label: 'a', description: 'd' }], ...extra }] });

test('six options: four kept, more 2', () => {
  const options = ['a', 'b', 'c', 'd', 'e', 'f'].map((label) => ({ label, description: label }));
  const a = askOnly(ASKQ, 'AskUserQuestion', q({ options }));
  assert.deepEqual(a.options, ['a', 'b', 'c', 'd']);
  assert.equal(a.more, 2);
});

test('long question and labels are cut with an ellipsis; one line, no ANSI', () => {
  const a = askOnly(ASKQ, 'AskUserQuestion', q({ question: 'x'.repeat(500), options: [{ label: 'y'.repeat(200) }] }));
  assert.equal(Array.from(a.question).length, 200);
  assert.ok(a.question.endsWith('…'));
  assert.equal(Array.from(a.options[0]).length, 60);
  assert.ok(a.options[0].endsWith('…'));
  const b = askOnly(ASKQ, 'AskUserQuestion', q({ question: 'one\ntwo\r\n\x1b[31mred\x1b[0m\tthree', options: [{ label: 'l\n1\x1b[1mB\x1b[0m' }] }));
  assert.equal(b.question, 'one two red three');
  assert.equal(b.options[0], 'l 1B');
});

test('multiSelect is carried', () => {
  assert.equal(askOnly(ASKQ, 'AskUserQuestion', q({ multiSelect: true })).multiSelect, true);
});

test('missing or garbage tool_input still asks (question null / title null), never throws', () => {
  for (const input of [undefined, null, 'x', 7, [], {}, { questions: 'no' }, { questions: [null, 3] }, { questions: [{ options: 'x' }] }]) {
    const ev = withInput(ASKQ, 'AskUserQuestion', input);
    const v = at(ev, idx(ev, 'Notification', NOTIF));
    assert.equal(v.view, 'asking', JSON.stringify(input));
    assert.deepEqual(v.ask, { kind: 'question', question: null, options: [], more: 0, multiSelect: false, questions: 1, answer: 'terminal', choice: null }, JSON.stringify(input));
  }
  for (const input of [undefined, null, 'x', {}, { plan: 5 }, []]) {
    const ev = withInput(APPROVE, 'ExitPlanMode', input);
    const v = at(ev, idx(ev, 'Notification', NOTIF));
    assert.equal(v.view, 'asking', JSON.stringify(input));
    assert.deepEqual(v.ask, { kind: 'plan', title: null, steps: null, answer: 'plan', choice: null }, JSON.stringify(input));
  }
});

test('a plan with no headings and no numbered lines: title null, steps null; without a Steps heading all numbered lines count', () => {
  assert.deepEqual(askOnly(APPROVE, 'ExitPlanMode', { plan: 'just do it\nthen stop' }), { kind: 'plan', title: null, steps: null, answer: 'plan', choice: null });
  assert.deepEqual(askOnly(APPROVE, 'ExitPlanMode', { plan: '# Plan: T\n1. a\n2. b\n   1. nested\n' }), { kind: 'plan', title: 'T', steps: 2, answer: 'plan', choice: null });
  assert.equal(Array.from(askOnly(APPROVE, 'ExitPlanMode', { plan: `# ${'t'.repeat(300)}\n` }).title).length, 120);
});

test('a Notification alone (no PermissionRequest) still carries the ask', () => {
  for (const events of [ASKQ, APPROVE]) {
    const perm = idx(events, 'PermissionRequest');
    const dropped = events.filter((_, i) => i !== perm);
    const n = idx(dropped, 'Notification', NOTIF);
    const v = at(dropped, n);
    assert.equal(v.view, 'asking');
    assert.deepEqual(v.ask, at(events, perm).ask);
    assert.deepEqual(pendingPrompts(run(dropped.slice(0, n + 1)))[0].ask, bare(v.ask));
  }
});

test('a subagent permission prompt while the main thread asks: the bar keeps the oldest first', () => {
  const perm = idx(ASKQ, 'PermissionRequest');
  const sid = ASKQ[0].session_id;
  const sub = [
    { session_id: sid, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'sub-1', tool_input: { command: 'ls' }, agent_id: 'ag1', agent_type: 'Explore' },
    { session_id: sid, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'ag1', agent_type: 'Explore' },
  ];
  const b = run([...ASKQ.slice(0, perm + 1), ...sub]);
  const v = boardView(b);
  assert.equal(v.view, 'asking');
  assert.equal(v.ask.question, 'Which colour should the new file use?');
  const ps = pendingPrompts(b);
  assert.equal(ps.length, 2);
  assert.equal(ps[0].ask.kind, 'question');
  assert.equal(ps[1].ask, null);
  assert.equal(ps[1].tool, 'Bash');
});

test('overlays: offline keeps asking, locked shows insert-key', () => {
  const b = run(ASKQ.slice(0, idx(ASKQ, 'Notification', NOTIF) + 1));
  const off = boardView(reduceBoard(b, { hook_event_name: 'RevviewNetwork', online: false }));
  assert.equal(off.view, 'asking');
  assert.equal(off.offline, true);
  assert.ok(off.ask !== null);
  assert.equal(boardView(reduceBoard(b, { hook_event_name: 'RevviewDataLock', locked: true })).view, 'insert-key');
});

test('pendingPrompts has ask; shownPrompt is null under asking (it is only for permission)', () => {
  const b = run(ASKQ.slice(0, idx(ASKQ, 'Notification', NOTIF) + 1));
  const ps = pendingPrompts(b);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].tool, 'AskUserQuestion');
  assert.deepEqual(ps[0].ask, bare(boardView(b).ask));
  assert.equal(shownPrompt(b), null);
  // a permission prompt next to it has ask null and is still what shownPrompt gives under 'permission'
  const p = run([{ session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 't', tool_input: { command: 'ls' } },
    { session_id: 's', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } }]);
  assert.equal(shownPrompt(p).ask, null);
});

// ---- actions: a tap on press or deny does not answer a question and does not open the list -------------------

test('actions: press and deny taps under asking do not answer and do not open the list', async () => {
  const b = run(ASKQ.slice(0, idx(ASKQ, 'Notification', NOTIF) + 1));
  assert.equal(boardView(b).view, 'asking');
  const answers = [];
  const sent = [];
  const applied = [];
  const sid = ASKQ[0].session_id;
  const a = createActions({
    runner: { target: async () => ({ id: sid, window: '@1' }), send: async (k) => { sent.push(k); return { sent: true, id: sid, window: '@1' }; } },
    registry: { answer: (kind) => { answers.push(kind); return { ok: true }; } },
    getBoard: () => b, apply: (e) => applied.push(e), log: () => {}, clock: () => 0,
  });
  for (const button of ['press', 'deny']) {
    const r = await a.handle({ button, gesture: 'tap', source: 'device', dropped: false });
    assert.equal(r.done, false, button);
    assert.equal(r.reason, 'question shown', button);
  }
  assert.deepEqual(answers, []);
  assert.deepEqual(sent, []);
  assert.deepEqual(applied, []);
});
