import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseThrottled, parseTempMilli, deriveMarks, createThermalMonitor, createDefaultReaders, thermalEnv,
  DEFAULT_TEMP_PATH, RUN_TIMEOUT_MS,
} from '../../src/server/thermal.js';
import { startLiveServer, parseArgs } from '../../src/server/index.js';

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fakeTimers() {
  const pending = new Map();
  let n = 0;
  return {
    setTimeout: (fn, ms) => { pending.set(++n, { fn, ms }); return n; },
    clearTimeout: (id) => { pending.delete(id); },
    pending,
    async fire() {
      const [id, p] = [...pending.entries()][0];
      pending.delete(id);
      p.fn();
      await flush();
    },
  };
}

test('parseThrottled: vcgencmd output, bare hex, bare decimal, garbage', () => {
  assert.equal(parseThrottled('throttled=0x50005\n'), 0x50005);
  assert.equal(parseThrottled('0x8'), 8);
  assert.equal(parseThrottled('327685'), 327685);
  assert.equal(parseThrottled('throttled=0x0'), 0);
  for (const bad of ['', 'throttled=', 'throttled=0xZZ', null, undefined, 5, {}, 'x'.repeat(100000), '9'.repeat(5000), '0x1ffffffff', 'throttled=0x5 junk', '-1']) {
    assert.equal(parseThrottled(bad), null, String(bad).slice(0, 20));
  }
});

test('parseTempMilli: millidegrees to degrees, 0..150 only', () => {
  assert.equal(parseTempMilli('47774\n'), 47.774);
  assert.equal(parseTempMilli('0'), 0);
  assert.equal(parseTempMilli('150000'), 150);
  for (const bad of ['', 'abc', '-5000', '150001', '99999999', '47.7', null, undefined, 'x'.repeat(100000), '1'.repeat(5000)]) {
    assert.equal(parseTempMilli(bad), null, String(bad).slice(0, 20));
  }
});

const marks = (t, prev, now = 0, extra = {}) => deriveMarks(t, prev, { now, ...extra });

test('deriveMarks: bits table', () => {
  const cases = [
    [0x0, false, false], [0x1, false, true], [0x2, true, false], [0x4, true, false], [0x8, true, false],
    [0x5, true, true], [0xf, true, true],
    [0x10000, false, false], [0x50000, false, false], [0xf0000, false, false], // "has occurred" bits show nothing
  ];
  for (const [t, hot, lowPower] of cases) {
    const m = marks({ throttled: t, tempC: 40 });
    assert.deepEqual([m.hot, m.lowPower], [hot, lowPower], `0x${t.toString(16)}`);
  }
  const none = marks({ throttled: null, tempC: null });
  assert.deepEqual([none.hot, none.lowPower], [false, false]);
});

test('deriveMarks: temperature threshold with hysteresis', () => {
  let m = marks({ tempC: 79.9 });
  assert.equal(m.hot, false);
  m = marks({ tempC: 80 }, m, 0, { holdMs: 0 });
  assert.equal(m.hot, true);
  m = marks({ tempC: 77 }, m, 1, { holdMs: 0 });
  assert.equal(m.hot, true, 'stays hot above hotOffC');
  m = marks({ tempC: 74.9 }, m, 2, { holdMs: 0 });
  assert.equal(m.hot, false);
  m = marks({ tempC: 77 }, m, 3, { holdMs: 0 });
  assert.equal(m.hot, false, 'does not re-arm below hotOnC');
  m = marks({ tempC: 70 }, undefined, 0, { hotOnC: 60, hotOffC: 50, holdMs: 0 });
  assert.equal(m.hot, true);
});

test('deriveMarks: a mark stays on for holdMs after the last reading that had it', () => {
  let m = marks({ throttled: 0x5 }, undefined, 1000);
  assert.deepEqual([m.hot, m.lowPower], [true, true]);
  m = marks({ throttled: 0 }, m, 1001);
  assert.deepEqual([m.hot, m.lowPower], [true, true]);
  m = marks({ throttled: 0 }, m, 10999);
  assert.deepEqual([m.hot, m.lowPower], [true, true]);
  m = marks({ throttled: 0 }, m, 11000);
  assert.deepEqual([m.hot, m.lowPower], [false, false]);
  m = marks({ throttled: 0x1 }, m, 12000);
  m = marks({ throttled: 0 }, m, 15000, { holdMs: 1000 });
  assert.equal(m.lowPower, false);
});

function rig({ throttled = ['0x0'], temp = ['40000'], opts = {} } = {}) {
  const timers = fakeTimers();
  const clock = { t: 0 };
  const seen = [];
  const logs = [];
  const calls = { th: 0, tp: 0 };
  const step = (list, k) => async () => {
    const v = list[Math.min(calls[k]++, list.length - 1)];
    if (v instanceof Error) throw v;
    return v;
  };
  const mon = createThermalMonitor({
    readThrottled: step(throttled, 'th'), readTemp: step(temp, 'tp'), onChange: (m) => seen.push(m),
    timers, now: () => clock.t, log: (m) => logs.push(m), ...opts,
  });
  return { timers, clock, seen, logs, mon };
}

test('monitor: first call only once something is on, then only on change', async () => {
  const r = rig({ throttled: ['0x0', '0x0', '0x4', '0x4', '0x0', '0x0'] });
  await flush();
  assert.deepEqual(r.seen, []);
  await r.timers.fire();
  assert.deepEqual(r.seen, []);
  r.clock.t = 1000;
  await r.timers.fire();
  assert.deepEqual(r.seen, [{ hot: true, lowPower: false }]);
  await r.timers.fire(); // same
  assert.equal(r.seen.length, 1);
  r.clock.t = 2000;
  await r.timers.fire(); // 0x0 but held
  assert.equal(r.seen.length, 1);
  r.clock.t = 11500; // hold over, re-evaluated on the tick
  await r.timers.fire();
  assert.deepEqual(r.seen, [{ hot: true, lowPower: false }, { hot: false, lowPower: false }]);
  assert.equal(r.timers.pending.size, 1);
});

test('monitor: temperature makes hot, low power from bit 0', async () => {
  const r = rig({ throttled: ['0x1'], temp: ['81000'] });
  await flush();
  assert.deepEqual(r.seen, [{ hot: true, lowPower: true }]);
});

test('monitor: missing sources log once each over many ticks, no marks, no crash', async () => {
  const r = rig({ throttled: [Object.assign(new Error('spawn vcgencmd ENOENT'), { code: 'ENOENT' })], temp: [null] });
  await flush();
  for (let i = 0; i < 10; i++) await r.timers.fire();
  assert.equal(r.logs.length, 2, r.logs.join('|'));
  assert.ok(r.logs.some((l) => l.startsWith('thermal: throttled not readable (spawn vcgencmd ENOENT)')));
  assert.ok(r.logs.some((l) => l.startsWith('thermal: temperature not readable')));
  assert.deepEqual(r.seen, []);
  assert.equal(r.timers.pending.size, 1);
});

test('monitor: a source that works later adds no log; garbage logs once per source', async () => {
  const r = rig({ throttled: [new Error('boom'), '0x0', '0x0'], temp: ['garbage', 'garbage', '40000'] });
  await flush();
  for (let i = 0; i < 5; i++) await r.timers.fire();
  assert.equal(r.logs.length, 2, r.logs.join('|'));
});

test('monitor: since-boot bits are logged once per distinct value', async () => {
  const r = rig({ throttled: ['0x50000', '0x50000', '0x50000', '0x10000', '0x50000'] });
  await flush();
  for (let i = 0; i < 4; i++) await r.timers.fire();
  const since = r.logs.filter((l) => l.startsWith('thermal: since boot: '));
  assert.equal(since.length, 3);
  assert.match(since[0], /under-voltage occurred, throttling occurred/);
  assert.deepEqual(r.seen, []);
});

test('monitor: onChange throwing is logged, stop() clears the timer and ends the loop', async () => {
  const r = rig({ throttled: ['0x2'], opts: { onChange: () => { throw new Error('x'); } } });
  await flush();
  assert.ok(r.logs.some((l) => l.includes('onChange failed')));
  assert.equal(r.timers.pending.size, 1);
  r.mon.stop();
  assert.equal(r.timers.pending.size, 0);
  const s = rig();
  let release;
  const slow = createThermalMonitor({
    readThrottled: () => new Promise((res) => { release = res; }), readTemp: async () => '40000', onChange: () => {}, timers: s.timers,
  });
  slow.stop();
  release('0x0');
  await flush();
  assert.equal(s.timers.pending.size, 1, 'only the rig monitor has a timer');
  s.mon.stop();
  assert.equal(s.timers.pending.size, 0);
});

test('default readers: temp from the file, throttled from the command', async () => {
  const files = [];
  const runs = [];
  const r = createDefaultReaders({
    readFile: async (p, enc) => { files.push([p, enc]); return '47774\n'; },
    run: async (cmd, args, o) => { runs.push([cmd, args, o]); return 'throttled=0x50005\n'; },
  });
  assert.equal(await r.readTemp(), '47774\n');
  assert.deepEqual(files, [[DEFAULT_TEMP_PATH, 'utf8']]);
  assert.equal(await r.readThrottled(), 'throttled=0x50005\n');
  assert.equal(runs[0][0], 'vcgencmd');
  assert.deepEqual(runs[0][1], ['get_throttled']);
  assert.equal(runs[0][2].timeout, RUN_TIMEOUT_MS);
  assert.ok(runs[0][2].maxBuffer <= 65536);
});

test('default readers: configured paths; a throttled file replaces the command; ENOENT is unreadable', async () => {
  const read = [];
  let ran = 0;
  const r = createDefaultReaders({
    tempPath: '/t/temp', throttledPath: '/t/thr', vcgencmd: '/x/vc',
    readFile: async (p) => { read.push(p); return '0x0'; }, run: async () => { ran++; return ''; },
  });
  await r.readTemp();
  await r.readThrottled();
  assert.deepEqual(read, ['/t/temp', '/t/thr']);
  assert.equal(ran, 0);
  const cmd = [];
  const r2 = createDefaultReaders({ vcgencmd: '/x/vc', run: async (c) => { cmd.push(c); throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }); } });
  await assert.rejects(r2.readThrottled(), /ENOENT/);
  assert.deepEqual(cmd, ['/x/vc']);
  const logs = [];
  createThermalMonitor({ readThrottled: r2.readThrottled, readTemp: async () => '40000', onChange: () => {}, timers: fakeTimers(), log: (m) => logs.push(m) });
  await flush();
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^thermal: throttled not readable \(spawn ENOENT\)/);
});

test('default run: a real missing command rejects', async () => {
  const r = createDefaultReaders({ vcgencmd: '/nonexistent/revview-vcgencmd' });
  await assert.rejects(r.readThrottled());
});

test('env and option parsing', () => {
  assert.deepEqual(thermalEnv({}), {});
  assert.deepEqual(thermalEnv({ REVVIEW_THERMAL_TEMP: '', REVVIEW_THERMAL_THROTTLED: '' }), {});
  assert.deepEqual(
    thermalEnv({ REVVIEW_THERMAL_TEMP: '/a', REVVIEW_THERMAL_THROTTLED: '/b', REVVIEW_THERMAL_VCGENCMD: '/c' }),
    { tempPath: '/a', throttledPath: '/b', vcgencmd: '/c' },
  );
  assert.ok(!parseArgs([]).thermal);
  assert.equal(parseArgs(['--thermal']).thermal, true);
  assert.equal(parseArgs(['--netmon', '--thermal']).netmon, true);
});

test('server: --thermal marks reach the board, close() stops the monitor, HTTP RevviewThermal is refused', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thermal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tempFile = path.join(dir, 'temp');
  const thrFile = path.join(dir, 'throttled');
  fs.writeFileSync(tempFile, '45000\n');
  fs.writeFileSync(thrFile, 'throttled=0x0\n');
  const timers = fakeTimers();
  const clock = { t: 0 };
  const thermal = { ...createDefaultReaders({ tempPath: tempFile, throttledPath: thrFile }), timers, now: () => clock.t };
  const live = await startLiveServer({ port: 0, thermal });
  t.after(() => live.close());
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(live.state().hot, false);
  assert.equal(live.state().lowPower, false);
  fs.writeFileSync(thrFile, 'throttled=0x50005\n');
  clock.t = 1000;
  await timers.fire();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(live.state().hot, true);
  assert.equal(live.state().lowPower, true);
  assert.equal(timers.pending.size, 1);
  const res = await fetch(`${live.url}/event`, { method: 'POST', body: JSON.stringify({ hook_event_name: 'RevviewThermal', hot: false, lowPower: false }) });
  assert.equal(res.status, 403);
  assert.equal(live.state().hot, true);
  await live.close();
  assert.equal(timers.pending.size, 0);
});
