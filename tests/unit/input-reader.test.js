import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers';
import { createDeviceReader } from '../../src/input/reader.js';
import { encodeEvent, EV_KEY, EV_SYN, SYN_REPORT, SYN_DROPPED } from '../../src/input/evdev.js';

// Event bytes are constructed by encodeEvent, not recorded from a device.
const key = (code, value) => encodeEvent({ type: EV_KEY, code, value });
const syn = (code = SYN_REPORT) => encodeEvent({ type: EV_SYN, code, value: 0 });
const tick = () => new Promise((r) => setImmediate(r));
const flush = async () => { for (let i = 0; i < 5; i++) await tick(); };

function fakeClock() {
  let seq = 0;
  const timers = new Map();
  return {
    setTimeout: (fn, ms) => { timers.set(++seq, { fn, ms }); return seq; },
    clearTimeout: (id) => { timers.delete(id); },
    pending: () => timers.size,
    fire() {
      const [id, t] = [...timers][0];
      timers.delete(id);
      t.fn();
    },
  };
}

function fixture(overrides = {}) {
  const clock = fakeClock();
  const calls = [];
  const logs = [];
  const state = { present: false, streams: [] };
  const deps = {
    readProcDevices: async () => (state.present
      ? 'I: Bus=0003 Vendor=1d50 Product=615e Version=0111\nN: Name="ZMK Dongle"\nH: Handlers=sysrq kbd event3\n'
      : ''),
    exists: async () => true,
    openStream: () => {
      const s = new EventEmitter();
      s.closed = false;
      s.close = () => { s.closed = true; };
      state.streams.push(s);
      return s;
    },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    ...overrides,
  };
  const reader = createDeviceReader({
    device: { name: 'ZMK Dongle', vendor: '1d50', product: '615e', path: null, grab: true },
    onKey: (c, v) => calls.push(['key', c, v]),
    onSync: (w) => calls.push(['sync', w]),
    onPresence: (p) => calls.push(['presence', p]),
    onLost: () => calls.push(['lost']),
    log: (m) => logs.push(m),
    retryMs: 1000,
    deps,
  });
  return { reader, clock, calls, logs, state };
}

test('fake: absent, found, split chunks, end, retry, reappear', async () => {
  const { reader, clock, calls, state } = fixture();
  reader.start();
  await flush();
  assert.deepEqual(calls, [['presence', false]]);
  assert.equal(clock.pending(), 1);

  // still absent: no duplicate report
  clock.fire();
  await flush();
  assert.deepEqual(calls, [['presence', false]]);

  state.present = true;
  clock.fire();
  await flush();
  const s = state.streams[0];
  assert.ok(s, 'stream opened');
  assert.deepEqual(calls.at(-1), ['presence', false], 'not present until ready');
  s.emit('ready');
  assert.deepEqual(calls.at(-1), ['presence', true]);

  const bytes = Buffer.concat([key(183, 1), syn(), key(183, 0), syn()]);
  for (let i = 0; i < bytes.length; i += 7) s.emit('data', bytes.subarray(i, i + 7));
  assert.deepEqual(calls.filter((c) => c[0] === 'key'), [['key', 183, 1], ['key', 183, 0]]);

  s.emit('data', syn(SYN_DROPPED));
  assert.deepEqual(calls.at(-1), ['sync', 'dropped']);

  const n = calls.length;
  s.emit('end', new Error('ENODEV'));
  assert.deepEqual(calls.slice(n), [['lost'], ['presence', false]]);
  assert.ok(s.closed);
  assert.equal(clock.pending(), 1);

  state.present = true;
  clock.fire();
  await flush();
  state.streams[1].emit('ready');
  assert.deepEqual(calls.at(-1), ['presence', true]);
  assert.equal(calls.filter((c) => c[0] === 'presence' && c[1] === true).length, 2);
  reader.stop();
});

test('fake: same log message not repeated while presence is unchanged', async () => {
  const { reader, clock, logs } = fixture();
  reader.start();
  await flush();
  for (let i = 0; i < 3; i++) { clock.fire(); await flush(); }
  assert.equal(logs.length, 1);
  reader.stop();
});

test('fake: open failure before ready reports lost and retries', async () => {
  const { reader, clock, calls, state } = fixture();
  state.present = true;
  reader.start();
  await flush();
  state.streams[0].emit('end', new Error('cannot grab: busy'));
  assert.deepEqual(calls, [['lost'], ['presence', false]]);
  assert.equal(clock.pending(), 1);
  reader.stop();
});

test('fake: explicit path that exists is used without /proc', async () => {
  let opened = null;
  const r2 = createDeviceReader({
    device: { name: null, vendor: null, product: null, path: '/dev/input/event9', grab: false },
    onPresence() {},
    deps: {
      readProcDevices: async () => { throw new Error('no proc'); },
      exists: async () => true,
      openStream: (p) => { opened = p; const s = new EventEmitter(); s.close = () => {}; return s; },
    },
  });
  r2.start();
  await flush();
  assert.equal(opened, '/dev/input/event9');
  r2.stop();
});

test('fake: explicit path that is missing is not found and never falls back to /proc', async () => {
  let procReads = 0;
  let opens = 0;
  const clock = fakeClock();
  const calls = [];
  const r = createDeviceReader({
    device: { name: null, vendor: null, product: null, path: '/dev/input/event9', grab: true },
    onPresence: (p) => calls.push(p),
    log: () => {},
    deps: {
      readProcDevices: async () => { procReads++; return 'I: Bus=0011 Vendor=0001 Product=0001\nN: Name="kbd"\nH: Handlers=kbd event0\n'; },
      exists: async () => false,
      openStream: () => { opens++; return new EventEmitter(); },
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    },
  });
  r.start();
  await flush();
  assert.deepEqual(calls, [false]);
  assert.equal(procReads, 0);
  assert.equal(opens, 0);
  assert.equal(clock.pending(), 1);
  r.stop();
});

test('fake: keys option selects the node that has the bound keys', async () => {
  // two kbd nodes, same ids; the first has no F13 (bit 183), the second does
  const proc = [
    'I: Bus=0003 Vendor=1d50 Product=615e Version=1', 'N: Name="cc"', 'H: Handlers=kbd event4', 'B: KEY=300000', '',
    'I: Bus=0003 Vendor=1d50 Product=615e Version=1', 'N: Name="kb"', 'H: Handlers=kbd event3', 'B: KEY=80000000000000 0 0', '',
  ].join('\n');
  let opened = null;
  const r = createDeviceReader({
    device: { name: null, vendor: '1d50', product: '615e', path: null, grab: true },
    keys: [183],
    onPresence() {},
    log: () => {},
    deps: {
      readProcDevices: async () => proc,
      exists: async () => true,
      openStream: (p) => { opened = p; return Object.assign(new EventEmitter(), { close() {} }); },
    },
  });
  r.start();
  await flush();
  assert.equal(opened, '/dev/input/event3');
  r.stop();
});

test('fake: stop silences everything', async () => {
  const { reader, clock, calls, state } = fixture();
  state.present = true;
  reader.start();
  await flush();
  const s = state.streams[0];
  s.emit('ready');
  const n = calls.length;
  reader.stop();
  assert.ok(s.closed);
  s.emit('data', key(183, 1));
  s.emit('end');
  await flush();
  assert.equal(calls.length, n);
  assert.equal(clock.pending(), 0);
});

test('fake: stop during a pending lookup opens nothing', async () => {
  const { reader, state, calls } = fixture();
  state.present = true;
  reader.start();
  reader.stop();
  await flush();
  assert.equal(state.streams.length, 0);
  assert.deepEqual(calls, []);
});

test('fake: throwing callbacks do not escape', async () => {
  const { state } = fixture();
  state.present = true;
  const clock = fakeClock();
  const boom = () => { throw new Error('boom'); };
  const logs = [];
  const r = createDeviceReader({
    device: { name: null, vendor: '1d50', product: null, path: null, grab: true },
    onKey: boom, onSync: boom, onPresence: boom, onLost: boom, log: (m) => logs.push(m),
    deps: {
      readProcDevices: async () => 'I: Bus=0003 Vendor=1d50 Product=1\nN: Name="x"\nH: Handlers=kbd event1\n',
      exists: async () => true,
      openStream: () => { const s = new EventEmitter(); s.close = () => {}; state.streams.push(s); return s; },
      setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    },
  });
  r.start();
  await flush();
  const s = state.streams.at(-1);
  s.emit('ready');
  s.emit('data', Buffer.concat([key(1, 1), syn(SYN_DROPPED)]));
  s.emit('end');
  assert.ok(logs.length > 0);
  r.stop();
});

// Real integration with a FIFO standing in for a device.
const within = (p, ms, what) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${what}`)), ms).unref()),
]);

test('FIFO integration: press, writer gone, new writer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'revview-fifo-'));
  const fifo = join(dir, 'ev');
  execFileSync('mkfifo', [fifo]);
  const calls = [];
  const waiters = [];
  const waitFor = (pred, what) => within(new Promise((resolve) => {
    waiters.push([pred, resolve]);
    check();
  }), 3000, what);
  function check() {
    for (const w of [...waiters]) {
      if (w[0]()) { waiters.splice(waiters.indexOf(w), 1); w[1](); }
    }
  }
  const rec = (...c) => { calls.push(c); check(); };
  const reader = createDeviceReader({
    device: { name: null, vendor: null, product: null, path: fifo, grab: false },
    onKey: (c, v) => rec('key', c, v),
    onPresence: (p) => rec('presence', p),
    onLost: () => rec('lost'),
    log: () => {},
    retryMs: 50,
  });
  const has = (...c) => () => calls.some((x) => JSON.stringify(x) === JSON.stringify(c));
  try {
    reader.start();
    const w1 = await within(open(fifo, 'w'), 3000, 'writer 1 open');
    await waitFor(has('presence', true), 'presence true');
    await w1.write(Buffer.concat([key(183, 1), syn(), key(183, 0), syn()]));
    await waitFor(has('key', 183, 0), 'key release');
    assert.deepEqual(calls.filter((c) => c[0] === 'key'), [['key', 183, 1], ['key', 183, 0]]);
    await w1.close();
    await waitFor(has('presence', false), 'presence false');
    assert.ok(calls.some((c) => c[0] === 'lost'));
    // reader retries after 50 ms and blocks in open until a writer arrives
    await new Promise((r) => setTimeout(r, 120));
    const w2 = await within(open(fifo, 'w'), 3000, 'writer 2 open');
    await waitFor(() => calls.filter((c) => c[0] === 'presence' && c[1] === true).length === 2, 'presence true again');
    // stop while a writer is attached, then let go
    reader.stop();
    const n = calls.length;
    await w2.write(key(184, 1)).catch(() => {});
    await w2.close();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(calls.length, n, 'no callbacks after stop');
  } finally {
    reader.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

// grab.py: the only part provable without a real input device.
const grab = new URL('../../src/input/grab.py', import.meta.url).pathname;

test('grab.py: regular file -> ioctl fails -> exit 2 with message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'revview-grab-'));
  const f = join(dir, 'file');
  writeFileSync(f, '');
  try {
    const r = spawnSync('python3', [grab, f], { encoding: 'utf8', timeout: 5000 });
    assert.equal(r.status, 2);
    assert.match(r.stderr, new RegExp(`^revview-grab: cannot grab ${f}: `));
    assert.equal(r.stdout, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('grab.py: missing path -> exit 3', () => {
  const r = spawnSync('python3', [grab, '/nonexistent/revview-event'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /revview-grab: cannot open/);
});

test('fake: open/grab failures back off (doubling to 30 s), reset on ready, not-found and start', async () => {
  const delays = [];
  const clock = fakeClock();
  const { reader, state } = fixture({ setTimeout: (fn, ms) => { delays.push(ms); return clock.setTimeout(fn, ms); }, clearTimeout: clock.clearTimeout });
  state.present = true;
  reader.start();
  await flush();
  let n = 0;
  const fail = async () => { state.streams[n++].emit('end', new Error('cannot grab: busy')); await flush(); };
  const next = async () => { clock.fire(); await flush(); };
  for (let i = 0; i < 8; i++) { await fail(); await next(); }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  // success resets; a later loss retries at retryMs
  state.streams[n].emit('ready');
  state.streams[n++].emit('end', new Error('unplugged'));
  await flush();
  assert.equal(delays.at(-1), 1000);
  await next();
  await fail();
  assert.equal(delays.at(-1), 1000);
  await next();
  await fail();
  assert.equal(delays.at(-1), 2000);
  await next();
  state.present = false; // not found keeps retryMs and resets the backoff
  await fail();
  assert.equal(delays.at(-1), 4000);
  await next();
  assert.equal(delays.at(-1), 1000);
  state.present = true;
  await next();
  await fail();
  assert.equal(delays.at(-1), 1000, 'a fresh find after not-found starts from retryMs');
  reader.stop();
  reader.start();
  await flush();
  await fail();
  assert.equal(delays.at(-1), 1000, 'start() resets');
  reader.stop();
});
