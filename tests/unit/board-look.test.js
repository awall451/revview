import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initialBoard, reduceBoard, boardView } from '../../src/state/index.js';
import { createActions } from '../../src/sessions/index.js';

const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const sounds = (mode) => ev('RevviewSounds', { mode });
const look = (mode) => ev('RevviewLook', { mode });
const clock = (night) => ev('RevviewLookClock', { night });
const nav = (button, gesture = 'tap') => ev('RevviewNav', { button, gesture });
const toSettings = [nav('menu'), nav('down'), nav('down'), nav('press')];
const rowsOf = (b) => boardView(b).nav.rows;
const labels = (b) => rowsOf(b).map((r) => r.label);
const lastLabel = (b) => labels(b).at(-1);

test('initial board: look day, lookNight false; the view says day', () => {
  const b = initialBoard();
  assert.equal(b.look, 'day');
  assert.equal(b.lookNight, false);
  assert.equal(boardView(b).look, 'day');
});

test('a board without the look fields (or null) is valid and shows day', () => {
  for (const mut of [(b) => { delete b.look; delete b.lookNight; }, (b) => { b.look = null; }]) {
    const b = initialBoard();
    mut(b);
    assert.equal(boardView(b).look, 'day');
    assert.equal(boardView(run(toSettings, b)).nav.kind, 'settings');
  }
});

test('an invalid look on a board is replaced as a whole (the view still says day)', () => {
  const b = { ...initialBoard(), look: 'dusk' };
  assert.equal(boardView(b).look, 'day');
  assert.equal(boardView({ ...initialBoard(), lookNight: 'yes' }).look, 'day');
});

test('RevviewLook sets a valid mode; a bad mode keeps the same reference', () => {
  const b0 = initialBoard();
  for (const mode of ['day', 'night', 'auto']) assert.equal(reduceBoard(b0, look(mode)).look, mode);
  const b1 = reduceBoard(b0, look('night'));
  assert.equal(reduceBoard(b1, look('night')), b1);
  for (const bad of ['dusk', '', null, undefined, 1, true, ['night'], { mode: 'night' }]) {
    assert.equal(reduceBoard(b1, look(bad)), b1);
    assert.equal(reduceBoard(b0, look(bad)), b0);
  }
});

test('RevviewLookClock sets lookNight; a non-boolean keeps the same reference', () => {
  const b0 = initialBoard();
  const b1 = reduceBoard(b0, clock(true));
  assert.equal(b1.lookNight, true);
  assert.equal(reduceBoard(b1, clock(true)), b1);
  assert.equal(reduceBoard(b1, clock(false)).lookNight, false);
  for (const bad of ['true', 1, null, undefined]) assert.equal(reduceBoard(b1, clock(bad)), b1);
});

test('the view look is the effective look in every mode', () => {
  const at = (mode, night) => boardView(run([look(mode), clock(night)])).look;
  assert.equal(at('day', false), 'day');
  assert.equal(at('day', true), 'day');
  assert.equal(at('night', false), 'night');
  assert.equal(at('night', true), 'night');
  assert.equal(at('auto', false), 'day');
  assert.equal(at('auto', true), 'night');
});

test('boardView.look is in every view shape: no session, session, asking, nav open, locked', () => {
  const sid = '11111111-1111-4111-8111-111111111111';
  const start = ev('SessionStart', { session_id: sid, cwd: '/tmp/r', source: 'startup', model: 'm' });
  const prompt = ev('UserPromptSubmit', { session_id: sid, cwd: '/tmp/r', prompt: 'hi' });
  const shapes = {
    empty: [],
    started: [start],
    working: [start, prompt],
    locked: [ev('RevviewDataLock', { locked: true })],
    offline: [start, ev('RevviewNetwork', { online: false })],
    menu: [nav('menu')],
    booting: [ev('RevviewBootBegin')],
  };
  for (const [name, events] of Object.entries(shapes)) {
    for (const [mode, night, want] of [['day', false, 'day'], ['night', false, 'night'], ['auto', true, 'night'], ['auto', false, 'day']]) {
      assert.equal(boardView(run([...events, look(mode), clock(night)])).look, want, `${name} ${mode} ${night}`);
    }
  }
});

test('settings: a Look row is always last, with and without the Sounds row', () => {
  const without = run(toSettings);
  assert.equal(rowsOf(without).length, 5);
  assert.equal(lastLabel(without), 'Look: day');
  assert.deepEqual(rowsOf(without).at(-1), { label: 'Look: day', change: true });
  const withS = run([sounds('cues'), ...toSettings]);
  assert.equal(rowsOf(withS).length, 6);
  assert.equal(labels(withS).at(-2), 'Sounds: cues');
  assert.equal(lastLabel(withS), 'Look: day');
});

test('settings: Look labels', () => {
  const l = (events) => lastLabel(run([...events, ...toSettings]));
  assert.equal(l([look('day')]), 'Look: day');
  assert.equal(l([look('night')]), 'Look: night');
  assert.equal(l([look('auto'), clock(true)]), 'Look: auto, night now');
  assert.equal(l([look('auto'), clock(false)]), 'Look: auto, day now');
});

for (const withSounds of [false, true]) {
  test(`settings: a press on the Look row cycles day, night, auto, day and keeps the row (sounds row ${withSounds ? 'present' : 'absent'})`, () => {
    let b = run([...(withSounds ? [sounds('cues')] : []), ...toSettings]);
    const rows = rowsOf(b).length;
    for (let i = 0; i < rows; i++) b = reduceBoard(b, nav('down'));
    assert.equal(boardView(b).nav.row, rows - 1);
    const seen = [];
    for (let i = 0; i < 4; i++) {
      b = reduceBoard(b, nav('press'));
      seen.push(b.look);
      assert.equal(b.nav.kind, 'settings');
      assert.equal(boardView(b).nav.row, rows - 1);
    }
    assert.deepEqual(seen, ['night', 'auto', 'day', 'night']);
    if (withSounds) assert.equal(b.sounds, 'cues'); // the Look press does not touch sounds
  });
}

test('settings: a press on the Sounds row still cycles sounds and leaves the look', () => {
  let b = run([sounds('cues'), ...toSettings, nav('down'), nav('down'), nav('down'), nav('down')]);
  assert.equal(boardView(b).nav.row, 4);
  b = reduceBoard(b, nav('press'));
  assert.equal(b.sounds, 'speech');
  assert.equal(b.look, 'day');
});

test('menu hold toggles the effective look: day, night, auto at night, auto by day', () => {
  const hold = (events) => reduceBoard(run(events), nav('menu', 'hold'));
  assert.equal(hold([look('day')]).look, 'night');
  assert.equal(hold([look('night')]).look, 'day');
  assert.equal(hold([look('auto'), clock(true)]).look, 'day');
  assert.equal(hold([look('auto'), clock(false)]).look, 'night');
  assert.equal(boardView(hold([look('auto'), clock(true)])).look, 'day');
  assert.equal(boardView(hold([look('auto'), clock(false)])).look, 'night');
  // twice goes back to what is shown now
  assert.equal(boardView(reduceBoard(hold([look('day')]), nav('menu', 'hold'))).look, 'day');
});

test('menu hold does not open, close or move a list or menu', () => {
  const b0 = initialBoard();
  assert.equal(reduceBoard(b0, nav('menu', 'hold')).nav, null);
  for (const open of [[nav('menu')], [nav('down')], toSettings, [nav('menu'), nav('down'), nav('press')]]) {
    const b = run(open);
    const held = reduceBoard(b, nav('menu', 'hold'));
    assert.deepEqual(held.nav, b.nav);
    assert.equal(held.selected, b.selected);
    assert.equal(held.look, 'night');
  }
});

test('menu tap is unchanged: opens the menu, closes an open menu', () => {
  const b = reduceBoard(initialBoard(), nav('menu'));
  assert.deepEqual(b.nav, { kind: 'menu', row: 0 });
  assert.equal(reduceBoard(b, nav('menu', 'hold')).look, 'night');
  assert.equal(reduceBoard(b, nav('menu')).nav, null);
  assert.equal(reduceBoard(initialBoard(), nav('menu')).look, 'day');
});

test('other holds and long holds of menu do nothing to the look', () => {
  const b = initialBoard();
  assert.equal(reduceBoard(b, nav('menu', 'long-hold')).look, 'day');
  assert.equal(reduceBoard(b, nav('up', 'hold')).look, 'day');
});

// ---- the menu hold through createActions: it never answers, never hides the prompt ---------------------------

const SID = '7de4c978-52e0-4e1a-ad17-826801362ee2';
const sev = (name, extra = {}) => ({ session_id: SID, hook_event_name: name, ...extra });
const selectSid = { hook_event_name: 'RevviewSelect', session_id: SID };
const askFixture = fs.readFileSync(new URL('../../fixtures/sessions/ask-question.jsonl', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));

function permissionBoard() {
  const b = run([sev('UserPromptSubmit', { prompt: 'x' }), selectSid]);
  return run([
    sev('PreToolUse', { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'ls' } }),
    sev('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } }),
  ], b);
}
const askingBoard = () => run([selectSid], run(askFixture.slice(0, 4).map((e) => ({ ...e, session_id: SID }))));

for (const [name, makeBoard, view] of [['a permission prompt', permissionBoard, 'permission'], ['CLAUDE ASKS', askingBoard, 'asking']]) {
  test(`actions: a menu hold under ${name} flips the look, answers nothing and keeps the prompt shown`, async () => {
    let board = makeBoard();
    assert.equal(boardView(board).view, view);
    const answers = [];
    const sent = [];
    const a = createActions({
      runner: { target: async () => ({ id: SID, window: '@1' }), send: async (k) => { sent.push(k); return { sent: true, id: SID, window: '@1' }; } },
      registry: { answer: (kind) => { answers.push(kind); return { ok: true }; }, check: () => ({ ok: true }) },
      getBoard: () => board, apply: (e) => { board = reduceBoard(board, e); }, log: () => {}, clock: () => 0,
    });
    assert.equal(boardView(board).look, 'day');
    await a.handle({ button: 'menu', gesture: 'hold', source: 'device', dropped: false });
    assert.deepEqual(answers, []);
    assert.deepEqual(sent, []);
    assert.equal(boardView(board).look, 'night');
    assert.equal(boardView(board).view, view);
    assert.equal(boardView(board).nav, null);
  });
}
