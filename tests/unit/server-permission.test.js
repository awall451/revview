// POST /permission and the wheel buttons that answer it, with a fake runner and a fake clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { AbortController } = globalThis;
import { startLiveServer } from '../../src/server/index.js';
import { DENY_MESSAGE } from '../../src/sessions/permissions.js';

const readLines = (f) => fs.readFileSync(new URL(`../../fixtures/${f}`, import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const C2 = readLines('buttons/events-c2-d-d2-allow-deny-terminal.jsonl'); // 1 prompt, 2 pre, 3 permission, 4 post
const SUB = readLines('sessions/subagent-permission.jsonl'); // 0..8 setup, 9 subagent permission
const SID = C2[0].session_id;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup(t, { sessions = true, ...opts } = {}) {
  const ctx = { now: 0, tid: SID, sent: [] };
  const runner = {
    chosen: () => ctx.tid,
    target: async () => (ctx.tid === null ? null : { id: ctx.tid, window: '@1' }),
    send: async (k) => { ctx.sent.push(k); return { sent: true, id: ctx.tid, window: '@1' }; },
  };
  const s = await startLiveServer({
    port: 0, devBridge: true, sessions: sessions ? runner : null, clock: () => ctx.now, ...opts,
  });
  const aborts = [];
  t.after(async () => { for (const a of aborts) a.abort(); await s.close(); });
  const post = (path, body) => fetch(`${s.url}${path}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
  const ev = async (e) => { const r = await post('/event', e); assert.equal(r.status, 204); };
  // a long poll: resolves to {status, body} when answered
  const perm = (e) => {
    const ac = new AbortController();
    aborts.push(ac);
    // bounded: a request that never ends resolves to status 'NO RESPONSE' after 3 s, so a regression fails an assertion
    const answered = fetch(`${s.url}/permission`, { method: 'POST', body: JSON.stringify(e), signal: ac.signal })
      .then(async (r) => ({ status: r.status, body: await r.text() }), () => null);
    const giveUp = new Promise((res) => setTimeout(() => res({ status: 'NO RESPONSE', body: '' }), 3000).unref());
    return { p: Promise.race([answered, giveUp]), abort: () => ac.abort() };
  };
  const state = async () => (await (await fetch(`${s.url}/state`)).json());
  const press = async (code) => {
    const n = s.gestures().length;
    await post('/dev/key', { code, type: 'down' });
    await post('/dev/key', { code, type: 'up' });
    for (let i = 0; i < 100 && s.gestures().length === n; i++) await sleep(10);
    await sleep(60); // the action (target lookup, answer) runs after the gesture
  };
  return { s, ctx, ev, perm, state, press, post };
}

// the real recorded turn up to the permission request, then the request itself (a long poll)
async function realPrompt(c, lines = C2) {
  await c.ev(lines[1]);
  await c.ev(lines[2]);
  const r = c.perm(lines[3]);
  for (let i = 0; i < 100 && (await c.state()).state.view !== 'permission'; i++) await sleep(10);
  assert.equal((await c.state()).state.view, 'permission');
  return r;
}
const pending = (p) => Promise.race([p, sleep(150).then(() => 'pending')]);

test('allow: nothing before 1500 ms shown, then 200 allow, once', async (t) => {
  const c = await setup(t);
  const r = await realPrompt(c);
  c.ctx.now = 1499;
  await c.press('F21');
  assert.equal(await pending(r.p), 'pending');
  c.ctx.now = 1500;
  await c.press('F21');
  assert.deepEqual(await r.p, { status: 200, body: '{"behavior":"allow"}' });
  assert.equal(c.s.permissionsWaiting(), 0);
  await c.press('F21'); // a second press answers nothing and sends nothing
  assert.deepEqual(c.ctx.sent, []);
});

test('deny: 200 with the message', async (t) => {
  const c = await setup(t);
  const r = await realPrompt(c);
  c.ctx.now = 1500;
  await c.press('F16');
  const a = await r.p;
  assert.equal(a.status, 200);
  assert.deepEqual(JSON.parse(a.body), { behavior: 'deny', message: DENY_MESSAGE });
});

test('subagent permission request is answered through its own bound prompt', async (t) => {
  const c = await setup(t);
  c.ctx.tid = SUB[0].session_id;
  for (const e of SUB.slice(1, 9)) await c.ev(e);
  const r = c.perm(SUB[9]);
  for (let i = 0; i < 100 && (await c.state()).state.view !== 'permission'; i++) await sleep(10);
  c.ctx.now = 1500;
  await c.press('F21');
  assert.deepEqual(await r.p, { status: 200, body: '{"behavior":"allow"}' });
});

test('timeout: 204', async (t) => {
  const c = await setup(t, { permissionWaitMs: 100 });
  const r = await realPrompt(c);
  assert.equal((await r.p).status, 204);
  assert.equal(c.s.permissionsWaiting(), 0);
});

test('answered in the terminal: 204 at once, a later press does nothing', async (t) => {
  const c = await setup(t);
  const r = await realPrompt(c);
  await c.ev(C2[4]); // PostToolUse
  assert.equal((await r.p).status, 204);
  c.ctx.now = 5000;
  await c.press('F21');
  assert.deepEqual(c.ctx.sent, []);
});

test('client disconnect removes the request', async (t) => {
  const c = await setup(t);
  const r = await realPrompt(c);
  assert.equal(c.s.permissionsWaiting(), 1);
  r.abort();
  for (let i = 0; i < 100 && c.s.permissionsWaiting() !== 0; i++) await sleep(10);
  assert.equal(c.s.permissionsWaiting(), 0);
});

test('prompt of a session that is not the target, or no target: nothing', async (t) => {
  const c = await setup(t);
  const r = await realPrompt(c);
  c.ctx.now = 3000;
  c.ctx.tid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await c.press('F21');
  c.ctx.tid = null;
  await c.press('F21');
  await c.press('F16');
  assert.equal(await pending(r.p), 'pending');
  assert.equal(c.s.permissionsWaiting(), 1);
  c.ctx.tid = SID;
  await c.press('F21');
  assert.equal((await r.p).status, 200);
});

test('hostile POST /event PermissionRequest for the same session: the bar keeps the first (oldest) prompt', async (t) => {
  const c = await setup(t);
  const r = await realPrompt(c);
  const hostile = { ...C2[3], tool_input: { command: 'rm -rf /' } };
  await c.ev(hostile);
  const st = (await c.state()).state;
  assert.equal(st.view, 'permission');
  assert.equal(st.command, C2[3].tool_input.command);
  c.ctx.now = 1500;
  await c.press('F21');
  assert.equal((await r.p).status, 200);
});

test('hostile PostToolUse that clears the real entry: the real request gets 204, never allowed', async (t) => {
  const c = await setup(t);
  const r = await realPrompt(c);
  await c.ev({ ...C2[4], tool_input: { command: 'something else' } });
  assert.equal((await r.p).status, 204);
  c.ctx.now = 9000;
  await c.press('F21');
  assert.equal(c.s.permissionsWaiting(), 0);
});

test('a fake /permission request cannot get the real prompt\'s answer', async (t) => {
  const c = await setup(t);
  const real = await realPrompt(c);
  const fake = c.perm({ ...C2[3], tool_input: { command: 'rm -rf /' } });
  for (let i = 0; i < 100 && c.s.permissionsWaiting() < 2; i++) await sleep(10);
  assert.equal(c.s.permissionsWaiting(), 2);
  assert.equal((await c.state()).state.command, C2[3].tool_input.command);
  c.ctx.now = 1500;
  await c.press('F21');
  assert.deepEqual(await real.p, { status: 200, body: '{"behavior":"allow"}' });
  assert.equal(await pending(fake.p), 'pending');
  assert.equal(c.s.permissionsWaiting(), 1);
});

test('an identical second request that adds no prompt to the bar is never bound: the press answers only the first', async (t) => {
  const c = await setup(t);
  const real = await realPrompt(c);
  const seq = (await c.state()).seq;
  const dup = c.perm(C2[3]); // tied to the same call: the board keeps one entry, so the second request binds to none
  for (let i = 0; i < 100 && c.s.permissionsWaiting() < 2; i++) await sleep(10);
  assert.equal(c.s.permissionsWaiting(), 2);
  assert.equal((await c.state()).seq, seq + 1);
  c.ctx.now = 1500;
  await c.press('F21');
  assert.deepEqual(await real.p, { status: 200, body: '{"behavior":"allow"}' });
  assert.equal(await pending(dup.p), 'pending');
  await c.press('F21');
  assert.equal(await pending(dup.p), 'pending');
  assert.equal(c.s.permissionsWaiting(), 1);
});

test('POST /event RevviewInterrupted and RevviewAnswered are refused with 403, with and without the dev bridge', async (t) => {
  for (const devBridge of [true, false]) {
    for (const name of ['RevviewInterrupted', 'RevviewAnswered']) {
      const c = await setup(t, { devBridge });
      await c.ev(C2[1]);
      await c.ev(C2[2]);
      const before = (await c.state());
      const r = await c.post('/event', { hook_event_name: name, session_id: SID, agent: '', since: 1, decision: 'allow' });
      assert.equal(r.status, 403);
      assert.deepEqual(await c.state(), before);
    }
  }
});

test('after a button answer the prompt leaves the bar at once; the next prompt waits its own 1500 ms', async (t) => {
  const c = await setup(t);
  const r = await realPrompt(c);
  c.ctx.now = 1500;
  await c.press('F21');
  assert.deepEqual(await r.p, { status: 200, body: '{"behavior":"allow"}' });
  assert.equal((await c.state()).state.view, 'working'); // the allowed command still runs, no PostToolUse yet
  // a second call asks right away: it must not be answerable by the next press at the same instant
  await c.ev({ ...C2[2], tool_use_id: 'toolu_second' });
  const r2 = c.perm({ ...C2[3], tool_use_id: 'toolu_second' });
  for (let i = 0; i < 100 && (await c.state()).state.view !== 'permission'; i++) await sleep(10);
  assert.equal((await c.state()).state.view, 'permission');
  await c.press('F21');
  assert.equal(await pending(r2.p), 'pending');
  c.ctx.now = 1500 + 1499;
  await c.press('F21');
  assert.equal(await pending(r2.p), 'pending');
  c.ctx.now = 1500 + 1500;
  await c.press('F21');
  assert.deepEqual(await r2.p, { status: 200, body: '{"behavior":"allow"}' });
});

test('after a button deny the prompt leaves the bar at once', async (t) => {
  const c = await setup(t);
  const r = await realPrompt(c);
  c.ctx.now = 1500;
  await c.press('F16');
  assert.equal((await r.p).status, 200);
  assert.equal((await c.state()).state.view, 'working');
});

test('two prompts in one session (main + subagent): an answer clears only the answered one', async (t) => {
  const c = await setup(t);
  c.ctx.tid = SUB[0].session_id;
  for (const e of SUB.slice(1, 9)) await c.ev(e);
  const sub = c.perm(SUB[9]);
  for (let i = 0; i < 100 && (await c.state()).state.view !== 'permission'; i++) await sleep(10);
  // a main-thread request of the same session arrives while the subagent's is shown
  const mainReq = c.perm({ session_id: SUB[0].session_id, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'echo main' } });
  for (let i = 0; i < 100 && c.s.permissionsWaiting() < 2; i++) await sleep(10);
  assert.equal(c.s.permissionsWaiting(), 2);
  c.ctx.now = 1500;
  await c.press('F21');
  assert.deepEqual(await sub.p, { status: 200, body: '{"behavior":"allow"}' });
  assert.equal(await pending(mainReq.p), 'pending');
  assert.equal(c.s.permissionsWaiting(), 1);
});

test('bad bodies: 400', async (t) => {
  const c = await setup(t);
  const bad = ['', '{nope', '[]', 'null', '{"hook_event_name":"PreToolUse","session_id":"s","tool_name":"Bash"}',
    '{"hook_event_name":"PermissionRequest","session_id":"","tool_name":"Bash"}',
    '{"hook_event_name":"PermissionRequest","tool_name":"Bash"}',
    '{"hook_event_name":"PermissionRequest","session_id":5,"tool_name":"Bash"}',
    '{"hook_event_name":"PermissionRequest","session_id":"s"}',
    '{"hook_event_name":"PermissionRequest","session_id":"s","tool_name":5}'];
  for (const b of bad) assert.equal((await c.post('/permission', b)).status, 400, b);
  assert.equal((await fetch(`${c.s.url}/permission`)).status, 405);
  assert.equal((await c.state()).seq, 0);
});

test('without sessions, /permission answers 204 at once and buttons answer nothing', async (t) => {
  const c = await setup(t, { sessions: false });
  await c.ev(C2[1]);
  await c.ev(C2[2]);
  const r = await c.post('/permission', C2[3]);
  assert.equal(r.status, 204);
  assert.equal((await c.state()).state.view, 'permission');
  c.now = 9000;
  await c.press('F21');
  assert.equal(c.s.permissionsWaiting(), 0);
});

test('16 waiting requests at most: the 17th gets 503', async (t) => {
  const c = await setup(t);
  const uuid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  for (let i = 0; i < 16; i++) c.perm({ session_id: uuid(i), hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'x' } });
  for (let i = 0; i < 200 && c.s.permissionsWaiting() < 16; i++) await sleep(10);
  assert.equal(c.s.permissionsWaiting(), 16);
  const r = await c.post('/permission', { session_id: uuid(99), hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
  assert.equal(r.status, 503);
});

test('close() answers waiting requests 204', async (t) => {
  const c = await setup(t);
  const r = await realPrompt(c);
  await c.s.close();
  assert.equal((await r.p)?.status ?? 204, 204);
});

test('a request that adds no prompt to the bar is not bound to an older prompt of the same session (since binding)', async (t) => {
  const c = await setup(t);
  const real = await realPrompt(c);
  // same call, other command: the board keeps the first entry; a twin bound to it would make a press ambiguous
  const twin = c.perm({ ...C2[3], tool_input: { command: 'rm -rf /' } });
  for (let i = 0; i < 100 && c.s.permissionsWaiting() < 2; i++) await sleep(10);
  assert.equal(c.s.permissionsWaiting(), 2);
  c.ctx.now = 1500;
  await c.press('F21');
  assert.deepEqual(await real.p, { status: 200, body: '{"behavior":"allow"}' });
  assert.equal(await pending(twin.p), 'pending');
});
