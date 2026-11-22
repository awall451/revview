import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { hasDefaultRoute, createDefaultProbe, createNetMonitor } from '../../src/server/netmon.js';
import { startLiveServer } from '../../src/server/index.js';

const H4 = 'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\n';
const eth = (flags = '0003') => `eth0\t00000000\t0102A8C0\t${flags}\t0\t0\t100\t00000000\t0\t0\t0\n`;
const wlan = (flags = '0003') => `wlan0\t00000000\t01A8C00A\t${flags}\t0\t0\t600\t00000000\t0\t0\t0\n`;
const LAN = 'eth0\t0002A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0\n';
const d6 = (iface, dest = '0'.repeat(32), plen = '00') =>
  `${dest} ${plen} ${'0'.repeat(32)} 00 fe800000000000000000000000000001 00000064 00000001 00000000 00000003 ${iface}\n`;

test('hasDefaultRoute: ipv4 eth0 only, wlan0 only, no default, UP clear', () => {
  assert.equal(hasDefaultRoute(H4 + eth() + LAN, ''), true);
  assert.equal(hasDefaultRoute(H4 + wlan() + LAN, ''), true);
  assert.equal(hasDefaultRoute(H4 + LAN, ''), false);
  assert.equal(hasDefaultRoute(H4 + eth('0002'), ''), false);
  assert.equal(hasDefaultRoute(H4, ''), false);
});

test('hasDefaultRoute: header line ignored, missing or empty text is no route', () => {
  assert.equal(hasDefaultRoute('', ''), false);
  assert.equal(hasDefaultRoute(undefined, null), false);
  assert.equal(hasDefaultRoute('Iface Destination Gateway Flags\n', ''), false);
});

test('hasDefaultRoute: ipv6 default on wlan0, not on lo, not a non-default prefix', () => {
  assert.equal(hasDefaultRoute(H4, d6('wlan0')), true);
  assert.equal(hasDefaultRoute(H4, d6('lo')), false);
  assert.equal(hasDefaultRoute(H4, d6('wlan0', '2001' + '0'.repeat(28), '40')), false);
  assert.equal(hasDefaultRoute(H4, d6('lo') + d6('eth0', 'fe80' + '0'.repeat(28), '40')), false);
  assert.equal(hasDefaultRoute(H4, d6('lo') + d6('wlan0')), true);
});

const files = (r4, r6) => async (f) => (f.endsWith('ipv6_route') ? r6 : r4);

test('probe: no default route -> false, connect never called', async () => {
  let called = 0;
  const probe = createDefaultProbe({ readFile: files(H4 + LAN, ''), connect: () => { called++; throw new Error('no'); } });
  assert.equal(await probe(), false);
  assert.equal(called, 0);
});

test('probe: unreadable route files -> false', async () => {
  const probe = createDefaultProbe({ readFile: async () => { throw new Error('ENOENT'); }, connect: () => { throw new Error('no'); } });
  assert.equal(await probe(), false);
});

test('probe: real local TCP server -> true; closed port -> false', async (t) => {
  const server = net.createServer((s) => s.on('error', () => {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const { port } = server.address();
  const readFile = files(H4 + wlan(), '');
  assert.equal(await createDefaultProbe({ readFile, host: '127.0.0.1', port })(), true);
  const probe2 = createDefaultProbe({ readFile, host: '127.0.0.1', port });
  await new Promise((r) => server.close(r));
  assert.equal(await probe2(), false);
});

test('probe: a connect that never completes -> false after the timeout, socket destroyed', async () => {
  const { EventEmitter } = await import('node:events');
  const sock = Object.assign(new EventEmitter(), { destroyed: false, destroy() { this.destroyed = true; } });
  const t0 = Date.now();
  const probe = createDefaultProbe({ readFile: files(H4 + eth(), ''), connect: () => sock, timeoutMs: 40 });
  assert.equal(await probe(), false);
  assert.ok(Date.now() - t0 >= 30);
  assert.equal(sock.destroyed, true);
});

test('probe: connect that throws -> false', async () => {
  const probe = createDefaultProbe({ readFile: files(H4 + eth(), ''), connect: () => { throw new Error('boom'); } });
  assert.equal(await probe(), false);
});

// a fake clock: setTimeout records, run() fires the pending one
function fakeTimers() {
  const pending = new Map();
  let n = 0;
  return {
    setTimeout: (fn, ms) => { pending.set(++n, { fn, ms }); return n; },
    clearTimeout: (id) => { pending.delete(id); },
    pending,
    delays: () => [...pending.values()].map((p) => p.ms),
    async fire() {
      const [id, p] = [...pending.entries()][0];
      pending.delete(id);
      p.fn();
      await flush();
    },
  };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function scripted(results) {
  const calls = { n: 0 };
  const probe = async () => {
    calls.n++;
    const r = results.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  return { probe, calls };
}

test('monitor: probes at once; one failure does nothing, two -> false, one success -> true', async () => {
  const timers = fakeTimers();
  const s = scripted([false, false, true]);
  const seen = [];
  const m = createNetMonitor({ probe: s.probe, onChange: (v) => seen.push(v), timers });
  await flush();
  assert.equal(s.calls.n, 1);
  assert.deepEqual(seen, []);
  await timers.fire();
  assert.deepEqual(seen, [false]);
  await timers.fire();
  assert.deepEqual(seen, [false, true]);
  m.stop();
});

test('monitor: first decided value is reported once; repeats are silent', async () => {
  const timers = fakeTimers();
  const s = scripted([true, true, true]);
  const seen = [];
  createNetMonitor({ probe: s.probe, onChange: (v) => seen.push(v), timers });
  await flush();
  await timers.fire();
  await timers.fire();
  assert.deepEqual(seen, [true]);
});

test('monitor: intervals follow the state, failures counter resets on success', async () => {
  const timers = fakeTimers();
  const s = scripted([true, false, true, false, false, false, true]);
  const seen = [];
  createNetMonitor({ probe: s.probe, onChange: (v) => seen.push(v), timers, onlineIntervalMs: 111, offlineIntervalMs: 22 });
  await flush();
  assert.deepEqual(timers.delays(), [111]);
  await timers.fire(); // false (1)
  assert.deepEqual(timers.delays(), [111]);
  await timers.fire(); // true resets
  await timers.fire(); // false (1)
  assert.deepEqual(seen, [true]);
  await timers.fire(); // false (2) -> offline
  assert.deepEqual(seen, [true, false]);
  assert.deepEqual(timers.delays(), [22]);
  await timers.fire();
  await timers.fire(); // true
  assert.deepEqual(seen, [true, false, true]);
  assert.deepEqual(timers.delays(), [111]);
});

test('monitor: no overlapping probes while one is slow', async () => {
  const timers = fakeTimers();
  let running = 0;
  let max = 0;
  let release;
  const probe = () => new Promise((res) => {
    running++;
    max = Math.max(max, running);
    release = () => { running--; res(true); };
  });
  createNetMonitor({ probe, onChange: () => {}, timers });
  await flush();
  assert.equal(timers.pending.size, 0, 'no next timer while a probe is in flight');
  release();
  await flush();
  assert.equal(timers.pending.size, 1);
  assert.equal(max, 1);
});

test('monitor: a rejecting or throwing probe counts as a failure', async () => {
  const timers = fakeTimers();
  const s = scripted([new Error('a'), new Error('b')]);
  const seen = [];
  const logs = [];
  createNetMonitor({ probe: s.probe, onChange: (v) => seen.push(v), timers, log: (m) => logs.push(m) });
  await flush();
  await timers.fire();
  assert.deepEqual(seen, [false]);
  assert.equal(logs.length, 2);
  const sync = [];
  createNetMonitor({ probe: () => { throw new Error('sync'); }, onChange: (v) => sync.push(v), timers: fakeTimers(), failuresToOffline: 1 });
  await flush();
  assert.deepEqual(sync, [false]);
});

test('monitor: stop() clears the timer and ignores an in-flight result', async () => {
  const timers = fakeTimers();
  const seen = [];
  let release;
  const m = createNetMonitor({ probe: () => new Promise((r) => { release = r; }), onChange: (v) => seen.push(v), timers });
  m.stop();
  release(true);
  await flush();
  assert.deepEqual(seen, []);
  assert.equal(timers.pending.size, 0);

  const t2 = fakeTimers();
  const m2 = createNetMonitor({ probe: async () => true, onChange: (v) => seen.push(v), timers: t2 });
  await flush();
  assert.equal(t2.pending.size, 1);
  m2.stop();
  assert.equal(t2.pending.size, 0);
});

test('server: netmon offline after two failures, back after a success, close() stops it', async (t) => {
  const timers = fakeTimers();
  const s = scripted([false, false, true, true]);
  const live = await startLiveServer({ port: 0, netmon: { probe: s.probe, timers } });
  t.after(() => live.close());
  await flush();
  assert.notEqual(live.state().view, 'offline');
  await timers.fire();
  assert.equal(live.state().view, 'offline');
  assert.equal(live.state().offline, true);
  await timers.fire();
  assert.notEqual(live.state().view, 'offline');
  assert.equal(live.state().offline, false);
  assert.equal(timers.pending.size, 1);
  await live.close();
  assert.equal(timers.pending.size, 0);
});
