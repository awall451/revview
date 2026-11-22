import test from 'node:test';
import assert from 'node:assert/strict';
import { createActions } from '../../src/sessions/index.js';
import { initialBoard, reduceBoard } from '../../src/state/index.js';

const SID = '7de4c978-52e0-4e1a-ad17-826801362ee2';
const ev = (name, extra = {}) => ({ session_id: SID, hook_event_name: name, ...extra });

const select = { hook_event_name: 'RevviewSelect', session_id: SID };

// SID is on the board and the driver's selection (a stale 'chosen' id in the runner no longer exists)
function workingBoard() {
  return reduceBoard(reduceBoard(initialBoard(), ev('UserPromptSubmit', { prompt: 'x' })), select);
}

function permissionBoard(command = 'ls') {
  let b = workingBoard();
  for (const e of [
    ev('PreToolUse', { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command } }),
    ev('PermissionRequest', { tool_name: 'Bash', tool_input: { command } }),
  ]) b = reduceBoard(b, e);
  return b;
}

function setup({ target = { id: SID, window: '@1' }, sendResult, answerResult, board = permissionBoard() } = {}) {
  const sent = [];
  const applied = [];
  const answers = [];
  const logs = [];
  let now = 0;
  const waiters = [];
  const runner = {
    target: async () => (typeof target === 'function' ? target() : target),
    send: async (k, id) => {
      sent.push(k);
      assert.equal(id, SID, 'the key goes to the selected session id');
      if (waiters.length) await waiters.shift();
      return sendResult ?? { sent: true, id: SID, window: '@1' };
    },
  };
  const registry = {
    answer: (kind, shown, chosen) => {
      answers.push({ kind, shown, chosen });
      return answerResult ?? { ok: true };
    },
  };
  const a = createActions({
    runner, registry, getBoard: () => board, apply: (e) => applied.push(e), log: (m) => logs.push(m), clock: () => now,
  });
  return {
    a, sent, applied, answers, logs, board,
    at: (t) => { now = t; },
    gate: () => { let f; waiters.push(new Promise((r) => { f = r; })); return f; },
  };
}
const dev = (button, gesture, extra = {}) => ({ button, gesture, source: 'device', dropped: false, ...extra });

test('dropped and post-source gestures never act', async () => {
  const s = setup();
  assert.equal((await s.a.handle(dev('cancel', 'tap', { dropped: true }))).done, false);
  assert.equal((await s.a.handle(dev('cancel', 'tap', { source: 'post' }))).done, false);
  assert.equal((await s.a.handle(dev('press', 'tap', { source: 'post' }))).done, false);
  assert.equal((await s.a.handle(dev('cancel', 'tap', { source: undefined }))).done, false);
  assert.deepEqual(s.sent, []);
  assert.deepEqual(s.answers, []);
});

test('cancel tap: Escape, then RevviewInterrupted with the sent id; bridge source acts too', async () => {
  const s = setup();
  const r = await s.a.handle(dev('cancel', 'tap', { source: 'bridge' }));
  assert.equal(r.done, true);
  assert.deepEqual(s.sent, ['Escape']);
  assert.deepEqual(s.applied, [{ hook_event_name: 'RevviewInterrupted', session_id: SID }]);
});

test('not sent: nothing applied, reason reported', async () => {
  const s = setup({ sendResult: { sent: false, reason: 'no session chosen' } });
  const r = await s.a.handle(dev('cancel', 'tap'));
  assert.deepEqual(r, { action: 'cancel-escape', done: false, reason: 'no session chosen' });
  assert.deepEqual(s.applied, []);
  assert.ok(s.logs.length >= 1);
});

test('cancel hold does nothing', async () => {
  const s = setup();
  const r = await s.a.handle(dev('cancel', 'hold'));
  assert.equal(r.done, false);
  assert.deepEqual(s.sent, []);
});

test('long-hold: one Ctrl+C per 5000 ms; refused ones send nothing', async () => {
  const s = setup();
  s.at(1000);
  assert.equal((await s.a.handle(dev('cancel', 'long-hold'))).done, true);
  s.at(1000 + 4999);
  const r = await s.a.handle(dev('cancel', 'long-hold'));
  assert.deepEqual([r.done, r.reason], [false, 'ctrl-c too soon']);
  assert.deepEqual(s.sent, ['C-c']);
  assert.equal(s.applied.length, 1);
  s.at(1000 + 5000);
  assert.equal((await s.a.handle(dev('cancel', 'long-hold'))).done, true);
  assert.deepEqual(s.sent, ['C-c', 'C-c']);
  assert.equal(s.applied.length, 2);
});

test('a Ctrl+C that was not sent does not start the gap', async () => {
  const s = setup({ sendResult: { sent: false, reason: 'gone' } });
  s.at(10);
  await s.a.handle(dev('cancel', 'long-hold'));
  s.at(11);
  await s.a.handle(dev('cancel', 'long-hold'));
  assert.deepEqual(s.sent, ['C-c', 'C-c']);
});

test('push-to-talk tap sends Space; its hold does nothing', async () => {
  const s = setup();
  assert.equal((await s.a.handle(dev('push-to-talk', 'tap'))).done, true);
  assert.equal((await s.a.handle(dev('push-to-talk', 'hold'))).done, false);
  assert.deepEqual(s.sent, ['Space']);
  assert.deepEqual(s.applied, []);
});

test('press/deny pass the re-verified target id (not chosen()) and the shown prompt', async () => {
  const s = setup();
  assert.equal((await s.a.handle(dev('press', 'tap'))).done, true);
  assert.equal((await s.a.handle(dev('deny', 'tap'))).done, true);
  assert.deepEqual(s.answers.map((x) => [x.kind, x.chosen]), [['allow', SID], ['deny', SID]]);
  assert.equal(s.answers[0].shown.session, SID);
  assert.equal(s.answers[0].shown.command, 'ls');
  assert.deepEqual(s.sent, []);
});

test('an answered press/deny tells the board which exact prompt was answered; a refused one tells nothing', async () => {
  const s = setup();
  await s.a.handle(dev('press', 'tap'));
  await s.a.handle(dev('deny', 'tap'));
  const shown = s.answers[0].shown;
  assert.deepEqual(s.applied, [
    { hook_event_name: 'RevviewAnswered', session_id: SID, agent: shown.agent, since: shown.since, decision: 'allow' },
    { hook_event_name: 'RevviewAnswered', session_id: SID, agent: shown.agent, since: shown.since, decision: 'deny' },
  ]);
  // a refused press changes no answer; only the too-early refusal says so on the bar (QA r4-07, next test)
  const r = setup({ answerResult: { ok: false, reason: 'too-early' } });
  await r.a.handle(dev('press', 'tap'));
  assert.deepEqual(r.applied.filter((e) => e.hook_event_name !== 'RevviewNote'), []);
});

test('r4-07: a press or deny refused as too early sets the fixed note "Too early: press again"; other refusals stay silent', async () => {
  for (const button of ['press', 'deny']) {
    const s = setup({ answerResult: { ok: false, reason: 'too-early' } });
    const r = await s.a.handle(dev(button, 'tap'));
    assert.deepEqual([r.done, r.reason], [false, 'too-early']);
    assert.deepEqual(s.applied, [{ hook_event_name: 'RevviewNote', note: 'Too early: press again' }]);
  }
  for (const reason of ['not-shown-long-enough', 'no-prompt', 'session', 'unbound', 'no-request', 'ambiguous', 'kind']) {
    const s = setup({ answerResult: { ok: false, reason } });
    await s.a.handle(dev('press', 'tap'));
    assert.deepEqual(s.applied, [], reason);
  }
});

test('no target: the registry is not asked (no session), nothing sent', async () => {
  const s = setup({ target: null });
  const r = await s.a.handle(dev('press', 'tap'));
  assert.deepEqual([r.done, r.reason], [false, 'no session selected']);
  assert.deepEqual(s.answers, []);
});

test('press hold, read-aloud, spare: no action; up and menu are navigation (never a key or an answer)', async () => {
  const s = setup();
  for (const [b, g] of [['press', 'hold'], ['press', 'long-hold'], ['read-aloud', 'tap'], ['spare', 'tap']]) {
    const r = await s.a.handle(dev(b, g));
    assert.deepEqual([r.done, r.reason], [false, 'no action']);
  }
  for (const [b, g] of [['up', 'tap'], ['menu', 'tap']]) assert.equal((await s.a.handle(dev(b, g))).action, 'nav');
  assert.deepEqual(s.applied.map((e) => e.hook_event_name), ['RevviewNav', 'RevviewNav']);
  assert.deepEqual(s.sent, []);
  assert.deepEqual(s.answers, []);
});

test('the board is read after the target await', async () => {
  let board = permissionBoard('ls'); // a prompt is shown, so press is an allow attempt
  const answers = [];
  const a = createActions({
    runner: { target: async () => { board = permissionBoard('pwd'); return { id: SID }; }, send: async () => ({ sent: false }) },
    registry: { answer: (k, shown) => { answers.push(shown); return { ok: false, reason: 'x' }; } },
    getBoard: () => board, apply: () => {},
  });
  await a.handle(dev('press', 'tap'));
  assert.equal(answers[0]?.command, 'pwd', 'the prompt of the board as it is after the await');
});

test('gestures are serialized: a second one waits for the first', async () => {
  const s = setup();
  const release = s.gate();
  const p1 = s.a.handle(dev('push-to-talk', 'tap'));
  const p2 = s.a.handle(dev('cancel', 'tap'));
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(s.sent, ['Space'], 'second waits for the first');
  release();
  await Promise.all([p1, p2]);
  assert.deepEqual(s.sent, ['Space', 'Escape']);
});

test('a throwing runner is reported, not thrown, and the next gesture still runs', async () => {
  let n = 0;
  const a = createActions({
    runner: { target: async () => null, send: async () => { if (n++ === 0) throw new Error('boom'); return { sent: true, id: SID }; } },
    registry: {}, getBoard: workingBoard, apply: () => {},
  });
  const r1 = await a.handle(dev('push-to-talk', 'tap'));
  assert.deepEqual([r1.done, r1.reason], [false, 'boom']);
  assert.equal((await a.handle(dev('push-to-talk', 'tap'))).done, true);
});

test('push-to-talk while the session is launching is dropped with a note; after expiry or the first hook it is sent', async () => {
  const sent = [];
  const applied = [];
  let board = reduceBoard(reduceBoard(initialBoard(), { hook_event_name: 'RevviewOwned', ids: [SID] }), select);
  board = reduceBoard(board, { hook_event_name: 'RevviewLaunching', session_id: SID });
  const runner = { target: async () => ({ id: SID }), send: async (k) => { sent.push(k); return { sent: true, id: SID }; } };
  const a = createActions({ runner, registry: {}, getBoard: () => board, apply: (e) => applied.push(e), log: () => {} });
  const tap = () => a.handle(dev('push-to-talk', 'tap'));
  assert.deepEqual(await tap(), { action: 'push-to-talk', done: false, reason: 'session starting' });
  assert.deepEqual(sent, []);
  assert.deepEqual(applied, [{ hook_event_name: 'RevviewNote', note: 'Claude is still starting: push-to-talk not sent' }]);
  const launching = board;
  board = reduceBoard(launching, { hook_event_name: 'RevviewLaunchExpired', session_id: SID });
  assert.equal((await tap()).done, true);
  board = reduceBoard(launching, ev('UserPromptSubmit', { prompt: 'x' }));
  assert.equal((await tap()).done, true);
  assert.deepEqual(sent, ['Space', 'Space']);
});

test('push-to-talk refusal keys on the selected session: another launching session does not refuse; no selection keeps send', async () => {
  const OTHER = '22222222-2222-4222-8222-222222222222';
  const sent = [];
  const runner = { target: async () => ({ id: SID }), send: async (k) => { sent.push(k); return { sent: true, id: SID }; } };
  const mk = (board) => createActions({ runner, registry: {}, getBoard: () => board, apply: () => {}, log: () => {} });
  let b = reduceBoard(initialBoard(), { hook_event_name: 'RevviewOwned', ids: [SID, OTHER] });
  b = reduceBoard(b, select);
  b = reduceBoard(b, { hook_event_name: 'RevviewLaunching', session_id: OTHER });
  assert.equal((await mk(b).handle(dev('push-to-talk', 'tap'))).done, true, 'selected one is not starting');
  const none = reduceBoard(reduceBoard(initialBoard(), { hook_event_name: 'RevviewOwned', ids: [OTHER] }), { hook_event_name: 'RevviewLaunching', session_id: OTHER });
  assert.notEqual((await mk(none).handle(dev('push-to-talk', 'tap'))).reason, 'session starting');
});

test('push-to-talk is not refused while the data is locked (a selected session under INSERT KEY is already running)', async () => {
  const sent = [];
  const runner = { target: async () => ({ id: SID }), send: async (k) => { sent.push(k); return { sent: true, id: SID }; } };
  let b = reduceBoard(reduceBoard(initialBoard(), { hook_event_name: 'RevviewOwned', ids: [SID] }), select);
  b = reduceBoard(b, { hook_event_name: 'RevviewLaunching', session_id: SID });
  const a = createActions({ runner, registry: {}, getBoard: () => b, apply: () => {}, log: () => {} });
  assert.equal((await a.handle(dev('push-to-talk', 'tap'))).reason, 'session starting');
  b = reduceBoard(b, { hook_event_name: 'RevviewDataLock', locked: true });
  assert.equal((await a.handle(dev('push-to-talk', 'tap'))).done, true);
  assert.deepEqual(sent, ['Space']);
});
