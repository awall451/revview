import test from 'node:test';
import assert from 'node:assert/strict';
import { lightsFrame, needsFlash, COLOURS, PATTERNS, MAX_BRIGHTNESS } from '../../src/lights/frames.js';

const BR = { day: 64, night: 8 };
const frame = (states, o = {}) => lightsFrame({ on: true, night: false, states, now: 0, leds: 8, brightness: BR, ...o });
const scaled = (rgb, cap) => rgb.map((c) => Math.round((c * cap) / 255));

test('colours are the day bar colours', () => {
  assert.deepEqual(COLOURS.working, [0x5e, 0xb1, 0xff]);
  assert.deepEqual(COLOURS.waiting, [0xc8, 0xa2, 0xff]);
  assert.deepEqual(COLOURS.failed, COLOURS.waiting);
  assert.deepEqual(COLOURS.permission, [0xff, 0xb0, 0x20]);
  assert.equal(MAX_BRIGHTNESS, 64);
});

test('steady states are lit at any time', () => {
  for (const s of ['working', 'done', 'starting', 'unknown']) {
    assert.equal(PATTERNS[s].half, null);
    for (const now of [0, 999, 1000, 1500, 123456789]) assert.deepEqual(frame([s], { now })[0], scaled(COLOURS[s], 64), s);
  }
});

test('slow flash: 1000 ms on, 1000 ms off, phase from absolute time', () => {
  for (const s of ['permission', 'asking', 'waiting']) {
    assert.deepEqual(frame([s], { now: 0 })[0], scaled(COLOURS[s], 64));
    assert.deepEqual(frame([s], { now: 999 })[0], scaled(COLOURS[s], 64));
    assert.deepEqual(frame([s], { now: 1000 })[0], [0, 0, 0]);
    assert.deepEqual(frame([s], { now: 1999 })[0], [0, 0, 0]);
    assert.deepEqual(frame([s], { now: 2000 })[0], scaled(COLOURS[s], 64));
  }
});

test('failed flashes at 2 Hz (250 on, 250 off)', () => {
  assert.notDeepEqual(frame(['failed'], { now: 249 })[0], [0, 0, 0]);
  assert.deepEqual(frame(['failed'], { now: 250 })[0], [0, 0, 0]);
  assert.deepEqual(frame(['failed'], { now: 499 })[0], [0, 0, 0]);
  assert.notDeepEqual(frame(['failed'], { now: 500 })[0], [0, 0, 0]);
});

test('all LEDs flash in step', () => {
  const f = frame(['permission', 'asking', 'waiting'], { now: 1500 });
  assert.deepEqual(f.slice(0, 3), [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
});

test('brightness caps the channel; night uses the night cap', () => {
  assert.deepEqual(frame(['working'])[0], [Math.round(0x5e * 64 / 255), Math.round(0xb1 * 64 / 255), 64]);
  assert.deepEqual(frame(['working'], { night: true })[0], [Math.round(0x5e * 8 / 255), Math.round(0xb1 * 8 / 255), 8]);
  for (const px of frame(['working', 'done', 'unknown'])) for (const c of px) assert.ok(Number.isInteger(c) && c >= 0 && c <= 64);
});

test('order, more states than leds, fewer, unknown string, off', () => {
  const f = frame(['working', 'done', 'bogus'], { leds: 4 });
  assert.equal(f.length, 4);
  assert.deepEqual(f[0], scaled(COLOURS.working, 64));
  assert.deepEqual(f[1], scaled(COLOURS.done, 64));
  assert.deepEqual(f[2], [0, 0, 0]);
  assert.deepEqual(f[3], [0, 0, 0]);
  const g = frame(['working', 'done', 'starting'], { leds: 2 });
  assert.equal(g.length, 2);
  assert.deepEqual(g[1], scaled(COLOURS.done, 64));
  assert.deepEqual(frame(['working'], { on: false }), Array.from({ length: 8 }, () => [0, 0, 0]));
  assert.equal(frame([]).length, 8);
});

test('needsFlash', () => {
  assert.equal(needsFlash(['working', 'done']), false);
  assert.equal(needsFlash(['working', 'failed']), true);
  assert.equal(needsFlash(['asking']), true);
  assert.equal(needsFlash([]), false);
});
