import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  initialBoard, boardView, replayView, isState, STATES, PAGE_ONLY_VIEWS, VIEWS,
} from '../../src/state/index.js';
import { FIXTURE_IDS, EXTRA_FIXTURE_IDS, REDUCER_FIXTURE_IDS, FIXTURE_DIR, fixtureUrl, loadFixture } from '../../emulator/fixtures.js';
import { RECIPES } from '../../emulator/fixtures/recipes.js';

// The emulator fixtures are the board's view (replayView) for the event recipes in
// emulator/fixtures/recipes.js; `no-link` is page-only and has no recipe.
// Regenerate with REVVIEW_UPDATE_EXPECTED=1 npm run test:unit, then review the diff.
const UPDATE = process.env.REVVIEW_UPDATE_EXPECTED === '1';

// The type of every field as the board view emits it (string-or-null fields may be either).
function shapeOf(state) {
  return Object.fromEntries(
    Object.entries(state).map(([k, v]) => [k, v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v]),
  );
}
const NULLABLE = ['repo', 'branch', 'tool', 'file', 'command', 'output'];

test('one fixture per view, no extras', () => {
  const files = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
  assert.deepEqual(files, [...FIXTURE_IDS, ...EXTRA_FIXTURE_IDS].sort());
  assert.deepEqual([...FIXTURE_IDS], [...VIEWS]);
  assert.deepEqual([...REDUCER_FIXTURE_IDS], [...STATES]);
  assert.deepEqual(Object.keys(RECIPES).sort(), [...REDUCER_FIXTURE_IDS, ...EXTRA_FIXTURE_IDS].sort());
});

test('fixture no-link is exactly the page-only view', () => {
  assert.deepEqual(loadFixture('no-link'), { view: 'no-link' });
  assert.ok(PAGE_ONLY_VIEWS.includes('no-link'));
  assert.ok(!('no-link' in RECIPES));
  assert.equal(isState('no-link'), false);
});

// the extra fixtures are a state of one view (see EXTRA_FIXTURE_IDS), so they get the view's validity checks
const VIEW_OF = { compacting: 'working' };
for (const id of [...REDUCER_FIXTURE_IDS, ...EXTRA_FIXTURE_IDS]) {
  test(`fixture ${id} is the board view for its recipe`, () => {
    const actual = replayView(RECIPES[id], initialBoard()).at(-1) ?? boardView(initialBoard());
    if (UPDATE) {
      fs.writeFileSync(fixtureUrl(id), JSON.stringify(actual, null, 2) + '\n');
      return;
    }
    assert.deepEqual(loadFixture(id), actual);
  });

  test(`fixture ${id} is a valid view of the state core`, () => {
    const fx = loadFixture(id);
    assert.equal(fx.view, VIEW_OF[id] ?? id);
    assert.ok(isState(fx.view));
    if (EXTRA_FIXTURE_IDS.includes(id)) assert.equal(fx.compacting, true);
    assert.ok(isState(fx.activity) && !['offline', 'insert-key'].includes(fx.activity));
    const ref = boardView(initialBoard());
    assert.deepEqual(Object.keys(fx).sort(), Object.keys(ref).sort());
    const want = shapeOf(ref);
    const got = shapeOf(fx);
    for (const k of Object.keys(ref)) {
      if (NULLABLE.includes(k)) assert.ok(got[k] === 'null' || got[k] === 'string', `${id}.${k}: ${got[k]}`);
      else assert.equal(got[k], want[k], `${id}.${k}`);
    }
    assert.deepEqual(Object.keys(fx.diff).sort(), ['added', 'removed']);
    assert.ok(Number.isInteger(fx.diff.added) && Number.isInteger(fx.diff.removed));
    assert.ok(Number.isInteger(fx.others) && fx.others >= 0);
    assert.equal(typeof fx.diffIncomplete, 'boolean');
    // view follows the overlay rule.
    assert.equal(fx.view, fx.locked ? 'insert-key' : fx.offline ? 'offline' : fx.activity);
    // Replaying the recipe once more from scratch lands on the same view (no hidden inputs).
    assert.deepEqual(replayView(RECIPES[id]).at(-1) ?? boardView(initialBoard()), fx);
  });
}
