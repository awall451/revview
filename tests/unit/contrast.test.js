import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, luminance, contrastRatio } from '../../emulator/contrast.js';

test('parseColor reads rgb(), rgba() and the space form, and nothing else', () => {
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), { r: 1, g: 2, b: 3, a: 1 });
  assert.deepEqual(parseColor('rgba(1, 2, 3, 0.5)'), { r: 1, g: 2, b: 3, a: 0.5 });
  assert.deepEqual(parseColor('rgb(1 2 3 / 0)'), { r: 1, g: 2, b: 3, a: 0 });
  assert.equal(parseColor('#fff'), null);
  assert.equal(parseColor('red'), null);
  assert.equal(parseColor('rgb(1, 2)'), null);
});

test('luminance: black 0, white 1', () => {
  assert.equal(luminance('rgb(0, 0, 0)'), 0);
  assert.ok(Math.abs(luminance('rgb(255, 255, 255)') - 1) < 1e-12);
});

test('white on black is 21, in either order', () => {
  assert.ok(Math.abs(contrastRatio('rgb(255, 255, 255)', 'rgb(0, 0, 0)') - 21) < 1e-9);
  assert.ok(Math.abs(contrastRatio('rgb(0, 0, 0)', 'rgb(255, 255, 255)') - 21) < 1e-9);
});

test('#777 on white is about 4.48 (just under AA)', () => {
  const r = contrastRatio('rgb(119, 119, 119)', 'rgb(255, 255, 255)');
  assert.ok(r > 4.47 && r < 4.49, String(r));
});

test('the same colour has ratio 1; an unparsable colour throws', () => {
  assert.equal(contrastRatio('rgb(10, 20, 30)', 'rgb(10, 20, 30)'), 1);
  assert.throws(() => contrastRatio('nope', 'rgb(0, 0, 0)'));
});
