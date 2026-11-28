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
    // ctx.tid is the one live window; the selected session is the board's (s.select)
    target: async (id) => (ctx.tid === null || id !== ctx.tid ? null : { id: ctx.tid, window: '@1' }),
    send: async (k, id) => { ctx.sent.push(k); return { sent: true, id, window: '@1' }; },
    list: async () => (ctx.tid === null ? [] : [{ id: ctx.tid, window: '@1' }]),
  };
  const s = await startLiveServer({
    port: 0, devBridge: true, sessions: sessions ? runner : null, clock: () => ctx.now, ...opts,
  });
  if (sessions) s.select(SID); // the driver's selection: the session of the first events
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
  c.s.select(SUB[0].session_id);
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
  c.s.select(SUB[0].session_id);
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
  const seq0 = (await c.state()).seq;
  const bad = ['', '{nope', '[]', 'null', '{"hook_event_name":"PreToolUse","session_id":"s","tool_name":"Bash"}',
    '{"hook_event_name":"PermissionRequest","session_id":"","tool_name":"Bash"}',
    '{"hook_event_name":"PermissionRequest","tool_name":"Bash"}',
    '{"hook_event_name":"PermissionRequest","session_id":5,"tool_name":"Bash"}',
    '{"hook_event_name":"PermissionRequest","session_id":"s"}',
    '{"hook_event_name":"PermissionRequest","session_id":"s","tool_name":5}'];
  for (const b of bad) assert.equal((await c.post('/permission', b)).status, 400, b);
  assert.equal((await fetch(`${c.s.url}/permission`)).status, 405);
  assert.equal((await c.state()).seq, seq0, 'a refused body leaves the board alone');
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

// A question or a plan: the real hook was tried with Claude Code (docs/DECISIONS.md, questions and plans 1): the terminal picker
// is on screen while revview's hook holds the request, so the request stays held (a later part answers it through the picker)
for (const [name, file, tool] of [['question', 'sessions/ask-question.jsonl', 'AskUserQuestion'], ['plan', 'sessions/plan-approve.jsonl', 'ExitPlanMode']]) {
  test(`a ${name} on /permission shows CLAUDE ASKS and stays held, not answered`, async (t) => {
    const L = readLines(file);
    const c = await setup(t);
    c.s.select(L[0].session_id);
    const at = L.findIndex((e) => e.hook_event_name === 'PermissionRequest' && e.tool_name === tool);
    for (const e of L.slice(0, at)) await c.ev(e);
    const req = L[at];
    const r = c.perm(req);
    for (let i = 0; i < 100 && (await c.state()).state.view !== 'asking'; i++) await sleep(10);
    assert.equal((await c.state()).state.view, 'asking');
    assert.equal(c.s.permissionsWaiting(), 1);
    c.ctx.now = 1500;
    await c.press('F21'); // a press under CLAUDE ASKS does nothing
    assert.equal(await pending(r.p), 'pending');
    assert.equal(c.s.permissionsWaiting(), 1);
  });
}

// ---- the AskUserQuestion input reaches the registry; nothing else does
test('postPermission passes tool_input to the registry only for AskUserQuestion', async () => {
  const { PassThrough } = await import('node:stream');
  const { postPermission } = await import('../../src/server/routes-permission.js');
  const run = async (ev) => {
    const added = [];
    const ctx = {
      board: {}, apply: () => true, sessions: {}, registry: { add: (p, r, input) => { added.push(input); return 'id'; }, remove() {} },
    };
    const req = new PassThrough();
    req.headers = {};
    req.socket = { destroy() {} };
    const res = new PassThrough();
    res.writeHead = () => res;
    postPermission(ctx, req, res);
    req.end(JSON.stringify(ev));
    for (let i = 0; i < 50 && added.length === 0; i++) await sleep(10);
    return added;
  };
  const base = { hook_event_name: 'PermissionRequest', session_id: 's' };
  const qin = { questions: [{ question: 'Q?', options: [{ label: 'A' }] }] };
  assert.deepEqual(await run({ ...base, tool_name: 'AskUserQuestion', tool_input: qin }), [qin]);
  assert.deepEqual(await run({ ...base, tool_name: 'Bash', tool_input: qin }), [null]);
  assert.deepEqual(await run({ ...base, tool_name: 'ExitPlanMode', tool_input: { plan: 'x' } }), [null]);
  assert.deepEqual(await run({ ...base, tool_name: 'AskUserQuestion' }), [null]);
  assert.deepEqual(await run({ ...base, tool_name: 'AskUserQuestion', tool_input: [1] }), [null]);
  assert.deepEqual(await run({ ...base, tool_name: 'AskUserQuestion', tool_input: 'x' }), [null]);
});

// a real AskUserQuestion request (fixtures/sessions/ask-question.jsonl): down, down, allow answers with the label of option 2
async function askPrompt(c) {
  const ASKQ = readLines('sessions/ask-question.jsonl').map((e) => ({ ...e, session_id: SID }));
  await c.ev(ASKQ[1]);
  await c.ev(ASKQ[2]);
  const r = c.perm(ASKQ[3]);
  for (let i = 0; i < 100 && (await c.state()).state.view !== 'asking'; i++) await sleep(10);
  assert.equal((await c.state()).state.view, 'asking');
  await c.ev(ASKQ[4]); // the Notification: the same question, shown since the request
  return { r, q: ASKQ[3].tool_input.questions };
}

test('question: down, down, allow answers the long poll with the exact label; too early before 1500 ms', async (t) => {
  const c = await setup(t);
  const { r, q } = await askPrompt(c);
  c.ctx.now = 100;
  await c.press('F18');
  await c.press('F18');
  assert.equal((await c.state()).state.ask.choice, 2);
  await c.press('F21'); // shown for less than 1500 ms
  assert.equal(await pending(r.p), 'pending');
  assert.equal((await c.state()).state.note, 'Too early: press again');
  c.ctx.now = 1600;
  await c.press('F21');
  const got = await r.p;
  assert.equal(got.status, 200);
  assert.deepEqual(JSON.parse(got.body), {
    behavior: 'allow', updatedInput: { questions: q, answers: { [q[0].question]: q[0].options[2].label } },
  });
  assert.deepEqual(c.ctx.sent, []); // never a key for a question
  assert.equal(c.s.permissionsWaiting(), 0);
});

test('question: deny answers the long poll with a deny; no key', async (t) => {
  const c = await setup(t);
  const { r } = await askPrompt(c);
  c.ctx.now = 1600;
  await c.press('F16');
  assert.deepEqual(await r.p, { status: 200, body: JSON.stringify({ behavior: 'deny', message: DENY_MESSAGE }) });
  assert.deepEqual(c.ctx.sent, []);
});

// timers that hold only the ask-gone grace (delay GRACE); every other delay is the real one
const GRACE = 777;
function graceTimers() {
  const list = [];
  const cleared = [];
  return {
    list,
    setTimeout: (fn, ms) => {
      if (ms !== GRACE) return setTimeout(fn, ms);
      const h = { fn: () => { cleared.push(h); fn(); }, ms, unref() {} };
      list.push(h);
      return h;
    },
    clearTimeout: (h) => { if (h && h.fn) cleared.push(h); else clearTimeout(h); },
    live: () => list.filter((h) => !cleared.includes(h)),
  };
}

// ---- QA r11-02: a held question / plan request that ends without revview answering leaves the bar
test('question: Esc on the picker (the hook connection closes): the bar keeps the question until the grace, then waits for me, no note', async (t) => {
  const timers = graceTimers();
  const c = await setup(t, { timers, askGoneGraceMs: GRACE });
  const { r } = await askPrompt(c);
  r.abort(); // Claude closes the hook connection at once
  for (let i = 0; i < 100 && timers.live().length === 0; i++) await sleep(10);
  assert.equal(timers.live().length, 1, 'the grace timer is armed');
  assert.equal((await c.state()).state.view, 'asking', 'not gone before the grace');
  timers.live()[0].fn();
  const st = (await c.state()).state;
  assert.equal(st.view, 'waiting');
  assert.equal(st.ask, null);
  assert.equal(st.note, null);
  c.ctx.now = 5000;
  await c.press('F21'); // push-to-talk: not "Answer the prompt first" any more
  assert.notEqual((await c.state()).state.note, 'Answer the prompt first');
});

test('question: answered in the terminal (the connection closes, then PostToolUse within the grace): working, never waiting', async (t) => {
  const timers = graceTimers();
  const c = await setup(t, { timers, askGoneGraceMs: GRACE });
  const ASKQ = readLines('sessions/ask-question.jsonl').map((e) => ({ ...e, session_id: SID }));
  const { r } = await askPrompt(c);
  r.abort();
  for (let i = 0; i < 100 && timers.live().length === 0; i++) await sleep(10);
  await c.ev(ASKQ.slice(4).find((e) => e.hook_event_name === 'PostToolUse'));
  assert.equal((await c.state()).state.view, 'working');
  timers.live()[0].fn(); // the grace runs out: nothing is left to drop
  const st = (await c.state()).state;
  assert.equal(st.view, 'working');
  assert.equal(st.activity, 'working');
});

test('question: a pending grace timer is cleared when the server closes', async (t) => {
  const timers = graceTimers();
  const c = await setup(t, { timers, askGoneGraceMs: GRACE });
  const { r } = await askPrompt(c);
  r.abort();
  for (let i = 0; i < 100 && timers.live().length === 0; i++) await sleep(10);
  assert.equal(timers.live().length, 1);
  await c.s.close();
  assert.equal(timers.live().length, 0, 'no handle left');
});

test('the grace constant is 1500 ms', async () => {
  const { ASK_GONE_GRACE_MS } = await import('../../src/server/routes-permission.js');
  assert.equal(ASK_GONE_GRACE_MS, 1500);
});

test('question: our own wait ran out (204): the question leaves the bar and the note says it is left for the terminal', async (t) => {
  const c = await setup(t, { permissionWaitMs: 150 });
  const { r } = await askPrompt(c);
  assert.equal((await r.p).status, 204);
  for (let i = 0; i < 100 && (await c.state()).state.view === 'asking'; i++) await sleep(10);
  const st = (await c.state()).state;
  assert.notEqual(st.view, 'asking');
  assert.equal(st.note, 'Question left for the terminal');
});

test('plan: the request closes unanswered: the plan leaves the bar; a timeout says the plan is left for the terminal', async (t) => {
  const c = await setup(t, { permissionWaitMs: 150 });
  const PLAN = readLines('sessions/plan-approve.jsonl').map((e) => ({ ...e, session_id: SID }));
  for (const e of PLAN.slice(0, 8)) await c.ev(e);
  const r = c.perm(PLAN[8]);
  assert.equal((await r.p).status, 204);
  for (let i = 0; i < 100 && (await c.state()).state.view === 'asking'; i++) await sleep(10);
  const st = (await c.state()).state;
  assert.notEqual(st.view, 'asking');
  assert.equal(st.note, 'Plan left for the terminal');
});

test('an answered question is not "left"; a newer question of the session is not cleared by the older one closing', async (t) => {
  const timers = graceTimers();
  const c = await setup(t, { timers, askGoneGraceMs: GRACE });
  const { r } = await askPrompt(c);
  c.ctx.now = 1600;
  await c.press('F21'); // answered
  assert.equal((await r.p).status, 200);
  await sleep(100);
  assert.equal((await c.state()).state.note, null);
  // a second question; the first request's connection closing late must not touch it
  const ASKQ = readLines('sessions/ask-question.jsonl').map((e) => ({ ...e, session_id: SID }));
  await c.ev(ASKQ[1]);
  await c.ev(ASKQ[2]);
  const r2 = c.perm({ ...ASKQ[3], tool_use_id: 'toolu_second' });
  for (let i = 0; i < 100 && (await c.state()).state.view !== 'asking'; i++) await sleep(10);
  r.abort();
  await sleep(150);
  assert.equal(timers.list.length, 0, 'the late close of an answered request arms no grace');
  assert.equal((await c.state()).state.view, 'asking');
  assert.equal(c.s.permissionsWaiting(), 1);
  for (const h of timers.live()) h.fn(); // whatever grace were armed: the newer question stays
  assert.equal((await c.state()).state.view, 'asking');
  r2.abort();
});

test('POST /event RevviewAskGone is refused with 403', async (t) => {
  const c = await setup(t);
  const res = await c.post('/event', { hook_event_name: 'RevviewAskGone', session_id: SID, agent: null, since: 1, how: 'closed' });
  assert.equal(res.status, 403);
});
