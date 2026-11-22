import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY_CODES, MODIFIER_KIND, BROWSER_CODES, keyName } from '../../src/input/keys.js';

test('function key codes match linux/input-event-codes.h', () => {
  const lo = [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88];
  lo.forEach((c, i) => assert.equal(KEY_CODES[`F${i + 1}`], c));
  for (let n = 13; n <= 24; n++) assert.equal(KEY_CODES[`F${n}`], 183 + n - 13);
  assert.equal(KEY_CODES.F24, 194);
});

test('modifier codes and kinds', () => {
  assert.deepEqual(
    [KEY_CODES.LEFTCTRL, KEY_CODES.LEFTSHIFT, KEY_CODES.LEFTALT, KEY_CODES.LEFTMETA,
      KEY_CODES.RIGHTCTRL, KEY_CODES.RIGHTSHIFT, KEY_CODES.RIGHTALT, KEY_CODES.RIGHTMETA],
    [29, 42, 56, 125, 97, 54, 100, 126]);
  assert.equal(MODIFIER_KIND[29], 'Ctrl');
  assert.equal(MODIFIER_KIND[97], 'Ctrl');
  assert.equal(MODIFIER_KIND[42], 'Shift');
  assert.equal(MODIFIER_KIND[54], 'Shift');
  assert.equal(MODIFIER_KIND[56], 'Alt');
  assert.equal(MODIFIER_KIND[100], 'Alt');
  assert.equal(MODIFIER_KIND[125], 'Meta');
  assert.equal(MODIFIER_KIND[126], 'Meta');
  assert.equal(MODIFIER_KIND[183], undefined);
});

test('objects are frozen', () => {
  assert.ok(Object.isFrozen(KEY_CODES));
  assert.ok(Object.isFrozen(MODIFIER_KIND));
  assert.ok(Object.isFrozen(BROWSER_CODES));
});

test('BROWSER_CODES maps KeyboardEvent.code to linux codes', () => {
  assert.equal(BROWSER_CODES.F1, 59);
  assert.equal(BROWSER_CODES.F11, 87);
  assert.equal(BROWSER_CODES.F13, 183);
  assert.equal(BROWSER_CODES.F24, 194);
  assert.equal(BROWSER_CODES.ShiftLeft, 42);
  assert.equal(BROWSER_CODES.ShiftRight, 54);
  assert.equal(BROWSER_CODES.ControlLeft, 29);
  assert.equal(BROWSER_CODES.ControlRight, 97);
  assert.equal(BROWSER_CODES.AltLeft, 56);
  assert.equal(BROWSER_CODES.AltRight, 100);
  assert.equal(BROWSER_CODES.MetaLeft, 125);
  assert.equal(BROWSER_CODES.MetaRight, 126);
});

test('keyName', () => {
  assert.equal(keyName(183), 'F13');
  assert.equal(keyName(59), 'F1');
  assert.equal(keyName(42), 'LEFTSHIFT');
  assert.equal(keyName(999), 'code:999');
});
