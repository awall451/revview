// Cues on the live server, with the real stand-in player (fixtures/sounds/fake-player.sh) and the stand-in speech engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLiveServer } from '../../src/server/index.js';

const PLAYER = fileURLToPath(new URL('fixtures/sounds/fake-player.sh', import.meta.url));
const ENGINE = fileURLToPath(new URL('fixtures/speech/fake-engine.sh', import.meta.url));
const T = { timeout: 20000 };
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CLOSING = 'All done. The tests pass!';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await sleep(20);
  }
}
const recs = (dir, prefix) => fs.readdirSync(dir).filter((f) => f.startsWith(`${prefix}.`) && !f.startsWith('.tmp'))
  .map((f) => ({ file: f, text: fs.readFileSync(path.join(dir, f), 'utf8').trim() }));
// the cues played so far, in start order
const cues = (dir) => recs(dir, 'start').map((r) => r.text.split(' ')).sort((a, b) => Number(a[1]) - Number(b[1])).map((r) => path.basename(r[0], '.wav'));
const ends = (dir) => recs(dir, 'end').map((r) => Number(r.text));
const spoken = (dir) => recs(dir, 'text');

// runs fn(c) with a server whose cue player and speech engine are the stand-ins (records in c.cueDir and c.speechDir)
async function withServer(opts, fn) {
  const cueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-sounds-cue-'));
  const speechDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-sounds-speech-'));
  const old = { d: process.env.REVVIEW_FAKE_PLAYER_DIR, m: process.env.REVVIEW_FAKE_PLAYER_MS };
  process.env.REVVIEW_FAKE_PLAYER_DIR = cueDir;
  process.env.REVVIEW_FAKE_PLAYER_MS = String(opts.cueMs ?? 0);
  const { player = true, sounds = 'cues', ...rest } = opts;
  const engine = { name: 'fake', stages: [[ENGINE, speechDir, '30']], needs: [] };
  const speech = { engine, sounds, killWaitMs: 200, cuePlayer: player ? { argv: [PLAYER, '-q'], dir: '/cues' } : { argv: null } };
  const servers = [];
  const boot = async () => {
    const s = await startLiveServer({ port: 0, devBridge: true, speech, soundsSettleMs: 0, ...rest.server }); // the burst rule is in sounds-burst.test.js: here cues play at once
    servers.push(s);
    return s;
  };
  try {
    const s = await boot();
    const post = (body) => fetch(`${s.url}/event`, { method: 'POST', body: JSON.stringify(body) });
    const ev = async (e) => assert.equal((await post(e)).status, 204);
    const permit = async (body) => {
      await ev({ hook_event_name: 'UserPromptSubmit', session_id: body.session_id, prompt: 'go' });
      return fetch(`${s.url}/permission`, { method: 'POST', body: JSON.stringify(body) });
    };
    const key = async (code) => {
      const n = s.gestures().length;
      await fetch(`${s.url}/dev/key`, { method: 'POST', body: JSON.stringify({ code, type: 'down' }) });
      await fetch(`${s.url}/dev/key`, { method: 'POST', body: JSON.stringify({ code, type: 'up' }) });
      await until(() => s.gestures().length > n, 'a gesture');
      await sleep(40);
    };
    await ev({ hook_event_name: 'SessionStart', session_id: A, cwd: '/w/a' });
    await ev({ hook_event_name: 'SessionStart', session_id: B, cwd: '/w/b' });
    s.select(A);
    await fn({ s, ev, key, post, permit, cueDir, speechDir, boot, servers });
  } finally {
    for (const s of servers) await s.close();
    if (old.d === undefined) delete process.env.REVVIEW_FAKE_PLAYER_DIR; else process.env.REVVIEW_FAKE_PLAYER_DIR = old.d;
    if (old.m === undefined) delete process.env.REVVIEW_FAKE_PLAYER_MS; else process.env.REVVIEW_FAKE_PLAYER_MS = old.m;
    fs.rmSync(cueDir, { recursive: true, force: true });
    fs.rmSync(speechDir, { recursive: true, force: true });
  }
}
const stop = (id, msg = CLOSING) => ({ hook_event_name: 'Stop', session_id: id, last_assistant_message: msg });
const BASH = (id) => ({ hook_event_name: 'PermissionRequest', session_id: id, tool_name: 'Bash', tool_input: { command: 'ls' } });
const CODES = { menu: 'F23', down: 'F18', press: 'F21' };
const cycle = async (c) => { // menu -> Settings -> Sounds row -> press (through the dev bridge, as the wheel does)
  for (const b of ['menu', 'down', 'down', 'press', 'down', 'down', 'down', 'down', 'press']) await c.key(CODES[b]);
};

test('the selected session needs you: one needs cue, the same event again gives none', T, () => withServer({}, async (c) => {
  assert.equal(c.s.state().sounds ?? 'cues', 'cues');
  assert.equal((await c.permit(BASH(A))).status, 204);
  await until(() => cues(c.cueDir).length === 1, 'the needs cue');
  assert.deepEqual(cues(c.cueDir), ['needs']);
  assert.equal((await fetch(`${c.s.url}/permission`, { method: 'POST', body: JSON.stringify(BASH(A)) })).status, 204);
  await sleep(300);
  assert.deepEqual(cues(c.cueDir), ['needs']);
}));

test('the file is the last argument of the player', T, () => withServer({}, async (c) => {
  await c.ev(stop(A));
  await until(() => cues(c.cueDir).length === 1, 'a cue');
  assert.equal(recs(c.cueDir, 'start')[0].text.split(' ')[0], '/cues/done.wav');
}));

test('Stop gives done, StopFailure gives failed, another session gives other', T, () => withServer({}, async (c) => {
  await c.ev(stop(A));
  await until(() => cues(c.cueDir).length === 1, 'done');
  await c.ev({ hook_event_name: 'UserPromptSubmit', session_id: A, prompt: 'again' });
  await c.ev({ hook_event_name: 'StopFailure', session_id: A, error: 'rate_limit' });
  await until(() => cues(c.cueDir).length === 2, 'failed');
  await c.ev(stop(B));
  await until(() => cues(c.cueDir).length === 3, 'other');
  assert.deepEqual(cues(c.cueDir), ['done', 'failed', 'other']);
}));

test('GET /state, a new SSE connection and a repeated event give no cue', T, () => withServer({}, async (c) => {
  await c.ev(stop(A));
  await until(() => cues(c.cueDir).length === 1, 'done');
  await fetch(`${c.s.url}/state`);
  const ac = new globalThis.AbortController();
  const r = await fetch(`${c.s.url}/events`, { signal: ac.signal });
  await r.body.getReader().read();
  ac.abort();
  const r2 = await fetch(`${c.s.url}/events`, { signal: globalThis.AbortSignal.timeout(300) }).catch(() => null);
  await r2?.body?.cancel().catch(() => {});
  await c.ev(stop(A));
  await sleep(300);
  assert.deepEqual(cues(c.cueDir), ['done']);
}));

test('mode off: no cue; a fresh server with no events: no cue', T, () => withServer({ sounds: 'off' }, async (c) => {
  await c.ev(stop(A));
  await c.ev(stop(B));
  await sleep(300);
  assert.deepEqual(cues(c.cueDir), []);
  assert.equal(c.s.state().nav, null);
}));

test('a server started fresh (restart) with sessions already done plays nothing', T, () => withServer({}, async (c) => {
  await c.ev(stop(A));
  await until(() => cues(c.cueDir).length === 1, 'done');
  const s2 = await c.boot();
  await sleep(300);
  assert.deepEqual(cues(c.cueDir), ['done']);
  assert.equal(s2.state().view !== undefined, true);
}));

test('mode change through the Settings row: off to cues to speech decides what the server does', T, () => withServer({ sounds: 'off' }, async (c) => {
  await c.ev(stop(B));
  await sleep(200);
  assert.deepEqual(cues(c.cueDir), []);
  await cycle(c); // off -> cues
  assert.equal(c.s.state().nav.rows.at(-2).label, 'Sounds: cues');
  await c.ev({ hook_event_name: 'UserPromptSubmit', session_id: B, prompt: 'x' });
  await c.ev(stop(B));
  await until(() => cues(c.cueDir).length === 1, 'an other cue in cues mode');
  assert.deepEqual(cues(c.cueDir), ['other']);
  assert.deepEqual(spoken(c.speechDir), []);
}));

test('speech mode: the Stop of the selected session is spoken after its cue ended', T, () => withServer({ sounds: 'cues', cueMs: 400 }, async (c) => {
  await cycle(c); // cues -> speech
  assert.equal(c.s.state().nav.rows.at(-2).label, 'Sounds: cues and speech');
  await c.ev({ hook_event_name: 'UserPromptSubmit', session_id: A, prompt: 'go' });
  await c.ev(stop(A));
  const [t] = await until(() => (spoken(c.speechDir).length ? spoken(c.speechDir) : null), 'the spoken text');
  assert.equal(t.text, CLOSING);
  await until(() => ends(c.cueDir).length === 1, 'the cue end');
  assert.deepEqual(cues(c.cueDir), ['done']);
  const mtime = fs.statSync(path.join(c.speechDir, t.file)).mtimeMs;
  assert.ok(mtime >= ends(c.cueDir)[0] - 15, `speech (${mtime}) started after the cue ended (${ends(c.cueDir)[0]})`);
}));

test('speech mode set at start speaks without a cue player too', T, () => withServer({ sounds: 'speech', player: false }, async (c) => {
  await c.ev(stop(A));
  await until(() => spoken(c.speechDir).length === 1, 'the spoken text');
  assert.deepEqual(cues(c.cueDir), []);
}));

test('no player found: the server still answers, nothing is played', T, () => withServer({ player: false }, async (c) => {
  await c.ev(stop(A));
  assert.equal((await fetch(`${c.s.url}/state`)).status, 200);
  assert.equal((await c.permit(BASH(B))).status, 204);
  assert.deepEqual(cues(c.cueDir), []);
}));

test('a player that cannot start: one log line, the server goes on', T, async () => {
  const lines = [];
  const orig = console.error;
  console.error = (...a) => { lines.push(a.join(' ')); };
  let s;
  try {
    s = await startLiveServer({ port: 0, soundsSettleMs: 0, speech: { engine: null, sounds: 'cues', cuePlayer: { argv: ['/nonexistent/player'] } } });
    for (const id of [A, B]) {
      await fetch(`${s.url}/event`, { method: 'POST', body: JSON.stringify({ hook_event_name: 'SessionStart', session_id: id, cwd: '/w' }) });
    }
    for (let i = 0; i < 3; i++) {
      await fetch(`${s.url}/event`, { method: 'POST', body: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: A, prompt: 'go' }) });
      await fetch(`${s.url}/event`, { method: 'POST', body: JSON.stringify(stop(A)) });
      await sleep(100);
    }
    assert.equal((await fetch(`${s.url}/state`)).status, 200);
  } finally {
    console.error = orig;
    if (s) await s.close();
  }
  assert.equal(lines.filter((l) => l.includes('could not start')).length, 1);
  assert.ok(lines.some((l) => l === 'sounds: cue player /nonexistent/player could not start (ENOENT); cues are off'));
});

test('without speech nothing about sounds exists: sounds stays null', T, async () => {
  const s = await startLiveServer({ port: 0 });
  try {
    await fetch(`${s.url}/event`, { method: 'POST', body: JSON.stringify({ hook_event_name: 'SessionStart', session_id: A, cwd: '/w' }) });
    const { seq } = await (await fetch(`${s.url}/state`)).json();
    assert.equal(seq, 1);
  } finally {
    await s.close();
  }
});

test('close() kills a cue that is playing', T, () => withServer({ cueMs: 20000 }, async (c) => {
  await c.ev(stop(A));
  const [r] = await until(() => (recs(c.cueDir, 'start').length ? recs(c.cueDir, 'start') : null), 'the cue to start');
  const pid = Number(r.file.split('.')[1]);
  await c.s.close();
  await until(() => {
    try { process.kill(pid, 0); } catch (e) { return e.code === 'ESRCH'; }
    try { return /^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return true; }
  }, 'the stand-in to be dead');
}));

// ---- CLAUDE ASKS (a question): one needs cue per question, whatever the wheel does with it
const ASKQ = fs.readFileSync(fileURLToPath(new URL('../../fixtures/sessions/ask-question.jsonl', import.meta.url)), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));
const asking = (id) => ASKQ.map((e) => ({ ...e, session_id: id }));

// a stand-in session runner (one live window, session A) and a clock the test moves: the wheel's answer reaches the held request
const clock = { now: 0 };
const runner = {
  target: async (id) => (id === A ? { id: A, window: '@1' } : null),
  send: async (k, id) => ({ sent: true, id, window: '@1' }),
  list: async () => [{ id: A, window: '@1' }],
};

test('a question: moving the choice, a refused answer and the answer give no second needs cue; the next question gives one', T, () => withServer({ server: { sessions: runner, clock: () => clock.now } }, async (c) => {
  const q = asking(A);
  await c.ev(q[1]);
  await c.ev(q[2]);
  const r1 = fetch(`${c.s.url}/permission`, { method: 'POST', body: JSON.stringify(q[3]) }).then((r) => r.text().then((body) => ({ status: r.status, body })));
  await until(() => c.s.state().view === 'asking', 'the asking view');
  await until(() => cues(c.cueDir).length === 1, 'the needs cue');
  await c.ev(q[4]); // the Notification for the same question
  await c.key(CODES.down); // moves the highlighted choice
  await c.key(CODES.down);
  assert.equal(c.s.state().ask.choice, 2);
  await c.key(CODES.press); // shown for less than 1500 ms: refused with a note
  assert.equal(c.s.state().note, 'Too early: press again');
  assert.equal(c.s.state().view, 'asking');
  await sleep(400);
  assert.deepEqual(cues(c.cueDir), ['needs']);
  clock.now = 1600; // the question has been shown long enough
  await c.key(CODES.press); // answers it
  const got = await r1;
  assert.equal(got.status, 200);
  assert.equal(JSON.parse(got.body).behavior, 'allow');
  await until(() => c.s.state().view !== 'asking', 'the answered view');
  await sleep(400);
  assert.deepEqual(cues(c.cueDir), ['needs']);
  // a new question after the answered one: one more needs cue, and only one
  const second = { ...q[3], tool_use_id: 'toolu_second', tool_input: { questions: [{ ...q[3].tool_input.questions[0], question: 'Which size?' }] } };
  await c.ev(q[1]);
  const r2 = fetch(`${c.s.url}/permission`, { method: 'POST', body: JSON.stringify(second) });
  await until(() => cues(c.cueDir).length === 2, 'the second needs cue');
  await c.key(CODES.down);
  await sleep(400);
  assert.deepEqual(cues(c.cueDir), ['needs', 'needs']);
  r2.catch(() => {});
}));

test('a question that closes unanswered (Esc) leaves the bar without a cue; the next question gives one cue', T, () => withServer({ server: { sessions: runner, clock: () => clock.now } }, async (c) => {
  const q = asking(A);
  await c.ev(q[1]);
  await c.ev(q[2]);
  const { AbortController } = globalThis;
  const ac = new AbortController();
  fetch(`${c.s.url}/permission`, { method: 'POST', body: JSON.stringify(q[3]), signal: ac.signal }).catch(() => {});
  await until(() => c.s.state().view === 'asking', 'the asking view');
  await until(() => cues(c.cueDir).length === 1, 'the needs cue');
  ac.abort(); // Claude closes the hook connection: the question is gone (the 540 s timeout case is the next test)
  await until(() => c.s.state().view !== 'asking', 'the question gone');
  await sleep(400);
  assert.deepEqual(cues(c.cueDir), ['needs']); // clearing it played nothing
  const second = { ...q[3], tool_use_id: 'toolu_second', tool_input: { questions: [{ ...q[3].tool_input.questions[0], question: 'Which size?' }] } };
  await c.ev(q[1]);
  const r2 = fetch(`${c.s.url}/permission`, { method: 'POST', body: JSON.stringify(second) });
  await until(() => cues(c.cueDir).length === 2, 'the second needs cue');
  await sleep(400);
  assert.deepEqual(cues(c.cueDir), ['needs', 'needs']);
  r2.catch(() => {});
}));

// the question's own wait (permissionWaitMs) on injected timers, fired by hand: no real wait
const WAIT = 9999;
test('a question whose 540 s wait ran out leaves the bar without a cue; the next question gives one cue', T, () => {
  const waits = [];
  const timers = { setTimeout: (fn, ms) => (ms === WAIT ? (waits.push(fn), { unref() {} }) : setTimeout(fn, ms)), clearTimeout: (h) => clearTimeout(h) };
  return withServer({ server: { sessions: runner, clock: () => clock.now, permissionWaitMs: WAIT, timers } }, async (c) => {
    const q = asking(A);
    await c.ev(q[1]);
    await c.ev(q[2]);
    const r1 = fetch(`${c.s.url}/permission`, { method: 'POST', body: JSON.stringify(q[3]) });
    await until(() => c.s.state().view === 'asking', 'the asking view');
    await until(() => cues(c.cueDir).length === 1, 'the needs cue');
    assert.equal(waits.length, 1);
    waits[0](); // our wait ends: the terminal keeps the question
    assert.equal((await r1).status, 204);
    await until(() => c.s.state().view !== 'asking', 'the question left the bar');
    assert.equal(c.s.state().note, 'Question left for the terminal');
    assert.deepEqual(cues(c.cueDir), ['needs']); // leaving played nothing
    const second = { ...q[3], tool_use_id: 'toolu_second', tool_input: { questions: [{ ...q[3].tool_input.questions[0], question: 'Which size?' }] } };
    await c.ev(q[1]);
    const r2 = fetch(`${c.s.url}/permission`, { method: 'POST', body: JSON.stringify(second) });
    await until(() => cues(c.cueDir).length === 2, 'the second needs cue');
    assert.deepEqual(cues(c.cueDir), ['needs', 'needs']); // nothing in between
    r2.catch(() => {});
  });
});
