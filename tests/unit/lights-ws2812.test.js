import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodeWs2812, createSpiDriver, createNullDriver, helperArgv, SPI_HZ, RESET_BYTES } from '../../src/lights/ws2812.js';

const hx = (b) => b.toString('hex');

test('encoding: hand-worked bytes', () => {
  assert.equal(SPI_HZ, 2400000);
  assert.equal(RESET_BYTES, 90);
  // 0x00: eight 0 bits = 100 x8 = 100100100100100100100100 = 92 49 24
  assert.equal(hx(encodeWs2812([[0, 0, 0]]).subarray(0, 9)), '924924924924924924');
  // 0xFF: eight 1 bits = 110 x8 = 110110110110110110110110 = DB 6D B6 (the G byte comes first)
  assert.equal(hx(encodeWs2812([[0, 0xff, 0]]).subarray(0, 3)), 'db6db6');
  // 0xA5 = 10100101 -> 110 100 110 100 100 110 100 110 = 1101 0011 0100 1001 1010 0110 = D3 49 A6
  assert.equal(hx(encodeWs2812([[0, 0xa5, 0]]).subarray(0, 3)), 'd349a6');
});

test('encoding: G first, then R, then B; reset tail', () => {
  const red = encodeWs2812([[0xff, 0, 0]]);
  assert.equal(red.length, 9 + 90);
  assert.equal(hx(red.subarray(0, 9)), '924924' + 'db6db6' + '924924');
  assert.ok(red.subarray(9).every((b) => b === 0));
  assert.equal(hx(encodeWs2812([[0, 0xff, 0]]).subarray(0, 9)), 'db6db6' + '924924' + '924924');
  assert.equal(hx(encodeWs2812([[0, 0, 0xff]]).subarray(0, 9)), '924924' + '924924' + 'db6db6');
  assert.equal(encodeWs2812([[1, 2, 3], [4, 5, 6]]).length, 18 + 90);
});

function fakeSpawn() {
  const made = [];
  const spawn = (cmd, args, opts) => {
    const c = new EventEmitter();
    c.cmd = cmd; c.args = args; c.opts = opts;
    c.written = []; c.ended = false; c.killed = [];
    c.stdin = Object.assign(new EventEmitter(), { write: (s) => c.written.push(s), end: () => { c.ended = true; } });
    c.stderr = new EventEmitter();
    c.kill = (sig) => c.killed.push(sig);
    made.push(c);
    return c;
  };
  return { spawn, made };
}
const fakeTimers = () => {
  const list = [];
  return { list, setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; list.push(t); return t; }, clearTimeout: (t) => { t.cleared = true; } };
};
const mk = (extra = {}) => {
  const f = fakeSpawn();
  const logs = [];
  const timers = fakeTimers();
  const d = createSpiDriver({ argv: ['py', 'h.py', '--x'], spawn: f.spawn, log: (m) => logs.push(m), timers, leds: 2, ...extra });
  return { ...f, logs, timers, d };
};
const RED = [[255, 0, 0], [0, 0, 0]];

test('driver: lazy spawn, shell false, one hex line per frame', () => {
  const { d, made } = mk();
  assert.equal(made.length, 0);
  d.show(RED);
  d.show(RED);
  assert.equal(made.length, 1);
  assert.equal(made[0].cmd, 'py');
  assert.deepEqual(made[0].args, ['h.py', '--x']);
  assert.equal(made[0].opts.shell, false);
  assert.deepEqual(made[0].opts.stdio, ['pipe', 'ignore', 'pipe']);
  assert.deepEqual(made[0].written, [`${hx(encodeWs2812(RED))}\n`, `${hx(encodeWs2812(RED))}\n`]);
});

test('driver: close writes a dark frame, ends stdin, resolves on exit', async () => {
  const { d, made, logs, timers } = mk();
  d.show(RED);
  const p = d.close();
  assert.equal(made[0].written.at(-1), `${hx(encodeWs2812([[0, 0, 0], [0, 0, 0]]))}\n`);
  assert.equal(made[0].ended, true);
  made[0].emit('exit', 0, null);
  await p;
  assert.deepEqual(logs, []);
  assert.deepEqual(made[0].killed, []);
  assert.ok(timers.list.every((t) => t.cleared));
});

test('driver: close kills after closeWaitMs', async () => {
  const { d, made, timers } = mk({ closeWaitMs: 777 });
  d.show(RED);
  const p = d.close();
  const t = timers.list.at(-1);
  assert.equal(t.ms, 777);
  t.fn();
  await p;
  assert.deepEqual(made[0].killed, ['SIGKILL']);
});

test('driver: close without a child resolves, nothing spawned', async () => {
  const { d, made } = mk();
  await d.close();
  assert.equal(made.length, 0);
});

test('driver: spawn error -> one log line, no respawn', () => {
  const { d, made, logs } = mk();
  d.show(RED);
  made[0].emit('error', Object.assign(new Error('x'), { code: 'ENOENT' }));
  made[0].emit('error', new Error('again'));
  d.show(RED);
  assert.equal(made.length, 1);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^lights: LED driver stopped \(.*ENOENT.*\); the LEDs stay off until the server restarts$/);
});

test('driver: a throwing spawn is tolerated', () => {
  const logs = [];
  const d = createSpiDriver({ argv: ['py'], spawn: () => { throw new Error('boom'); }, log: (m) => logs.push(m), leds: 1 });
  d.show([[1, 1, 1]]);
  d.show([[1, 1, 1]]);
  assert.equal(logs.length, 1);
});

test('driver: helper exit -> one log line with stderr, no respawn', () => {
  const { d, made, logs } = mk();
  d.show(RED);
  made[0].stderr.emit('data', Buffer.from('no spidev module (install python3-spidev)\nmore\n'));
  made[0].emit('exit', 3, null);
  d.show(RED);
  assert.equal(made.length, 1);
  assert.deepEqual(logs, ['lights: LED driver stopped (exit 3: no spidev module (install python3-spidev)); the LEDs stay off until the server restarts']);
});

test('driver: stdin EPIPE -> one log line', () => {
  const { d, made, logs } = mk();
  d.show(RED);
  made[0].stdin.emit('error', Object.assign(new Error('x'), { code: 'EPIPE' }));
  made[0].emit('exit', 1, null);
  d.show(RED);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /EPIPE/);
});

test('driver: null driver and helperArgv', async () => {
  const n = createNullDriver();
  n.show(RED);
  await n.close();
  const a = helperArgv({ device: '/dev/spidev0.0', leds: 8 });
  assert.equal(a[0], 'python3');
  assert.ok(path.isAbsolute(a[1]) && a[1].endsWith('spi-helper.py') && fs.existsSync(a[1]));
  assert.deepEqual(a.slice(2), ['--device', '/dev/spidev0.0', '--leds', '8', '--hz', '2400000']);
});

test('spi-helper.py compiles', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-py-'));
  try {
    const r = spawnSync('python3', ['-I', '-c', 'import sys, py_compile; py_compile.compile(sys.argv[1], cfile=sys.argv[2], doraise=True)', helperArgv({ device: 'x', leds: 1 })[1], path.join(dir, 'h.pyc')], { encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 0, r.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
