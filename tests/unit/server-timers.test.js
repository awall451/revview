// The server's own timers run on the injected `timers` (cycle 81): the SSE ping and the owned-sessions poll are stepped by
// hand here, nothing waits. Also close() and the "window disappeared" log line.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startLiveServer } from '../../src/server/index.js';

const A = '11111111-1111-4111-8111-111111111111';

function fakeTimers() {
  const t = { live: new Set(), cleared: [] };
  t.setTimeout = (fn, ms) => { const h = { fn, ms, unref() {} }; t.live.add(h); return h; };
  t.clearTimeout = (h) => { t.cleared.push(h); t.live.delete(h); };
  t.count = (ms) => [...t.live].filter((h) => h.ms === ms).length;
  t.fire = (ms) => { // fire the one live timer of that length (it may re-arm itself)
    const hs = [...t.live].filter((h) => h.ms === ms);
    assert.equal(hs.length, 1, `exactly one live timer of ${ms} ms, got ${hs.length}`);
    t.live.delete(hs[0]);
    hs[0].fn();
  };
  return t;
}

function openStream(url, path) {
  return new Promise((resolve) => {
    const chunks = [];
    http.get(`${url}${path}`, (res) => {
      res.setEncoding('utf8');
      res.on('data', (d) => chunks.push(d));
      resolve({ chunks, ended: new Promise((r) => res.on('close', r)) });
    });
  });
}
const settle = () => new Promise((r) => setTimeout(r, 30)); // loopback delivery, not a timer under test
const pings = (s) => s.chunks.join('').split(': ping').length - 1;

test('the SSE ping is on the injected timers: one fire, one ping, then it re-arms; close() clears it', async () => {
  const timers = fakeTimers();
  const live = await startLiveServer({ port: 0, timers });
  const s = await openStream(live.url, '/events');
  await settle();
  assert.equal(pings(s), 0);
  timers.fire(15000);
  await settle();
  assert.equal(pings(s), 1);
  timers.fire(15000); // armed again
  await settle();
  assert.equal(pings(s), 2);
  assert.equal(timers.count(15000), 1);
  await live.close();
  assert.equal(timers.count(15000), 0, 'close() cleared the ping timer');
  await s.ended;
});

test('the owned-sessions poll is on the injected timers: each fire lists once and re-arms; close() clears it', async () => {
  const timers = fakeTimers();
  let lists = 0;
  const runner = { list: async () => { lists++; return [{ id: A, window: '@1' }]; }, target: async () => null, send: async () => ({ sent: false }), start: async () => { throw new Error('no'); } };
  const live = await startLiveServer({ port: 0, timers, sessions: runner, ownedPollMs: 7777 });
  assert.equal(lists, 1, 'one listing at start');
  timers.fire(7777);
  await settle();
  assert.equal(lists, 2);
  timers.fire(7777);
  await settle();
  assert.equal(lists, 3);
  assert.equal(timers.count(7777), 1);
  await live.close();
  assert.equal(timers.count(7777), 0, 'close() cleared the poll');
  assert.equal(lists, 3);
});

// Only what a client sees: the stream ends. That `ctx.demoClients` is emptied is not reachable from here (ctx is not exposed, and
// closeAllConnections() would end the stream anyway), so it is not asserted.
test('close() ends an open dev demo stream (the client sees it end)', async () => {
  const live = await startLiveServer({ port: 0, devBridge: true, devDemo: true });
  const s = await openStream(live.url, '/dev/demo');
  await settle();
  await live.close();
  await s.ended;
});

test('a vanished window with control characters in its name is logged without them', async (t) => {
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.join(' '));
  t.after(() => { console.error = orig; });
  let listed = [{ id: A, window: '@1', name: 'al\u001b[31mpha\u0007\u0085' }];
  const runner = { list: async () => listed, target: async () => null, send: async () => ({ sent: false }), start: async () => { throw new Error('no'); } };
  const live = await startLiveServer({ port: 0, sessions: runner, timers: fakeTimers() });
  t.after(() => live.close());
  listed = [];
  await live.refreshOwned();
  const line = logs.find((l) => /disappeared/.test(l));
  assert.ok(line, logs.join('\n'));
  assert.ok(line.includes('(al[31mpha)'), line);
  assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(line), JSON.stringify(line));
});
