import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_SIZE, EVENT_SIZE_32, EV_SYN, EV_KEY, EV_MSC, SYN_REPORT, SYN_DROPPED,
  createEventParser, encodeEvent,
} from '../../src/input/evdev.js';

// All byte streams here are CONSTRUCTED by encodeEvent, not recorded from a device.
const press = (value) => Buffer.concat([
  encodeEvent({ sec: 1700000000, usec: 123456, type: EV_MSC, code: 4, value: 0x70068 }),
  encodeEvent({ sec: 1700000000, usec: 123456, type: EV_KEY, code: 183, value }),
  encodeEvent({ sec: 1700000000, usec: 123456, type: EV_SYN, code: SYN_REPORT, value: 0 }),
]);

test('constants', () => {
  assert.equal(EVENT_SIZE, 24);
  assert.equal(EVENT_SIZE_32, 16);
  assert.equal(SYN_DROPPED, 3);
});

test('encode: 24 bytes little-endian layout', () => {
  const b = encodeEvent({ sec: 5, usec: 6, type: 1, code: 183, value: 1 });
  assert.equal(b.length, 24);
  assert.equal(b.readBigInt64LE(0), 5n);
  assert.equal(b.readBigInt64LE(8), 6n);
  assert.equal(b.readUInt16LE(16), 1);
  assert.equal(b.readUInt16LE(18), 183);
  assert.equal(b.readInt32LE(20), 1);
});

test('press, repeat, release parse in one chunk', () => {
  const p = createEventParser();
  const ev = p.push(Buffer.concat([press(1), press(2), press(0)]));
  assert.equal(ev.length, 9);
  assert.deepEqual(ev[1], { sec: 1700000000, usec: 123456, type: EV_KEY, code: 183, value: 1 });
  assert.equal(ev[0].type, EV_MSC);
  assert.equal(ev[4].value, 2);
  assert.equal(ev[7].value, 0);
  assert.equal(ev[8].type, EV_SYN);
});

test('split at every offset gives the same events', () => {
  const all = Buffer.concat([press(1), press(2), press(0)]);
  const want = createEventParser().push(all);
  for (let i = 0; i <= all.length; i++) {
    const p = createEventParser();
    const got = [...p.push(all.subarray(0, i)), ...p.push(all.subarray(i))];
    assert.deepEqual(got, want, `split at ${i}`);
  }
});

test('one byte at a time', () => {
  const all = press(1);
  const p = createEventParser();
  const got = [];
  for (const byte of all) got.push(...p.push(Buffer.from([byte])));
  assert.equal(got.length, 3);
  assert.equal(got[1].code, 183);
});

test('16-byte layout (armhf)', () => {
  const b = encodeEvent({ sec: 9, usec: 8, type: EV_KEY, code: 184, value: 1 }, EVENT_SIZE_32);
  assert.equal(b.length, 16);
  assert.equal(b.readInt32LE(0), 9);
  const p = createEventParser({ size: EVENT_SIZE_32 });
  const got = [...p.push(b.subarray(0, 7)), ...p.push(b.subarray(7))];
  assert.deepEqual(got, [{ sec: 9, usec: 8, type: EV_KEY, code: 184, value: 1 }]);
});

test('negative value round trip', () => {
  const p = createEventParser();
  const [e] = p.push(encodeEvent({ type: 2, code: 8, value: -1 }));
  assert.equal(e.value, -1);
});
