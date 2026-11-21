import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initialState, replay, isState } from '../../src/state/index.js';
import { FIXTURE_IDS, FIXTURE_DIR, fixtureUrl, loadFixture } from '../../emulator/fixtures.js';
import { RECIPES } from '../../emulator/fixtures/recipes.js';

// The emulator fixtures are the reducer's output for the event recipes in emulator/fixtures/recipes.js.
// Regenerate with REVVIEW_UPDATE_EXPECTED=1 npm run test:unit, then review the diff.
const UPDATE = process.env.REVVIEW_UPDATE_EXPECTED === '1';

// The type of every field as the reducer emits it (string-or-null fields may be either).
function shapeOf(state) {
  return Object.fromEntries(
    Object.entries(state).map(([k, v]) => [k, v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v]),
  );
}
const NULLABLE = ['repo', 'branch', 'tool', 'file', 'command', 'output'];

test('one fixture per state, no extras', () => {
  const files = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
  assert.deepEqual(files, [...FIXTURE_IDS].sort());
  assert.deepEqual(Object.keys(RECIPES).sort(), [...FIXTURE_IDS].sort());
});

for (const id of FIXTURE_IDS) {
  test(`fixture ${id} is the reducer's state for its recipe`, () => {
    const states = replay(RECIPES[id], initialState());
    const actual = states.at(-1);
    if (UPDATE) {
      fs.writeFileSync(fixtureUrl(id), JSON.stringify(actual, null, 2) + '\n');
      return;
    }
    assert.deepEqual(loadFixture(id), actual);
  });

  test(`fixture ${id} is a valid state of the state core`, () => {
    const fx = loadFixture(id);
    assert.equal(fx.view, id);
    assert.ok(isState(fx.view));
    assert.ok(isState(fx.activity) && !['offline', 'insert-key'].includes(fx.activity));
    const ref = initialState();
    assert.deepEqual(Object.keys(fx).sort(), Object.keys(ref).sort());
    const want = shapeOf(ref);
    const got = shapeOf(fx);
    for (const k of Object.keys(ref)) {
      if (NULLABLE.includes(k)) assert.ok(got[k] === 'null' || got[k] === 'string', `${id}.${k}: ${got[k]}`);
      else assert.equal(got[k], want[k], `${id}.${k}`);
    }
    assert.deepEqual(Object.keys(fx.diff).sort(), ['added', 'removed']);
    assert.ok(Number.isInteger(fx.diff.added) && Number.isInteger(fx.diff.removed));
    // view follows the reducer's overlay rule.
    assert.equal(fx.view, fx.locked ? 'insert-key' : fx.offline ? 'offline' : fx.activity);
    // Replaying the recipe once more from scratch lands on the same state (no hidden inputs).
    assert.deepEqual(replay(RECIPES[id]).at(-1), fx);
  });
}
