import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createReplay, instance, loadSessions, postEvent } from '../long/replay.js';
import { startLiveServer } from '../../src/server/index.js';

// The long-run replay tool (tests/long/replay.js, used by tools/long-drive). Everything here runs on a FAKE wall clock,
// so the result does not depend on how fast or loaded the machine is.
const SESSIONS = fileURLToPath(new URL('../../fixtures/sessions', import.meta.url));
const sessions = loadSessions(SESSIONS);

function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('loadSessions: every recording, each ends with SessionEnd', () => {
  assert.equal(sessions.length, 6);
  for (const s of sessions) {
    assert.equal(s.events.at(-1).hook_event_name, 'SessionEnd', s.name);
    assert.ok(s.events.every((e) => e.session_id === s.id), s.name);
  }
});

test('instance: a new session id everywhere, the rest of each event kept', () => {
  const s = sessions.find((x) => x.name === 'working-turn');
  const a = instance(s, 0, 0);
  const b = instance(s, 1, 0);
  const c = instance(s, 0, 1);
  assert.equal(a.length, s.events.length);
  const ids = new Set([s.id, a[0].session_id, b[0].session_id, c[0].session_id]);
  assert.equal(ids.size, 4);
  assert.ok(a.every((e) => e.session_id === a[0].session_id));
  assert.equal(a[0].session_id.length, s.id.length);
  assert.ok(!JSON.stringify(a).includes(s.id));
  assert.equal(a[2].tool_name, s.events[2].tool_name);
  assert.equal(a[0].transcript_path, s.events[0].transcript_path.replace(s.id, a[0].session_id));
});

test('replay: events come due on the simulated clock, in order per stream, and stop while paused', async () => {
  const clock = fakeClock();
  const posted = [];
  const r = createReplay({ sessions, post: async (e) => { posted.push(e); return 204; }, now: clock.now, speedup: 100, streams: 2 });
  assert.equal(r.tick(), 0, 'paused until resume');
  r.resume();
  assert.equal(r.tick(), 1, 'stream 0 starts at sim 0 (stream 1 at 7 s)');
  clock.advance(100); // 10 simulated seconds
  assert.ok(r.tick() >= 2);
  r.pause();
  const frozen = r.simNow();
  clock.advance(100000);
  assert.equal(r.simNow(), frozen);
  assert.equal(r.tick(), 0);
  r.resume();
  await r.drain();
  const first = posted.filter((e) => e.session_id === posted[0].session_id);
  assert.equal(first[0].hook_event_name, 'SessionStart');
  assert.equal(r.stats.posted, posted.length);
  assert.equal(r.stats.ok, posted.length);
});

test('replay: a lane loops through the recordings with new session ids, and a failed post is counted, not retried', async () => {
  const clock = fakeClock();
  const seen = [];
  let n = 0;
  const r = createReplay({ sessions, post: async (e) => { seen.push(e); return ++n % 10 === 0 ? 0 : 204; }, now: clock.now, speedup: 1, streams: 1, gapSimMs: 10, pauseSimMs: 100 });
  r.resume();
  for (let i = 0; i < 400; i++) { clock.advance(10); r.tick(); }
  await r.drain();
  assert.ok(r.stats.sessions > 6, `looped past the 6 recordings, got ${r.stats.sessions} sessions`);
  assert.equal(r.stats.posted, seen.length, 'a failed event is not posted again');
  assert.equal(r.stats.failed, Math.floor(seen.length / 10));
  const ids = new Set(seen.filter((e) => e.hook_event_name === 'SessionStart').map((e) => e.session_id));
  assert.equal(ids.size, r.stats.sessions, 'every loop is a new session');
  assert.ok(Object.keys(r.stats.bySession).length === 6);
});

test('replay against the real server: every event is accepted and the board counts them all', async () => {
  const live = await startLiveServer({ port: 0 });
  try {
    const clock = fakeClock();
    const r = createReplay({ sessions, post: (e) => postEvent(live.url, e), now: clock.now, speedup: 1, streams: 3, gapSimMs: 10, pauseSimMs: 100 });
    r.resume();
    for (let i = 0; i < 300; i++) { clock.advance(10); r.tick(); await r.drain(); }
    assert.ok(r.stats.posted > 100);
    assert.equal(r.stats.failed, 0);
    const state = await (await fetch(`${live.url}/state`)).json();
    assert.equal(state.seq, r.stats.posted, 'one board step per posted event');
  } finally {
    await live.close();
  }
});

test('postEvent: an unreachable server is status 0, not an exception', async () => {
  assert.equal(await postEvent('http://127.0.0.1:1', { hook_event_name: 'SessionStart', session_id: 'x' }), 0);
});
