import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadLookConfig, isNightAt, clockSet, startLookClock, timesyncProbe, SYNCED_FILE, LookConfigError, DEFAULT_LOOK_CONFIG_PATH } from '../../src/server/look.js';
import { startLiveServer, parseArgs } from '../../src/server/index.js';

const at = (h, m = 0, y = 2026) => new Date(y, 5, 15, h, m, 0);
const NIGHT = { from: '21:00', to: '07:00' };

function tmpFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'look-'));
  const f = path.join(dir, 'look.json');
  fs.writeFileSync(f, typeof content === 'string' ? content : JSON.stringify(content));
  return f;
}

test('shipped config/look.json loads: day, 21:00-07:00', () => {
  assert.ok(path.isAbsolute(DEFAULT_LOOK_CONFIG_PATH));
  assert.deepEqual(loadLookConfig(DEFAULT_LOOK_CONFIG_PATH), { mode: 'day', night: NIGHT });
});

test('loadLookConfig: bad or missing file and bad values throw a LookConfigError', () => {
  const good = { look: 'auto', night: NIGHT };
  assert.deepEqual(loadLookConfig(tmpFile(good)), { mode: 'auto', night: NIGHT });
  const bads = [
    '{not json', '[]', '"x"', 'null',
    { ...good, look: 'dusk' }, { night: NIGHT }, { look: 'day' }, { look: 'day', night: 'x' },
    { look: 'day', night: { from: '21:00' } }, { look: 'day', night: { from: '24:00', to: '07:00' } },
    { look: 'day', night: { from: '9:00', to: '07:00' } }, { look: 'day', night: { from: '21:00', to: '07:60' } },
    { look: 'day', night: { from: 2100, to: 700 } },
  ];
  for (const bad of bads) {
    assert.throws(() => loadLookConfig(tmpFile(bad)), (e) => e instanceof LookConfigError && /^look config: /.test(e.message), JSON.stringify(bad));
  }
  assert.throws(() => loadLookConfig('/nonexistent/look.json'), LookConfigError);
});

test('isNightAt: wraps over midnight, same-day window, from == to never', () => {
  assert.equal(isNightAt(at(21, 0), NIGHT), true);
  assert.equal(isNightAt(at(20, 59), NIGHT), false);
  assert.equal(isNightAt(at(23, 59), NIGHT), true);
  assert.equal(isNightAt(at(0, 0), NIGHT), true);
  assert.equal(isNightAt(at(6, 59), NIGHT), true);
  assert.equal(isNightAt(at(7, 0), NIGHT), false);
  assert.equal(isNightAt(at(12, 0), NIGHT), false);
  const noon = { from: '12:00', to: '14:30' };
  assert.equal(isNightAt(at(11, 59), noon), false);
  assert.equal(isNightAt(at(12, 0), noon), true);
  assert.equal(isNightAt(at(14, 29), noon), true);
  assert.equal(isNightAt(at(14, 30), noon), false);
  for (const h of [0, 7, 12, 21, 23]) assert.equal(isNightAt(at(h), { from: '08:00', to: '08:00' }), false);
});

test('clockSet: year 2026 or later', () => {
  assert.equal(clockSet(new Date(2025, 11, 31, 23, 59)), false);
  assert.equal(clockSet(new Date(1970, 0, 1)), false);
  assert.equal(clockSet(new Date(2026, 0, 1)), true);
  assert.equal(clockSet(new Date(2031, 0, 1)), true);
});

function fakeTimers(lookMs = 30000) {
  let n = 0;
  const pending = new Map();
  return {
    pending,
    setTimeout: (fn, ms) => { const h = { id: ++n, unref: () => { h.unrefd = true; return h; } }; pending.set(h.id, { fn, ms, h }); return h; },
    clearTimeout: (h) => { pending.delete(h.id); },
    fire() {
      const hit = [...pending.entries()].find(([, e]) => e.ms === lookMs); // the look clock by its delay (the SSE ping, 15000, runs on the injected timers too)
      assert.ok(hit, `no timer with ms ${lookMs} pending`);
      const [id, p] = hit;
      pending.delete(id);
      p.fn();
    },
  };
}

test('startLookClock: applies at start, then only on a change, every interval, timer unref\'d', () => {
  let t = at(12);
  const timers = fakeTimers();
  const got = [];
  const logs = [];
  const c = startLookClock({ night: NIGHT, now: () => t, timers, apply: (e) => got.push(e), log: (m) => logs.push(m) });
  assert.deepEqual(got, [{ hook_event_name: 'RevviewLookClock', night: false }]);
  assert.equal(timers.pending.size, 1);
  const [{ ms, h }] = [...timers.pending.values()];
  assert.equal(ms, 30000);
  assert.equal(h.unrefd, true);
  timers.fire();
  assert.equal(got.length, 1); // no change: nothing applied
  t = at(21, 0);
  timers.fire();
  assert.deepEqual(got.at(-1), { hook_event_name: 'RevviewLookClock', night: true });
  assert.equal(got.length, 2);
  timers.fire();
  assert.equal(got.length, 2);
  t = at(7, 0);
  timers.fire();
  assert.deepEqual(got.at(-1), { hook_event_name: 'RevviewLookClock', night: false });
  assert.deepEqual(logs, []);
  c.stop();
  assert.equal(timers.pending.size, 0);
});

test('startLookClock: a custom interval; at start at night the first value is night', () => {
  const timers = fakeTimers();
  const got = [];
  startLookClock({ night: NIGHT, now: () => at(23), timers, intervalMs: 1234, apply: (e) => got.push(e.night) });
  assert.deepEqual(got, [true]);
  assert.equal([...timers.pending.values()][0].ms, 1234);
});

test('startLookClock: the clock is not set: day, logged once, night follows once it is set', () => {
  let t = new Date(1970, 0, 1, 23, 0);
  const timers = fakeTimers();
  const got = [];
  const logs = [];
  startLookClock({ night: NIGHT, now: () => t, timers, apply: (e) => got.push(e.night), log: (m) => logs.push(m) });
  timers.fire();
  timers.fire();
  assert.deepEqual(got, [false]);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /clock is not set/);
  t = at(23);
  timers.fire();
  assert.deepEqual(got, [false, true]);
  assert.equal(logs.length, 1);
});

test('startLookClock: stop() ends it even when a timer already fired late', () => {
  const timers = fakeTimers();
  const got = [];
  const c = startLookClock({ night: NIGHT, now: () => at(12), timers, apply: (e) => got.push(e) });
  c.stop();
  assert.equal(timers.pending.size, 0);
  assert.equal(got.length, 1);
});

test('parseArgs: --look-config takes a file', () => {
  assert.equal(parseArgs(['--look-config', '/x/look.json']).lookConfig, '/x/look.json');
  assert.equal(parseArgs([]).lookConfig, undefined);
  assert.throws(() => parseArgs(['--look-config']), /--look-config needs a file/);
  assert.throws(() => parseArgs(['--look-config', '--boot']), /--look-config needs a file/);
});

const get = async (s) => (await (await fetch(`${s.url}/state`)).json()).state;

test('live server: no look option = day, and the state carries look', async () => {
  const s = await startLiveServer({ port: 0 });
  try {
    assert.equal(s.state().look, 'day');
    assert.equal((await get(s)).look, 'day');
  } finally {
    await s.close();
  }
});

test('live server: look mode night / auto with the clock monitor, and close stops the monitor', async () => {
  const timers = fakeTimers();
  const s = await startLiveServer({ port: 0, look: { mode: 'night', night: NIGHT }, lookNow: () => at(12), timers });
  try {
    assert.equal(s.state().look, 'night');
  } finally {
    await s.close();
  }
  assert.equal(timers.pending.size, 0);
  for (const [h, want] of [[23, 'night'], [12, 'day']]) {
    const s2 = await startLiveServer({ port: 0, look: { mode: 'auto', night: NIGHT }, lookNow: () => at(h), timers: fakeTimers() });
    try {
      assert.equal(s2.state().look, want);
      assert.equal((await get(s2)).look, want);
    } finally {
      await s2.close();
    }
  }
});

test('live server: a menu hold over the dev bridge flips the look (no key sent)', async () => {
  const s = await startLiveServer({ port: 0, devBridge: true, look: { mode: 'day', night: NIGHT }, lookNow: () => at(12), timers: fakeTimers() });
  try {
    const key = (type) => fetch(`${s.url}/dev/key`, { method: 'POST', body: JSON.stringify({ code: 'F23', type }) });
    const until = async (fn) => { const end = Date.now() + 5000; while (!fn()) { if (Date.now() > end) assert.fail('timed out'); await new Promise((r) => setTimeout(r, 20)); } };
    await key('down');
    await new Promise((r) => setTimeout(r, 600));
    await key('up');
    await until(() => s.state().look === 'night');
    assert.equal(s.state().nav, null);
    assert.deepEqual(s.gestures().map((g) => `${g.button}:${g.gesture}`), ['menu:hold']);
  } finally {
    await s.close();
  }
});

test('POST of RevviewLook and RevviewLookClock is refused (403) and changes nothing', async () => {
  const s = await startLiveServer({ port: 0 });
  try {
    for (const body of [{ hook_event_name: 'RevviewLook', mode: 'night' }, { hook_event_name: 'RevviewLookClock', night: true }]) {
      const r = await fetch(`${s.url}/event`, { method: 'POST', body: JSON.stringify(body) });
      assert.equal(r.status, 403);
    }
    assert.equal(s.state().look, 'day');
  } finally {
    await s.close();
  }
});

test('startLookClock: with a synced probe, a year-2026 clock is still "not set" until the probe says so (day, logged once)', () => {
  let synced = false;
  const timers = fakeTimers();
  const got = [];
  const logs = [];
  startLookClock({ night: NIGHT, now: () => at(23), clockSynced: () => synced, timers, apply: (e) => got.push(e.night), log: (m) => logs.push(m) });
  timers.fire();
  assert.deepEqual(got, [false]);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /clock is not set yet \(no time sync yet\)/);
  synced = true;
  timers.fire();
  assert.deepEqual(got, [false, true]);
  assert.equal(logs.length, 1);
});

test('startLookClock: synced but the year is before 2026 is still day (second guard)', () => {
  const timers = fakeTimers();
  const got = [];
  startLookClock({ night: NIGHT, now: () => at(23, 0, 1970), clockSynced: () => true, timers, apply: (e) => got.push(e.night), log: () => {} });
  assert.deepEqual(got, [false]);
});

test('startLookClock: no probe (a laptop) means the year check alone decides', () => {
  const timers = fakeTimers();
  const got = [];
  startLookClock({ night: NIGHT, now: () => at(23), timers, apply: (e) => got.push(e.night) });
  assert.deepEqual(got, [true]);
});

test('timesyncProbe: true only when the file exists', () => {
  const f = tmpFile('');
  assert.equal(timesyncProbe(f)(), true);
  assert.equal(timesyncProbe(`${f}.none`)(), false);
  assert.equal(timesyncProbe()(), fs.existsSync(SYNCED_FILE));
  assert.equal(SYNCED_FILE, '/run/systemd/timesync/synchronized');
});

test('parseArgs: --clock-sync switches the synced probe on, optionally with a file', () => {
  assert.equal(parseArgs([]).clockSync, undefined);
  assert.equal(parseArgs(['--clock-sync']).clockSync, true);
  assert.equal(parseArgs(['--clock-sync', '/x/synchronized']).clockSync, '/x/synchronized');
  assert.equal(parseArgs(['--clock-sync', '--boot']).clockSync, true);
});

test('live server: look auto with a clockSynced probe: day until synced, then night at the 30 s check', async () => {
  let synced = false;
  const timers = fakeTimers();
  const s = await startLiveServer({ port: 0, look: { mode: 'auto', night: NIGHT }, lookNow: () => at(23), clockSynced: () => synced, timers });
  try {
    assert.equal(s.state().look, 'day');
    synced = true;
    timers.fire();
    assert.equal(s.state().look, 'night');
  } finally {
    await s.close();
  }
});
