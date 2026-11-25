// The emulator's fixture list (Node side). The list IS the state core's VIEWS: one fixture per view, in that order, so tests, screenshots and the developer page iterate over the same names.
// Each fixture is emulator/fixtures/<id>.json: one state object exactly as the reducer emits it.
import fs from 'node:fs';
import { STATES, VIEWS } from '../src/state/states.js';

// FIXTURE_IDS = every view (reducer states plus the page-only `no-link`); REDUCER_FIXTURE_IDS are produced by the state core.
export const FIXTURE_IDS = VIEWS;
export const REDUCER_FIXTURE_IDS = STATES;

// Extra fixtures: not a view of their own, a state of one view with a flag set or another shape (`compacting`: WORKING while Claude
// compacts its context; `thermal`: WORKING on a hot box with a weak supply; `asking-plan`: ASKING with a plan to approve, the
// `asking` fixture is a question). Each has a recipe and a screenshot (screenshots.spec.js), but they are not iterated with the views.
export const EXTRA_FIXTURE_IDS = Object.freeze(['compacting', 'thermal', 'asking-plan', 'asking-choice', 'asking-terminal']);

export const FIXTURE_DIR = new URL('./fixtures/', import.meta.url);

export function fixtureUrl(id) {
  return new URL(`${id}.json`, FIXTURE_DIR);
}

export function loadFixture(id) {
  if (!FIXTURE_IDS.includes(id) && !EXTRA_FIXTURE_IDS.includes(id)) throw new Error(`unknown fixture: ${id}`);
  return JSON.parse(fs.readFileSync(fixtureUrl(id), 'utf8'));
}
