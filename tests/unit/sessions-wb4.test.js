// WB4: the board's selection is the one place buttons act; a list or menu only navigates. Real board and real
// permission registry; fake runner, fake clock and fake timers (one clock for all of them).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createActions, createPermissionRegistry } from '../../src/sessions/index.js';
import {
  initialBoard, reduceBoard, boardView, pendingPrompts, shownPrompt, selectedKey, homeKey,
} from '../../src/state/index.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const N = '44444444-4444-4444-8444-444444444444';
const PROJECTS = ['/work/one', '/work/two', '/work/three'];
const dev = (button, gesture = 'tap', extra = {}) => ({ button, gesture, source: 'device', dropped: false, ...extra });
const ev = (name, session_id, extra = {}) => ({ hook_event_name: name, session_id, cwd: `/w/${session_id.slice(0, 1)}`, ...extra });

function rig({ owned = [A, B], select = A, projects = PROJECTS, noRunner = false, startFails = false, navTimeoutMs = 10000 } = {}) {
  let now = 0;
  const timers = [];
  let tid = 0;
  const fakeTimers = {
    setTimeout: (fn, ms) => { const t = { id: ++tid, at: now + ms, fn }; timers.push(t); return t.id; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  };
  const adv = (ms) => {
    now += ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= now).sort((x, y) => x.at - y.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      due.fn();
    }
  };
  const registry = createPermissionRegistry({ clock: () => now, timers: fakeTimers });
  const decisions = [];
  const logs = [];
  const r = { board: initialBoard(), hook: null };
  const apply = (e) => {
    r.board = reduceBoard(r.board, e);
    registry.sweep(pendingPrompts(r.board));
    registry.observe(shownPrompt(r.board));
    return true;
  };
  const live = new Set(owned);
  const runner = noRunner ? null : {
    calls: { target: 0, send: 0, start: [] },
    sent: [],
    target: async (id) => {
      runner.calls.target += 1;
      const hook = r.hook; r.hook = null;
      if (hook) hook();
      return live.has(id) ? { id, window: '@1' } : null;
    },
    send: async (key, id) => {
      runner.calls.send += 1;
      if (!live.has(id)) return { sent: false, reason: 'selected session gone' };
      runner.sent.push({ key, id });
      return { sent: true, id, window: '@1' };
    },
    start: async ({ cwd }) => {
      runner.calls.start.push(cwd);
      if (startFails) throw new Error('cwd is not an existing directory');
      live.add(N);
      return { id: N, window: '@9', cwd };
    },
  };
  const actions = createActions({
    runner, registry, getBoard: () => r.board, apply, projects, log: (m) => logs.push(m), clock: () => now,
    timers: fakeTimers, navTimeoutMs, onOwnedChanged: () => apply({ hook_event_name: 'RevviewOwned', ids: [...live] }),
  });
  for (const id of owned) apply(ev('SessionStart', id));
  apply({ hook_event_name: 'RevviewProjects', paths: projects });
  apply({ hook_event_name: 'RevviewOwned', ids: owned });
  if (select !== null) apply({ hook_event_name: 'RevviewSelect', session_id: select });
  // a permission request of `id`: the board prompt and the waiting hook call bound to it
  const request = (id) => {
    for (const e of [
      ev('UserPromptSubmit', id, { prompt: 'x' }),
      ev('PreToolUse', id, { tool_name: 'Bash', tool_use_id: `t-${id}`, tool_input: { command: 'ls' } }),
      ev('PermissionRequest', id, { tool_name: 'Bash', tool_input: { command: 'ls' } }),
    ]) apply(e);
    const p = pendingPrompts(r.board).find((x) => x.session === id);
    return registry.add(p, (d) => decisions.push({ id, d }));
  };
  return {
    r, live, runner, registry, decisions, logs, actions, adv, request, apply,
    now: () => now,
    tap: (b, g = 'tap', extra) => actions.handle(dev(b, g, extra)),
    view: () => boardView(r.board),
    sel: () => selectedKey(r.board),
    nav: () => r.board.nav,
    timersLeft: () => timers.length,
  };
}

test('1. two owned sessions: push-to-talk and cancel go to the selected one only', async () => {
  const t = rig();
  assert.equal(t.sel(), A);
  await t.tap('right');
  assert.equal(t.sel(), B);
  assert.equal((await t.tap('push-to-talk')).done, true);
  assert.deepEqual(t.runner.sent, [{ key: 'Space', id: B }]);
  assert.equal((await t.tap('cancel')).done, true);
  assert.deepEqual(t.runner.sent, [{ key: 'Space', id: B }, { key: 'Escape', id: B }]);
  assert.ok(t.runner.sent.every((s) => s.id !== A), 'never A');
});

test('2. a selected session revview does not own (hand-started): push-to-talk sends nothing', async () => {
  const t = rig();
  t.apply(ev('SessionStart', C));
  t.apply({ hook_event_name: 'RevviewSelect', session_id: C });
  assert.equal(t.sel(), C);
  const r = await t.tap('push-to-talk');
  assert.equal(r.done, false);
  assert.deepEqual(t.runner.sent, []);
  assert.equal(t.view().voice, 'not-owned');
});

test('2b. nothing selected: no key, no answer', async () => {
  const t = rig({ select: null });
  assert.equal(t.sel(), null);
  for (const b of ['push-to-talk', 'cancel']) assert.deepEqual(await t.tap(b), { action: b === 'cancel' ? 'cancel-escape' : 'push-to-talk', done: false, reason: 'no session selected' });
  assert.equal(t.runner.calls.send, 0);
});

test('2c. nothing selected but a prompt is shown on the bar: press and deny send no decision and no key', async () => {
  const t = rig({ select: null });
  t.request(A);
  t.adv(2000);
  assert.equal(t.sel(), null);
  assert.equal(shownPrompt(t.r.board)?.session, A, 'the old focus rules show it');
  for (const b of ['press', 'deny', 'push-to-talk']) {
    const r = await t.tap(b);
    assert.deepEqual([r.done, r.reason], [false, 'no session selected'], b);
  }
  assert.equal(t.decisions.length, 0);
  assert.equal(t.registry.size(), 1, 'the long poll stays open');
  assert.deepEqual(t.runner.sent, []);
  assert.equal(t.nav(), null);
});

test('2d. a key to a session that is gone refreshes owned at once', async () => {
  const t = rig();
  t.live.delete(A);
  const r = await t.tap('push-to-talk');
  assert.deepEqual([r.done, r.reason], [false, 'selected session gone']);
  assert.deepEqual(t.r.board.owned, [B]);
});

test('2e. the highlighted session ends while the list is open: the list closes, a prompt shown again waits 1500 ms', async () => {
  const t = rig({ select: A });
  t.request(A);
  t.adv(5000);
  await t.tap('up'); // list opens on A (the prompt is shown, so up navigates)
  await t.tap('down');
  assert.equal(t.nav().id, B);
  t.apply(ev('SessionEnd', B));
  assert.equal(t.nav(), null);
  assert.equal(t.view().note, 'Highlighted session ended: list closed');
  assert.equal(t.sel(), A);
  const early = await t.tap('press');
  assert.deepEqual([early.done, early.reason], [false, 'not-shown-long-enough']);
  assert.equal(t.decisions.length, 0);
  t.adv(1500);
  assert.equal((await t.tap('press')).done, true);
  assert.deepEqual(t.decisions, [{ id: A, d: { behavior: 'allow' } }]);
});

test('3. switching onto a session with a prompt restarts the 1500 ms shown time', async () => {
  const t = rig();
  t.request(B);
  assert.equal(t.sel(), A);
  assert.equal(shownPrompt(t.r.board), null, 'the bar shows A');
  await t.tap('right');
  assert.equal(t.sel(), B);
  t.adv(100);
  const early = await t.tap('press');
  assert.deepEqual([early.done, early.reason], [false, 'not-shown-long-enough']);
  assert.equal(t.decisions.length, 0);
  assert.equal(t.registry.size(), 1);
  t.adv(1500); // 1600 after the switch
  assert.equal((await t.tap('press')).done, true);
  assert.deepEqual(t.decisions, [{ id: B, d: { behavior: 'allow' } }]);
});

test('3b. B -> A -> B within 1500 ms: the press is refused', async () => {
  const t = rig({ select: B });
  t.request(B);
  t.adv(5000); // long enough shown
  await t.tap('left'); // A
  t.adv(100);
  await t.tap('right'); // B again
  assert.equal(t.sel(), B);
  t.adv(1000);
  const r = await t.tap('press');
  assert.deepEqual([r.done, r.reason], [false, 'not-shown-long-enough']);
  assert.equal(t.decisions.length, 0);
  assert.equal(t.nav(), null, 'a refused allow never falls through to the list');
});

test('4. while a list is open nothing is sent and nothing is answered', async () => {
  const t = rig({ select: B });
  t.request(B);
  t.adv(5000); // a press on the normal view would allow now
  const gestures = [['press', 'tap'], ['deny', 'tap'], ['push-to-talk', 'tap'], ['cancel', 'tap'], ['cancel', 'long-hold'], ['press', 'hold']];
  for (const [b, g] of gestures) {
    if (t.nav() === null) await t.tap('up'); // opens the list
    assert.notEqual(t.nav(), null);
    t.adv(10);
    await t.tap(b, g);
    assert.equal(t.decisions.length, 0, `${b} ${g}`);
    assert.equal(t.registry.size(), 1, `${b} ${g}`);
    assert.equal(t.runner.calls.send, 0, `${b} ${g}`);
    assert.equal(t.runner.calls.target, 0, `${b} ${g}`);
  }
  assert.deepEqual(t.runner.sent, []);
});

test('5. the list closes by timeout; a press right after is refused, 1500 ms later it allows', async () => {
  const t = rig({ select: B });
  t.request(B);
  t.adv(5000);
  await t.tap('up');
  assert.equal(t.nav()?.kind, 'list');
  t.adv(9000);
  await t.tap('down'); // input at 9 s keeps it open (re-armed)
  t.adv(9999);
  assert.notEqual(t.nav(), null, 'still open 9999 ms after the last input');
  t.adv(1);
  assert.equal(t.nav(), null, 'closed 10000 ms after the last input');
  assert.equal(t.timersLeft(), 1, 'only the request wait timer is left');
  const r = await t.tap('press');
  assert.deepEqual([r.done, r.reason], [false, 'not-shown-long-enough']);
  assert.equal(t.decisions.length, 0);
  t.adv(1500);
  assert.equal((await t.tap('press')).done, true);
  assert.equal(t.decisions.length, 1);
});

test('5b. leaving the list by hand clears the timer; close() clears it too', async () => {
  const t = rig();
  await t.tap('up');
  assert.equal(t.timersLeft(), 1);
  await t.tap('back');
  assert.equal(t.nav(), null);
  assert.equal(t.timersLeft(), 0);
  await t.tap('menu');
  assert.equal(t.timersLeft(), 1);
  t.actions.close();
  assert.equal(t.timersLeft(), 0);
});

test('6. a prompt that appeared 100 ms before a press: not allowed and the list is not opened', async () => {
  const t = rig();
  t.adv(5000);
  t.request(A);
  assert.notEqual(shownPrompt(t.r.board), null);
  t.adv(100);
  const r = await t.tap('press');
  assert.deepEqual([r.done, r.reason], [false, 'not-shown-long-enough']);
  assert.equal(t.nav(), null);
  assert.equal(t.decisions.length, 0);
  assert.equal(t.registry.size(), 1);
});

test('6b. deny is the deny path only, never navigation', async () => {
  const t = rig();
  t.request(A);
  t.adv(1500);
  const r = await t.tap('deny');
  assert.equal(r.done, true);
  assert.equal(t.decisions[0].d.behavior, 'deny');
  const none = await t.tap('deny'); // nothing shown now
  assert.equal(none.done, false);
  assert.equal(t.nav(), null);
});

test('7. press without a prompt opens the list; down + press selects the next session; push-to-talk goes there', async () => {
  const t = rig();
  assert.equal(t.view().position.index, 1);
  await t.tap('press');
  assert.deepEqual([t.nav().kind, t.nav().row], ['list', 0]);
  await t.tap('down');
  assert.equal(t.nav().row, 1);
  await t.tap('press');
  assert.equal(t.nav(), null);
  assert.equal(t.sel(), B);
  assert.equal(t.view().position.index, 2);
  await t.tap('push-to-talk');
  assert.deepEqual(t.runner.sent, [{ key: 'Space', id: B }]);
});

test('8. New session: menu, press, down, press starts in projects[1] and selects it when it appears', async () => {
  const t = rig();
  await t.tap('menu');
  assert.equal(t.nav().kind, 'menu');
  await t.tap('press');
  assert.equal(t.nav().kind, 'new');
  await t.tap('down');
  const r = await t.tap('press');
  assert.deepEqual([r.action, r.done], ['new-session', true]);
  assert.deepEqual(t.runner.calls.start, [PROJECTS[1]]);
  assert.equal(t.nav(), null);
  assert.equal(t.r.board.want, null);
  assert.equal(t.sel(), N, 'the new session is on the board and selected without any hook event');
  assert.ok(t.r.board.owned.includes(N), 'owned refreshed');
  assert.deepEqual([t.view().view, t.view().note], ['unknown', 'No events from this session yet']);
  t.apply(ev('SessionStart', N));
  assert.equal(t.sel(), N);
  assert.equal(t.view().note, null);
});

test('8b. a refused start leaves the selection alone and logs', async () => {
  const t = rig({ startFails: true });
  await t.tap('menu');
  await t.tap('press');
  const r = await t.tap('press');
  assert.deepEqual([r.done, r.reason], [false, 'cwd is not an existing directory']);
  assert.equal(t.sel(), A);
  assert.equal(t.r.board.want, null);
  assert.equal(t.nav(), null);
  assert.equal(t.r.board.note, 'New session not started: project folder missing');
  assert.ok(t.logs.some((l) => /new-session: not done/.test(l)));
});

test('8c. New session with no such project or no runner starts nothing', async () => {
  const none = rig({ projects: [] });
  await none.tap('menu');
  await none.tap('press');
  assert.deepEqual((await none.tap('press')).reason, 'no such project');
  assert.deepEqual(none.runner.calls.start, []);
  // the controller's own list differs from the board's label: refused
  const t = rig();
  t.apply({ hook_event_name: 'RevviewProjects', paths: ['/other/a', '/other/b', '/other/c'] });
  await t.tap('menu');
  await t.tap('press');
  assert.equal((await t.tap('press')).reason, 'no such project');
  assert.deepEqual(t.runner.calls.start, []);
  const nr = rig({ noRunner: true });
  await nr.tap('menu');
  await nr.tap('press');
  assert.equal((await nr.tap('press')).reason, 'no sessions');
});

test('9. dropped and posted gestures change nothing', async () => {
  const t = rig();
  const before = t.r.board;
  for (const extra of [{ dropped: true }, { source: 'post' }, { source: undefined }]) {
    for (const b of ['right', 'left', 'press', 'up', 'menu', 'back', 'push-to-talk', 'cancel', 'deny']) await t.tap(b, 'tap', extra);
    await t.tap('back', 'hold', extra);
  }
  assert.equal(t.r.board, before);
  assert.equal(t.runner.calls.send + t.runner.calls.target, 0);
  assert.equal(t.timersLeft(), 0);
  await t.tap('up');
  const open = t.r.board;
  await t.tap('down', 'tap', { source: 'post' });
  await t.tap('press', 'tap', { dropped: true });
  assert.equal(t.r.board, open);
});

test('10. allow is refused when the selection changes while the runner is asked', async () => {
  const t = rig();
  t.request(A);
  t.adv(5000);
  t.r.hook = () => t.apply({ hook_event_name: 'RevviewNav', button: 'right', gesture: 'tap' });
  const r = await t.tap('press');
  assert.deepEqual([r.done, r.reason], [false, 'selection changed']);
  assert.equal(t.sel(), B);
  assert.equal(t.decisions.length, 0);
  assert.equal(t.registry.size(), 1);
});

test('10b. allow is refused when a list opens while the runner is asked', async () => {
  const t = rig();
  t.request(A);
  t.adv(5000);
  t.r.hook = () => t.apply({ hook_event_name: 'RevviewNav', button: 'up', gesture: 'tap' });
  const r = await t.tap('deny');
  assert.deepEqual([r.done, r.reason], [false, 'selection changed']);
  assert.equal(t.decisions.length, 0);
});

test('11. back hold on the normal view selects the neediest session', async () => {
  const t = rig();
  t.request(B);
  assert.equal(homeKey(t.r.board), B);
  assert.equal(t.sel(), A);
  await t.tap('back', 'hold');
  assert.equal(t.sel(), B);
  assert.equal(t.nav(), null);
});

test('without a runner keys and answers are refused with "no sessions", navigation works', async () => {
  const t = rig({ noRunner: true });
  t.request(A);
  t.adv(5000);
  for (const b of ['push-to-talk', 'cancel', 'deny', 'press']) assert.equal((await t.tap(b)).reason, 'no sessions', b);
  assert.equal((await t.tap('cancel', 'long-hold')).reason, 'no sessions');
  assert.equal(t.decisions.length, 0);
  assert.equal((await t.tap('right')).done, true);
  assert.equal(t.sel(), B);
  assert.equal((await t.tap('menu')).done, true);
  assert.equal(t.nav().kind, 'menu');
});

test('8d. a failed start for another reason notes a fixed text, never the error text', async () => {
  const t = rig();
  t.runner.start = async () => { throw new Error('tmux: secret detail'); };
  await t.tap('menu');
  await t.tap('press');
  await t.tap('press');
  assert.equal(t.r.board.note, 'New session not started: see the server log');
});

test('8e. no such project notes it on the bar', async () => {
  const t = rig({ projects: [] });
  await t.tap('menu');
  await t.tap('press');
  await t.tap('press');
  assert.equal(t.r.board.note, 'New session not started: no such project');
});
