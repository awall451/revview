// A POSTed RevviewNetwork is never a state: under --netmon it only makes the monitor probe again (like a posted
// RevviewDataLock under --data-lock); without --netmon it is refused. Fake probe and timers, no real waiting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startLiveServer } from '../../src/server/index.js';
import { createNetMonitor } from '../../src/server/netmon.js';

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fakeTimers() {
  const pending = new Map();
  let n = 0;
  return {
    setTimeout: (fn, ms) => { pending.set(++n, { fn, ms }); return n; },
    clearTimeout: (id) => { pending.delete(id); },
    pending,
  };
}
const post = (live, body) => fetch(`${live.url}/event`, { method: 'POST', body: JSON.stringify(body) });

test('under netmon a POSTed RevviewNetwork offline is only a poke: probes again, shows what the probe says', async (t) => {
  const timers = fakeTimers();
  let calls = 0;
  const live = await startLiveServer({ port: 0, netmon: { probe: async () => { calls++; return true; }, timers } });
  t.after(() => live.close());
  await flush();
  assert.equal(calls, 1);
  const r = await post(live, { hook_event_name: 'RevviewNetwork', online: false });
  assert.equal(r.status, 204);
  await flush();
  assert.equal(calls, 2, 'the poke made the monitor probe again');
  assert.equal(live.state().offline, false);
  assert.notEqual(live.state().view, 'offline');
  assert.equal(timers.pending.size, 1, 'exactly one next tick is scheduled');
});

test('under netmon a poke while a probe is in flight does not start a second timer chain', async (t) => {
  const timers = fakeTimers();
  let release;
  const live = await startLiveServer({ port: 0, netmon: { probe: () => new Promise((r) => { release = r; }), timers } });
  t.after(() => live.close());
  await post(live, { hook_event_name: 'RevviewNetwork', online: false });
  release(true);
  await flush();
  assert.equal(timers.pending.size, 1);
});

test('monitor.check() after stop does nothing', async () => {
  const timers = fakeTimers();
  let calls = 0;
  const m = createNetMonitor({ probe: async () => { calls++; return true; }, onChange: () => {}, timers });
  await flush();
  m.stop();
  m.check();
  await flush();
  assert.equal(calls, 1);
  assert.equal(timers.pending.size, 0);
});

test('without netmon (no dev bridge) a POSTed RevviewNetwork is refused with 403', async (t) => {
  const live = await startLiveServer({ port: 0 });
  t.after(() => live.close());
  assert.equal((await post(live, { hook_event_name: 'RevviewNetwork', online: false })).status, 403);
  assert.notEqual(live.state().view, 'offline');
});
