// The emulator's fixture list (Node side). The list IS the state core's STATES: one fixture per view
// state, in that order, so tests, screenshots and the developer page iterate over the same names.
// Each fixture is emulator/fixtures/<id>.json: one state object exactly as the reducer emits it.
import fs from 'node:fs';
import { STATES } from '../src/state/states.js';

export const FIXTURE_IDS = STATES;

export const FIXTURE_DIR = new URL('./fixtures/', import.meta.url);

export function fixtureUrl(id) {
  return new URL(`${id}.json`, FIXTURE_DIR);
}

export function loadFixture(id) {
  if (!FIXTURE_IDS.includes(id)) throw new Error(`unknown fixture: ${id}`);
  return JSON.parse(fs.readFileSync(fixtureUrl(id), 'utf8'));
}
