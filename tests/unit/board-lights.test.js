import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, reduceBoard, boardView } from '../../src/state/index.js';

const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const lights = (mode) => ev('RevviewLights', { mode });
const sounds = (mode) => ev('RevviewSounds', { mode });
const nav = (button, gesture = 'tap') => ev('RevviewNav', { button, gesture });
const toSettings = [nav('menu'), nav('down'), nav('down'), nav('press')];
const view = (b) => boardView(b).nav;
const down = (n) => Array.from({ length: n }, () => nav('down'));

test('initial board: lights is null; no row; Look stays the 5th row', () => {
  assert.equal(initialBoard().lights, null);
  const v = view(run(toSettings));
  assert.deepEqual(v.rows.map((r) => r.label).slice(4), ['Look: day']);
  assert.equal(v.rows.length, 5);
});

test('RevviewLights validation', () => {
  const b0 = initialBoard();
  assert.equal(reduceBoard(b0, lights('on')).lights, 'on');
  assert.equal(reduceBoard(b0, lights('off')).lights, 'off');
  const b1 = reduceBoard(b0, lights('on'));
  assert.equal(reduceBoard(b1, lights('on')), b1);
  for (const bad of ['loud', '', null, undefined, 1, true]) assert.equal(reduceBoard(b1, lights(bad)), b1);
  // a valid board is kept by the reducer; an invalid one falls back to the initial board
  const kept = (lightsValue) => reduceBoard({ ...b0, look: 'night', lights: lightsValue }, ev('Noop')).look;
  for (const ok of ['off', 'on', null, undefined]) assert.equal(kept(ok), 'night');
  assert.equal(kept('dim'), 'day');
});

test('lights row sits before Look with sounds null', () => {
  const b = run([...toSettings, lights('off')]);
  assert.deepEqual(view(b).rows.slice(4), [{ label: 'Lights: off', change: true }, { label: 'Look: day', change: true }]);
});

test('lights row sits after Sounds and before Look', () => {
  const b = run([...toSettings, sounds('cues'), lights('on')]);
  assert.deepEqual(view(b).rows.slice(4).map((r) => r.label), ['Sounds: cues', 'Lights: on', 'Look: day']);
});

test('press toggles lights (sounds null) and keeps nav; Look still toggles', () => {
  let b = run([...toSettings, lights('off'), ...down(4), nav('press')]);
  assert.equal(b.lights, 'on');
  assert.deepEqual(b.nav, { kind: 'settings', row: 4 });
  b = run([nav('press')], b);
  assert.equal(b.lights, 'off');
  b = run([nav('down'), nav('press')], b);
  assert.equal(b.look, 'night');
  assert.equal(b.lights, 'off');
});

test('with sounds set: sounds press, lights press, look press hit the right rows', () => {
  let b = run([...toSettings, sounds('off'), lights('off'), ...down(4), nav('press')]);
  assert.equal(b.sounds, 'cues');
  assert.equal(b.lights, 'off');
  b = run([nav('down'), nav('press')], b);
  assert.equal(b.lights, 'on');
  assert.equal(b.sounds, 'cues');
  b = run([nav('down'), nav('press')], b);
  assert.equal(b.look, 'night');
  assert.equal(b.lights, 'on');
});
