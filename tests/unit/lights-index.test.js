import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, reduceBoard } from '../../src/state/index.js';
import { createLights } from '../../src/lights/index.js';

const A = '11111111-1111-4111-8111-111111111111';
const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const BR = { day: 64, night: 8 };
const LIGHTS_ON = ev('RevviewLights', { mode: 'on' });
const working = () => run([LIGHTS_ON, ev('SessionStart', { session_id: A, cwd: '/w/a' }), ev('UserPromptSubmit', { session_id: A, prompt: 'x' })]);

function setup() {
  const shown = [];
  let closed = 0;
  const driver = { show: (f) => shown.push(f), close: async () => { closed += 1; } };
  const list = [];
  const timers = { list, setTimeout(fn, ms) { const t = { fn, ms, cleared: false }; list.push(t); return t; }, clearTimeout(t) { t.cleared = true; } };
  const clock = { now: 0 };
  const logs = [];
  const lights = createLights({ driver, leds: 3, brightness: BR, clock: () => clock.now, timers, log: (m) => logs.push(m) });
  const live = () => timers.list.filter((t) => !t.cleared && !t.fired);
  const fire = () => { const t = live().at(-1); t.fired = true; t.fn(); };
  return { lights, shown, timers, clock, logs, live, fire, closedCount: () => closed };
}

test('off: dark frame, no timer', () => {
  const s = setup();
  const b = initialBoard();
  s.lights.observe(null, b);
  s.lights.observe(b, b);
  assert.equal(s.live().length, 0);
  assert.deepEqual(s.lights.current(), [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  assert.ok(s.shown.length <= 1);
});

test('steady state: frame shown once (dedupe), no timer; logs on/off', () => {
  const s = setup();
  const b = working();
  s.lights.observe(initialBoard(), b);
  s.lights.observe(b, b);
  assert.equal(s.shown.length, 1);
  assert.deepEqual(s.shown[0][0], [Math.round(0x5e * 64 / 255), Math.round(0xb1 * 64 / 255), 64]);
  assert.deepEqual(s.shown[0][1], [0, 0, 0]);
  assert.equal(s.live().length, 0);
  assert.deepEqual(s.logs, ['lights: on']);
  const off = reduceBoard(b, ev('RevviewLights', { mode: 'off' }));
  s.lights.observe(b, off);
  assert.deepEqual(s.logs, ['lights: on', 'lights: off']);
  assert.deepEqual(s.shown.at(-1), [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
});

test('flashing: one 250 ms timer, ticks follow the clock, stops when no flash is left', () => {
  const s = setup();
  const b = reduceBoard(working(), ev('StopFailure', { session_id: A, error: 'x' }));
  s.lights.observe(null, b);
  assert.equal(s.live().length, 1);
  assert.equal(s.live()[0].ms, 250);
  const lit = s.shown.length;
  s.clock.now = 250;
  s.fire();
  assert.equal(s.shown.length, lit + 1);
  assert.deepEqual(s.lights.current()[0], [0, 0, 0]);
  assert.equal(s.live().length, 1);
  s.clock.now = 400;
  s.fire(); // same phase: no new frame
  assert.equal(s.shown.length, lit + 1);
  s.clock.now = 500;
  s.fire();
  assert.equal(s.shown.length, lit + 2);
  s.lights.observe(b, reduceBoard(b, ev('UserPromptSubmit', { session_id: A, prompt: 'again' })));
  assert.equal(s.live().length, 0);
});

test('close: dark frame, then driver.close, no timer left, observe ignored', async () => {
  const s = setup();
  const b = reduceBoard(working(), ev('StopFailure', { session_id: A, error: 'x' }));
  s.lights.observe(null, b);
  await s.lights.close();
  assert.deepEqual(s.shown.at(-1), [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  assert.equal(s.closedCount(), 1);
  assert.equal(s.live().length, 0);
  const n = s.shown.length;
  s.lights.observe(b, working());
  assert.equal(s.shown.length, n);
  assert.equal(s.live().length, 0);
});

test('a throwing driver never throws out; logged once', async () => {
  const logs = [];
  const driver = { show() { throw new Error('bad'); }, close: async () => { throw new Error('bad2'); } };
  const lights = createLights({ driver, leds: 2, brightness: BR, log: (m) => logs.push(m), timers: { setTimeout: () => 0, clearTimeout() {} } });
  lights.observe(null, working());
  lights.observe(null, reduceBoard(working(), ev('Stop', { session_id: A })));
  await lights.close();
  assert.equal(logs.filter((m) => /bad/.test(m)).length, 1);
});
