// Read aloud in the wheel actions: fake readAloud and fake runner share one ordered log.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createActions } from '../../src/sessions/index.js';
import { initialBoard, reduceBoard } from '../../src/state/index.js';

const SID = '7de4c978-52e0-4e1a-ad17-826801362ee2';
const ev = (name, extra = {}) => ({ session_id: SID, hook_event_name: name, ...extra });
const select = { hook_event_name: 'RevviewSelect', session_id: SID };
const T = { timeout: 15000 };

const workingBoard = () => reduceBoard(reduceBoard(initialBoard(), ev('UserPromptSubmit', { prompt: 'x' })), select);
const unselectedBoard = () => reduceBoard(initialBoard(), ev('UserPromptSubmit', { prompt: 'x' }));
function permissionBoard() {
  let b = workingBoard();
  for (const e of [
    ev('PreToolUse', { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'ls' } }),
    ev('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } }),
  ]) b = reduceBoard(b, e);
  return b;
}

function setup({ board = workingBoard(), speakResult = { spoken: true }, stopImpl, withReadAloud = true } = {}) {
  const log = [];
  const applied = [];
  const readAloud = {
    speakFor: async (b, id) => { log.push(`speak ${id}`); return speakResult; },
    stop: async () => {
      log.push('stop-called');
      if (stopImpl) await stopImpl();
      log.push('stop');
    },
  };
  const runner = {
    target: async () => { log.push('target'); return { id: SID, window: '@1' }; },
    send: async (k) => { log.push(`send ${k}`); return { sent: true, id: SID, window: '@1' }; },
  };
  const registry = { answer: () => { log.push('answer'); return { ok: true }; } };
  const a = createActions({
    runner, registry, getBoard: () => board, apply: (e) => applied.push(e), log: () => {},
    readAloud: withReadAloud ? readAloud : undefined,
  });
  return { a, log, applied };
}
const dev = (button, gesture) => ({ button, gesture, source: 'device', dropped: false });

test('read-aloud tap speaks the selected session', T, async () => {
  const s = setup();
  assert.deepEqual(await s.a.handle(dev('read-aloud', 'tap')), { action: 'read-aloud', done: true });
  assert.deepEqual(s.log, [`speak ${SID}`]);
});

test('read-aloud tap with nothing selected is refused', T, async () => {
  const s = setup({ board: unselectedBoard() });
  assert.deepEqual(await s.a.handle(dev('read-aloud', 'tap')), { action: 'read-aloud', done: false, reason: 'no session selected' });
  assert.deepEqual(s.log, []);
});

test('read-aloud hold and long-hold stop the speech', T, async () => {
  for (const g of ['hold', 'long-hold']) {
    const s = setup();
    assert.deepEqual(await s.a.handle(dev('read-aloud', g)), { action: 'read-aloud-stop', done: true });
    assert.deepEqual(s.log, ['stop-called', 'stop']);
  }
});

test('without readAloud: tap keeps "no action", hold says no speech', T, async () => {
  const s = setup({ withReadAloud: false });
  assert.deepEqual(await s.a.handle(dev('read-aloud', 'tap')), { action: 'none', done: false, reason: 'no action' });
  assert.deepEqual(await s.a.handle(dev('read-aloud', 'hold')), { action: 'read-aloud-stop', done: false, reason: 'no speech' });
  assert.deepEqual(s.log, []);
});

test('push-to-talk: speech is stopped (awaited) before Space is sent', T, async () => {
  const s = setup({ stopImpl: () => new Promise((r) => setTimeout(r, 60)) });
  const r = await s.a.handle(dev('push-to-talk', 'tap'));
  assert.equal(r.done, true);
  assert.deepEqual(s.log, ['stop-called', 'stop', 'send Space']);
});

test('read-aloud never sends a key or answers, even on a permission board', T, async () => {
  const s = setup({ board: permissionBoard() });
  await s.a.handle(dev('read-aloud', 'tap'));
  await s.a.handle(dev('read-aloud', 'hold'));
  await s.a.handle(dev('read-aloud', 'long-hold'));
  assert.ok(!s.log.some((l) => l.startsWith('send') || l === 'answer' || l === 'target'), s.log.join(','));
});

test('no engine: refused with a fixed note on the bar', T, async () => {
  const s = setup({ speakResult: { spoken: false, reason: 'no engine' } });
  const r = await s.a.handle(dev('read-aloud', 'tap'));
  assert.deepEqual(r, { action: 'read-aloud', done: false, reason: 'no engine' });
  assert.deepEqual(s.applied, [{ hook_event_name: 'RevviewNote', note: 'Read aloud: no speech engine installed' }]);
});

test('other refusals add no note', T, async () => {
  const s = setup({ speakResult: { spoken: false, reason: 'could not start' } });
  assert.equal((await s.a.handle(dev('read-aloud', 'tap'))).reason, 'could not start');
  assert.deepEqual(s.applied, []);
});

test('a throwing stop does not stop Space and does not reject', T, async () => {
  const s = setup({ stopImpl: () => { throw new Error('boom'); } });
  const r = await s.a.handle(dev('push-to-talk', 'tap'));
  assert.deepEqual(r, { action: 'push-to-talk', done: true });
  assert.ok(s.log.includes('send Space'));
  const h = await s.a.handle(dev('read-aloud', 'hold'));
  assert.equal(h.action, 'read-aloud-stop');
});

test('list open: tap navigates (no speech), hold still stops', T, async () => {
  const board = reduceBoard(workingBoard(), { hook_event_name: 'RevviewNav', button: 'press', gesture: 'tap' });
  assert.notEqual(board.nav, null);
  const s = setup({ board });
  assert.equal((await s.a.handle(dev('read-aloud', 'tap'))).action, 'nav');
  assert.deepEqual(s.log, []);
  assert.deepEqual(await s.a.handle(dev('read-aloud', 'hold')), { action: 'read-aloud-stop', done: true });
  assert.deepEqual(s.log, ['stop-called', 'stop']);
});
