import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, reduceBoard, boardView } from '../../src/state/index.js';

const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const sounds = (mode) => ev('RevviewSounds', { mode });
const nav = (button, gesture = 'tap') => ev('RevviewNav', { button, gesture });
const toSettings = [nav('menu'), nav('down'), nav('down'), nav('press')];
const rowsOf = (b) => boardView(b).nav.rows;

test('initial board: sounds is null', () => {
  assert.equal(initialBoard().sounds, null);
});

test('RevviewSounds sets a valid mode; a bad mode keeps the same reference', () => {
  const b0 = initialBoard();
  for (const mode of ['off', 'cues', 'speech']) assert.equal(reduceBoard(b0, sounds(mode)).sounds, mode);
  const b1 = reduceBoard(b0, sounds('cues'));
  assert.equal(reduceBoard(b1, sounds('cues')), b1);
  for (const bad of ['loud', '', null, undefined, 1, true, ['cues'], { mode: 'cues' }]) {
    assert.equal(reduceBoard(b1, sounds(bad)), b1);
    assert.equal(reduceBoard(b0, sounds(bad)), b0);
  }
});

test('a board without the sounds field is valid and behaves as null', () => {
  const b = initialBoard();
  delete b.sounds;
  const r = run(toSettings, b);
  assert.equal(boardView(r).nav.kind, 'settings');
  assert.equal(rowsOf(r).length, 4);
});

test('settings: 4 rows and no change marker while sounds is null', () => {
  const v = boardView(run(toSettings)).nav;
  assert.equal(v.kind, 'settings');
  assert.equal(v.rows.length, 4);
  assert.ok(v.rows.every((r) => Object.keys(r).join() === 'label'));
});

test('settings: a 5th row with the label and the change marker for each mode', () => {
  const labels = { off: 'Sounds: off', cues: 'Sounds: cues', speech: 'Sounds: cues and speech' };
  for (const [mode, label] of Object.entries(labels)) {
    const rows = rowsOf(run([sounds(mode), ...toSettings]));
    assert.equal(rows.length, 5);
    assert.deepEqual(rows[4], { label, change: true });
    assert.ok(rows.slice(0, 4).every((r) => r.change === undefined));
  }
});

test('press on the Sounds row cycles cues -> speech -> off -> cues and keeps the screen open on it', () => {
  let b = run([sounds('cues'), ...toSettings, nav('down'), nav('down'), nav('down'), nav('down')]);
  assert.deepEqual(b.nav, { kind: 'settings', row: 4 });
  for (const next of ['speech', 'off', 'cues', 'speech']) {
    b = reduceBoard(b, nav('press'));
    assert.equal(b.sounds, next);
    assert.deepEqual(b.nav, { kind: 'settings', row: 4 });
    assert.equal(rowsOf(b)[4].change, true);
  }
});

test('press on rows 0..3 changes nothing', () => {
  let b = run([sounds('cues'), ...toSettings]);
  for (let row = 0; row < 4; row += 1) {
    assert.equal(b.nav.row, row);
    assert.equal(reduceBoard(b, nav('press')), b);
    b = reduceBoard(b, nav('down'));
  }
});

test('up and down reach row 4 only when the row exists', () => {
  const without = run([...toSettings, nav('down'), nav('down'), nav('down'), nav('down')]);
  assert.equal(without.nav.row, 3);
  const withRow = run([sounds('off'), ...toSettings, nav('down'), nav('down'), nav('down'), nav('down'), nav('down')]);
  assert.equal(withRow.nav.row, 4);
  assert.equal(reduceBoard(withRow, nav('up')).nav.row, 3);
});

test('back from settings returns to the menu row 2, also from the Sounds row', () => {
  const b = run([sounds('cues'), ...toSettings, nav('down'), nav('down'), nav('down'), nav('down'), nav('back')]);
  assert.deepEqual(b.nav, { kind: 'menu', row: 2 });
});
