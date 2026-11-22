// Replays the REAL recordings in fixtures/buttons/wb3/ (Claude Code 2.1.330 in revview's own tmux sessions, see
// fixtures/buttons/README.md) into a live server with a fake runner and a fake clock. No claude, network or tmux.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { AbortController } = globalThis;
import { startLiveServer } from '../../src/server/index.js';
import { DENY_MESSAGE } from '../../src/sessions/permissions.js';

const dir = new URL('../../fixtures/buttons/wb3/', import.meta.url);
const events = (n) => fs.readFileSync(new URL(`events-${n}.jsonl`, dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const text = (f) => fs.readFileSync(new URL(f, dir), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const name = (e) => e.hook_event_name;

async function setup(t, target) {
  const ctx = { now: 0, tid: target, sent: [] };
  const runner = {
    chosen: () => ctx.tid,
    target: async () => ({ id: ctx.tid, window: '@1' }),
    send: async (k) => { ctx.sent.push(k); return { sent: true, id: ctx.tid, window: '@1' }; },
  };
  const s = await startLiveServer({ port: 0, devBridge: true, sessions: runner, clock: () => ctx.now });
  const aborts = [];
  t.after(async () => { for (const a of aborts) a.abort(); await s.close(); });
  const post = (p, body) => fetch(`${s.url}${p}`, { method: 'POST', body: JSON.stringify(body) });
  const ev = async (e) => { assert.equal((await post('/event', e)).status, 204); };
  const perm = (e) => {
    const ac = new AbortController();
    aborts.push(ac);
    return fetch(`${s.url}/permission`, { method: 'POST', body: JSON.stringify(e), signal: ac.signal })
      .then(async (r) => ({ status: r.status, body: await r.text() }), () => null);
  };
  const state = async () => (await (await fetch(`${s.url}/state`)).json()).state;
  const press = async (code, holdMs = 0) => {
    const n = s.gestures().length;
    await post('/dev/key', { code, type: 'down' });
    if (holdMs) await sleep(holdMs);
    await post('/dev/key', { code, type: 'up' });
    for (let i = 0; i < 200 && s.gestures().length === n; i++) await sleep(10);
    await sleep(80);
  };
  const view = async (want) => {
    for (let i = 0; i < 200 && (await state()).view !== want; i++) await sleep(10);
    return (await state()).view;
  };
  return { ctx, ev, perm, state, press, view };
}
const pending = (p) => Promise.race([p, sleep(150).then(() => 'pending')]);
const rest = (evs, i, keep = () => true) => evs.slice(i + 1).filter((e) => name(e) !== 'SessionEnd' && keep(e));

// everything before the first PermissionRequest of the session goes to /event; returns the index of that request
async function replayToPermission(c, evs, sessionId) {
  const i = evs.findIndex((e) => name(e) === 'PermissionRequest' && e.session_id === sessionId);
  assert.ok(i > 0, 'the recording has the permission request');
  for (const e of evs.slice(0, i)) await c.ev(e);
  return i;
}

for (const [fixture, kind, key] of [['wb3-allow-main', 'allow', 'F21'], ['wb3-deny-main', 'deny', 'F16']]) {
  test(`${fixture}: the recorded request is answered ${kind} only after 1.5 s on the bar`, async (t) => {
    const evs = events(fixture);
    const sid = evs[0].session_id;
    const c = await setup(t, sid);
    const i = await replayToPermission(c, evs, sid);
    const r = c.perm(evs[i]);
    assert.equal(await c.view('permission'), 'permission');
    assert.equal((await c.state()).command, 'date > out.txt');
    c.ctx.now = 1000; // the early press of the recording: nothing happens
    await c.press(key);
    assert.equal(await pending(r), 'pending');
    c.ctx.now = 1500;
    await c.press(key);
    const want = kind === 'allow' ? '{"behavior":"allow"}' : JSON.stringify({ behavior: 'deny', message: DENY_MESSAGE });
    assert.deepEqual(await r, { status: 200, body: want });
    for (const e of rest(evs, i)) await c.ev(e); // what Claude did next
    assert.equal(await c.view('done'), 'done');
    assert.deepEqual(c.ctx.sent, []);
  });
}

test('wb3-allow-main: the recorded early press was refused by the server; the panes show the hook decisions', () => {
  assert.match(text('actions-wb3-allow-main.txt'), /action allow: not done \(not-shown-long-enough\)/);
  assert.match(text('actions-wb3-allow-main.txt'), /action allow: done/);
  assert.match(text('pane-wb3-allow-main-2-after-allow.txt'), /Allowed by PermissionRequest hook/);
  assert.match(text('pane-wb3-deny-main-2-after-deny.txt'), /Denied by PermissionRequest hook/);
});

test('wb3-allow-subagent: the subagent prompt is on the bar and a press answers it', async (t) => {
  const evs = events('wb3-allow-subagent');
  const sid = evs[0].session_id;
  const c = await setup(t, sid);
  const i = await replayToPermission(c, evs, sid);
  assert.ok(evs[i].agent_id, 'a subagent request');
  const r = c.perm(evs[i]);
  assert.equal(await c.view('permission'), 'permission');
  assert.equal((await c.state()).command, 'touch marker.txt && echo made');
  c.ctx.now = 1500;
  await c.press('F21');
  assert.deepEqual(await r, { status: 200, body: '{"behavior":"allow"}' });
  for (const e of rest(evs, i)) await c.ev(e);
  assert.notEqual((await c.state()).view, 'permission');
});

for (const [fixture, hold] of [['wb3-esc', 0], ['wb3-ctrlc', 1200]]) {
  test(`${fixture}: Claude fires no hook for the interrupt, the board leaves working`, async (t) => {
    const evs = events(fixture).filter((e) => name(e) !== 'SessionEnd');
    assert.deepEqual(evs.map(name), ['SessionStart', 'UserPromptSubmit', 'PreToolUse']); // nothing after the press
    const sid = evs[0].session_id;
    const c = await setup(t, sid);
    for (const e of evs) await c.ev(e);
    assert.equal((await c.state()).view, 'working');
    await c.press('F15', hold);
    assert.deepEqual(c.ctx.sent, [hold ? 'C-c' : 'Escape']);
    assert.equal(await c.view('waiting'), 'waiting');
    if (hold) { // a second long-hold within 5 s is refused, as recorded
      c.ctx.now = 1000;
      await c.press('F15', hold);
      assert.deepEqual(c.ctx.sent, ['C-c']);
      assert.match(text('actions-wb3-ctrlc.txt'), /action cancel-ctrl-c: not done \(ctrl-c too soon\)/);
    }
  });
}

test('wb3-two-sessions: a prompt in the session that is not chosen gets no answer from a button', async (t) => {
  const evs = events('wb3-two-sessions');
  const [a, b] = [evs[0].session_id, evs[1].session_id];
  assert.notEqual(a, b);
  const c = await setup(t, a); // A is the chosen one
  const i = await replayToPermission(c, evs, b);
  const r = c.perm(evs[i]);
  assert.equal(await c.view('permission'), 'permission');
  c.ctx.now = 1500;
  await c.press('F21');
  await c.press('F16');
  assert.equal(await pending(r), 'pending');
  assert.match(text('actions-wb3-two-sessions.txt'), /action allow: not done \(session\)/);
  assert.match(text('pane-wb3-two-sessions-6-B-dialog-after-allow-press.txt'), /Do you want to proceed\?/);
  // the terminal answer (PostToolUse) ends the request with no decision
  for (const e of rest(evs, i, (x) => x.session_id === b)) await c.ev(e);
  assert.deepEqual(await r, { status: 204, body: '' });
});
