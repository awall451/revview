// The question of CLAUDE ASKS never drops under the 4.0 mm size (src/view/type.js), whatever room is left.
import test from 'node:test';
import assert from 'node:assert/strict';
import { askFontPx, RANGE_MM } from '../../src/view/type.js';
import { mmToPx } from '../../src/view/panel.js';

const MIN = mmToPx(RANGE_MM.ask[0]) / 0.73; // the 4.0 mm cap height as a font size, for a cap ratio of 0.73

test('the state word size when it fits, else the largest that does', () => {
  assert.equal(askFontPx(55, 80, MIN), 55);
  assert.equal(askFontPx(55, 41.27, MIN), 41.2);
});

test('never under the 4.0 mm size, however little room is left (also zero or negative room)', () => {
  assert.ok(MIN > 0);
  for (const room of [MIN - 0.1, 10, 0, -50]) assert.equal(askFontPx(55, room, MIN), MIN);
});
