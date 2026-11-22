// r6 part D: the server marks every start it makes as launching, and the mark expires after launchLimitMs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startLiveServer, bootSessions } from '../../src/server/index.js';

const A = '11111111-1111-4111-8111-111111111111';
const post = (live, body) => fetch(`${live.url}/event`, { method: 'POST', body: JSON.stringify(body) });
const key = (live, code, type) => fetch(`${live.url}/dev/key`, { method: 'POST', body: JSON.stringify({ code, type }) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeTimers() {
  const t = { list: [], cleared: [] };
  t.setTimeout = (fn, ms) => { const h = { fn, ms, unref() {} }; t.list.push(h); return h; };
  t.clearTimeout = (h) => t.cleared.push(h);
  return t;
}
function runner() {
  const r = {
    windows: [],
    list: async () => r.windows.map((w) => ({ ...w })),
    start: async ({ cwd }) => { r.windows.push({ id: A, window: '@1', cwd, name: 'w' }); return { id: A, window: '@1', cwd }; },
    target: async () => ({ id: A, window: '@1' }),
    send: async () => ({ sent: true, id: A, window: '@1' }),
  };
  return r;
}

test('both launch events are internal: a POST gets 403', async (t) => {
  const live = await startLiveServer({ port: 0 });
  t.after(() => live.close());
  for (const n of ['RevviewLaunching', 'RevviewLaunchExpired']) {
    assert.equal((await post(live, { hook_event_name: n, session_id: A })).status, 403);
  }
});

test('bootSessions start: STARTING per session, expiry after launchLimitMs, then a hook shows at once', async (t) => {
  const timers = fakeTimers();
  const r = runner();
  const live = await startLiveServer({ port: 0, boot: true, sessions: r, timers, launchLimitMs: 1234 });
  t.after(() => live.close());
  await bootSessions({ runner: r, live, dirs: ['/w/a'], timers, log: () => {} });
  assert.equal(live.state().view, 'starting');
  assert.equal(live.state().note, null);
  const launch = timers.list.find((h) => h.ms === 1234);
  assert.ok(launch, 'a launch timer of launchLimitMs is armed');
  launch.fn();
  assert.equal(live.state().view, 'unknown');
  assert.equal(live.state().note, 'No events from this session yet');
  await post(live, { hook_event_name: 'UserPromptSubmit', session_id: A, cwd: '/w/a' });
  assert.equal(live.state().view, 'working');
});

test('during the per-session STARTING presses are not dropped: the menu opens', async (t) => {
  const timers = fakeTimers();
  const r = runner();
  const live = await startLiveServer({ port: 0, sessions: r, devBridge: true, timers, launchLimitMs: 99, projects: ['/p'] });
  t.after(() => live.close());
  await r.start({ cwd: '/w' });
  await live.refreshOwned();
  live.select(A);
  live.launched(A);
  assert.equal(live.state().view, 'starting');
  await key(live, 'F23', 'down');
  await key(live, 'F23', 'up');
  await sleep(150);
  assert.equal(live.gestures().at(-1).dropped, false);
  assert.equal(live.state().nav?.kind, 'menu');
});

test('close clears pending launch timers', async () => {
  const timers = fakeTimers();
  const r = runner();
  const live = await startLiveServer({ port: 0, sessions: r, timers, launchLimitMs: 99 });
  live.launched(A);
  const h = timers.list.find((x) => x.ms === 99);
  await live.close();
  assert.ok(timers.cleared.includes(h));
});
