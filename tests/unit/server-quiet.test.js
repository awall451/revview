// The server's clock (now, since) and the quiet timer, with an injected clock and fake timers (no real waits except the cue test).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLiveServer, parseArgs } from '../../src/server/index.js';

const { AbortController, TextDecoder } = globalThis;

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';
const QUIET = 4242;
const PLAYER = fileURLToPath(new URL('fixtures/sounds/fake-player.sh', import.meta.url));

// timers that only record the quiet ones (delay QUIET); any other delay (the cue player's) is real
function fakeTimers(only = QUIET) {
  const list = [];
  const cleared = [];
  return {
    list, cleared,
    setTimeout: (fn, ms) => {
      if (ms !== only) return setTimeout(fn, ms);
      const h = { fn: () => { cleared.push(h); fn(); }, ms, unref() {} }; // a fired timer is no longer live
      list.push(h);
      return h;
    },
    clearTimeout: (h) => { if (h && h.fn) cleared.push(h); else clearTimeout(h); },
    live: () => list.filter((h) => !cleared.includes(h)),
  };
}
function setup(opts = {}) {
  const timers = fakeTimers();
  const c = { t: 1000 };
  const clock = () => c.t;
  return { timers, c, opts: { port: 0, timers, clock, quietMs: QUIET, ...opts } };
}
async function boot(t, opts) {
  const live = await startLiveServer(opts);
  t.after(() => live.close());
  const post = async (e, p = '/event') => (await fetch(`${live.url}${p}`, { method: 'POST', body: JSON.stringify(e) })).status;
  const get = async () => (await fetch(`${live.url}/state`)).json();
  return { live, post, get };
}
const prompt = (id) => ({ hook_event_name: 'UserPromptSubmit', session_id: id, cwd: '/w/x', prompt: 'go' });
const view = (live) => live.state();

test('GET /state carries now from the injected clock, and state.since is the clock at the event', async (t) => {
  const { c, opts } = setup();
  const { post, get, live } = await boot(t, opts);
  c.t = 5000;
  assert.equal(await post(prompt(A)), 204);
  c.t = 9000;
  const s = await get();
  assert.equal(s.now, 9000);
  assert.equal(s.seq, 1);
  assert.equal(s.state.since, 5000);
  assert.equal(view(live).since, 5000);
});

test('the SSE message carries seq, now and state', async (t) => {
  const { c, opts } = setup();
  const { live } = await boot(t, opts);
  c.t = 7000;
  const ac = new AbortController();
  const res = await fetch(`${live.url}/events`, { signal: ac.signal });
  const reader = res.body.getReader();
  let buf = '';
  while (!buf.includes('data: ')) buf += new TextDecoder().decode((await reader.read()).value);
  ac.abort();
  const m = JSON.parse(buf.slice(buf.indexOf('data: ') + 6).split('\n')[0]);
  assert.deepEqual(Object.keys(m), ['seq', 'now', 'state']);
  assert.equal(m.now, 7000);
});

test('a working session gets quietSince after quietMs; a later event clears it and re-arms', async (t) => {
  const { c, timers, opts } = setup();
  const { post, live } = await boot(t, opts);
  c.t = 1000;
  await post(prompt(A));
  assert.equal(timers.live().length, 1);
  assert.equal(view(live).quietSince, null);
  c.t = 1000 + QUIET;
  timers.live()[0].fn();
  assert.equal(view(live).quietSince, 1000);
  // an event the board ignores clears the mark and re-arms
  c.t = 20000;
  assert.equal(await post({ hook_event_name: 'SubagentStop', session_id: A }), 204);
  assert.equal(view(live).quietSince, null);
  assert.equal(timers.live().length, 1, 'one live timer: the old one cleared, a new one armed');
  c.t = 20000 + QUIET;
  timers.live()[0].fn();
  assert.equal(view(live).quietSince, 20000);
});

test('a Stop before the timer: no quiet mark; SessionEnd drops the timer', async (t) => {
  const { c, timers, opts } = setup();
  const { post, live } = await boot(t, opts);
  await post(prompt(A));
  const h = timers.live()[0];
  c.t = 3000;
  await post({ hook_event_name: 'Stop', session_id: A });
  h.fn(); // a stale firing: the session is not working
  assert.equal(view(live).quietSince, null);
  await post(prompt(B));
  const n = timers.live().length;
  await post({ hook_event_name: 'SessionEnd', session_id: B });
  assert.equal(timers.live().length, n - 1);
});

test('quietMs 0 or null: no timer at all', async (t) => {
  for (const quietMs of [0, null]) {
    const { timers, opts } = setup({ quietMs });
    const { post } = await boot(t, opts);
    await post(prompt(A));
    assert.equal(timers.list.length, 0);
  }
});

test('/permission arms the timer too; the server makes its own events without re-arming', async (t) => {
  const { timers, opts } = setup();
  const { post, live } = await boot(t, opts);
  await post(prompt(A));
  const before = timers.list.length;
  await post({ hook_event_name: 'PermissionRequest', session_id: B, tool_name: 'Bash', tool_input: { command: 'ls' } }, '/permission');
  assert.equal(timers.list.length, before + 1);
  live.select(A); // RevviewSelect carries a session_id of its own and never re-arms
  assert.equal(timers.list.length, before + 1);
});

test('at most 64 timers (the oldest dropped); close clears them all', async () => {
  const { timers, opts } = setup();
  const live = await startLiveServer(opts);
  for (let i = 0; i < 70; i++) {
    await fetch(`${live.url}/event`, { method: 'POST', body: JSON.stringify(prompt(`s${i}`)) });
  }
  assert.equal(timers.live().length, 64);
  await live.close();
  assert.equal(timers.live().length, 0);
});

test('POST RevviewQuiet is refused with 403', async (t) => {
  const { opts } = setup();
  const { post, live } = await boot(t, opts);
  await post(prompt(A));
  assert.equal(await post({ hook_event_name: 'RevviewQuiet', session_id: A }), 403);
  assert.equal(view(live).quietSince, null);
});

test('CLI: --quiet-minutes', () => {
  assert.equal(parseArgs([]).quietMinutes, undefined);
  assert.equal(parseArgs(['--quiet-minutes', '2.5']).quietMinutes, 2.5);
  assert.equal(parseArgs(['--quiet-minutes', '0']).quietMinutes, 0);
  assert.equal(parseArgs(['--quiet-minutes', '120']).quietMinutes, 120);
  for (const bad of [['--quiet-minutes'], ['--quiet-minutes', 'x'], ['--quiet-minutes', '-1'], ['--quiet-minutes', '121'], ['--quiet-minutes', '1e2'], ['--quiet-minutes', '--boot']]) {
    assert.throws(() => parseArgs(bad), /--quiet-minutes needs a number/, bad.join(' '));
  }
});

// cue: the stand-in player records each start in a directory
async function cueRun(t, sounds) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-quiet-cue-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const old = { d: process.env.REVVIEW_FAKE_PLAYER_DIR, m: process.env.REVVIEW_FAKE_PLAYER_MS };
  process.env.REVVIEW_FAKE_PLAYER_DIR = dir;
  process.env.REVVIEW_FAKE_PLAYER_MS = '0';
  t.after(() => {
    for (const [k, v] of [['REVVIEW_FAKE_PLAYER_DIR', old.d], ['REVVIEW_FAKE_PLAYER_MS', old.m]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  const { c, timers, opts } = setup({ speech: { engine: null, sounds, killWaitMs: 200, cuePlayer: { argv: [PLAYER, '-q'], dir: '/cues' } } });
  const { post, live } = await boot(t, opts);
  await post({ hook_event_name: 'SessionStart', session_id: A, cwd: '/w/a' });
  live.select(A);
  await post(prompt(A));
  c.t += QUIET;
  timers.live().at(-1).fn();
  assert.ok(view(live).quietSince !== null);
  const played = () => fs.readdirSync(dir).filter((f) => f.startsWith('start.') && !f.startsWith('.tmp'))
    .map((f) => path.basename(fs.readFileSync(path.join(dir, f), 'utf8').split(' ')[0], '.wav'));
  return { played, timers };
}
const settle = async (f, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end && !f()) await new Promise((r) => setTimeout(r, 20));
};

test('sounds: the quiet cue plays once when the mark appears on the selected session', async (t) => {
  const { played, timers } = await cueRun(t, 'cues');
  await settle(() => played().includes('quiet'));
  assert.equal(played().filter((x) => x === 'quiet').length, 1);
  timers.live().at(-1)?.fn?.(); // a second firing changes nothing: no second cue
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(played().filter((x) => x === 'quiet').length, 1);
});

test('sounds off: no quiet cue', async (t) => {
  const { played } = await cueRun(t, 'off');
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(played(), []);
});
