import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseProcDevices, parseKeyBitmap, matchDevice } from '../../src/input/devices.js';

// Synthetic fixture, see fixtures/input/README.md
const text = readFileSync(new URL('./fixtures/input/proc-bus-input-devices.txt', import.meta.url), 'utf8');
const list = parseProcDevices(text);
const F13_F24 = Array.from({ length: 12 }, (_, i) => 183 + i);
const dongle = { name: null, vendor: '1d50', product: '615e' };

test('parses blocks', () => {
  const kb = list.find((d) => d.event === 'event0');
  assert.equal(kb.name, 'AT Translated Set 2 keyboard');
  assert.equal(kb.vendor, '0001');
  assert.equal(kb.phys, 'isa0060/serio0/input0');
  assert.deepEqual(kb.handlers, ['sysrq', 'kbd', 'leds', 'event0']);
  assert.ok(list.some((d) => d.event === 'event5'));
  assert.ok(list.some((d) => d.event === null));
});

test('key bitmap: single bit 183 is word 2 bit 55, printed first of three', () => {
  // bit 183 = 2*64 + 55; 2^55 = 0x80000000000000 (8 then 13 zeros); words print most significant first.
  const k = parseKeyBitmap('80000000000000 0 0');
  assert.deepEqual([...k], [183]);
  // Assumes 64-bit kernel words (unsigned long); the Pi target is arm64.
  assert.deepEqual([...parseKeyBitmap('3')], [0, 1]);
  assert.deepEqual([...parseKeyBitmap('1 0')], [64]);
  assert.deepEqual([...parseKeyBitmap('7 ff80000000000000 0 0')].sort((a, b) => a - b), F13_F24);
  assert.equal(parseKeyBitmap('zz 1').size, 1);
  assert.equal(parseKeyBitmap('').size, 0);
});

test('keys parsed per node; missing KEY line gives no keys', () => {
  const cc = list.find((d) => d.event === 'event4');
  assert.ok(!F13_F24.some((c) => cc.keys.has(c)));
  const kb = list.find((d) => d.event === 'event3');
  assert.ok(F13_F24.every((c) => kb.keys.has(c)));
  assert.equal(list.find((d) => d.vendor === '046d').keys.size, 0);
});

test('malformed input never throws', () => {
  for (const t of ['', 'garbage', null, undefined, 'I: \nN\nH:\n\n\n\nP:', 'I: Bus=1\nB: KEY=', 'I: Bus=1\nB: KEY=zz qq']) {
    assert.ok(Array.isArray(parseProcDevices(t)));
  }
});

test('dongle: consumer-control kbd node listed first is skipped when keys are given', () => {
  assert.equal(matchDevice(list, dongle, F13_F24), '/dev/input/event3');
  assert.equal(matchDevice(list, { ...dongle, name: 'ZMK Dongle' }, F13_F24), '/dev/input/event3');
  // without keys the first kbd node wins (the consumer node)
  assert.equal(matchDevice(list, dongle), '/dev/input/event4');
  assert.equal(matchDevice(list, { name: 'ZMK Dongle Consumer Control', vendor: null, product: null }), '/dev/input/event4');
});

test('keys: one supported code is enough; no keys known means no match', () => {
  assert.equal(matchDevice(list, dongle, [999, 190]), '/dev/input/event3');
  assert.equal(matchDevice(list, dongle, [999]), null);
  assert.equal(matchDevice(list, { name: null, vendor: '046d', product: null }, [183]), null);
});

test('all-null criteria never match (would grab any keyboard)', () => {
  assert.equal(matchDevice(list, { name: null, vendor: null, product: null }), null);
  assert.equal(matchDevice(list, { name: null, vendor: null, product: null }, F13_F24), null);
  assert.equal(matchDevice(list, {}), null);
});

test('exact name, no match, kbd without event node', () => {
  assert.equal(matchDevice(list, { name: 'ZMK', vendor: null, product: null }), null);
  assert.equal(matchDevice(list, { name: null, vendor: 'ffff', product: null }), null);
  assert.equal(matchDevice(list, { name: null, vendor: '046d', product: 'c52b' }), null);
  assert.equal(matchDevice([], dongle), null);
});
