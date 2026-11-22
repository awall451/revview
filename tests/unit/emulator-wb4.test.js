import test from 'node:test';
import assert from 'node:assert/strict';
import { WB4_IDS, RECIPES, wb4State } from '../../emulator/wb4/recipes.js';

// Each WB4 look of the emulator is the real board's view for a recipe (emulator/wb4/recipes.js); these tests check that
// each recipe really produces the fields its look is meant to show.

test('every look has a recipe and a state, and the state carries the new keys', () => {
  assert.equal(WB4_IDS.length, 15);
  for (const id of WB4_IDS) {
    const s = wb4State(id);
    for (const k of ['voice', 'position', 'elsewhere', 'nav']) assert.ok(k in s, `${id} has ${k}`);
    assert.ok(RECIPES[id].length > 3, id);
  }
});

test('mic and position: voice here, 2 of 3', () => {
  const s = wb4State('mic-position');
  assert.equal(s.voice, 'here');
  assert.deepEqual(s.position, { index: 2, count: 3 });
  assert.equal(s.nav, null);
});

test('shown is not the target: not-owned, none, no-session', () => {
  assert.equal(wb4State('not-target').voice, 'not-owned');
  assert.equal(wb4State('none').voice, 'none');
  const ns = wb4State('no-session');
  assert.equal(ns.voice, 'no-session');
  assert.deepEqual(ns.position, { index: 1, count: 1 });
});

test('elsewhere: a prompt in another session, the shown one is not asking', () => {
  const s = wb4State('elsewhere');
  assert.equal(s.elsewhere, 1);
  assert.equal(s.others, 2);
  assert.notEqual(s.view, 'permission');
});

test('list: 3 sessions, highlight on the second row, the selected session is the target', () => {
  const { nav } = wb4State('list');
  assert.equal(nav.kind, 'list');
  assert.equal(nav.rows.length, 3);
  assert.equal(nav.row, 1);
  assert.deepEqual(nav.rows.map((r) => r.target), [true, false, false]);
  assert.deepEqual(nav.rows.map((r) => r.state), ['waiting', 'working', 'done']);
});

test('list-long: 8 sessions with long names, one without a repo, the window has to scroll', () => {
  const { nav } = wb4State('list-long');
  assert.equal(nav.rows.length, 8);
  assert.ok(nav.rows.some((r) => r.label.length > 50));
  assert.ok(nav.rows.some((r) => r.label === ''));
  assert.equal(nav.row, 5);
});

test('menu, projects, new session and settings', () => {
  assert.deepEqual(wb4State('menu').nav.rows.map((r) => r.label), ['New session', 'Projects', 'Settings']);
  assert.equal(wb4State('menu').nav.row, 1);
  const p = wb4State('projects').nav;
  assert.equal(p.kind, 'projects');
  assert.ok(p.rows.some((r) => r.label.length > 60));
  assert.equal(wb4State('new-session').nav.kind, 'new');
  assert.equal(wb4State('settings').nav.kind, 'settings');
  assert.equal(wb4State('settings').nav.rows.length, 4);
});

test('worst band: needs the 9+ hint, a prompt elsewhere, not-owned, position 12/13, no buttons', () => {
  for (const id of ['worst-band', 'worst-band-permission']) {
    const s = wb4State(id);
    assert.equal(s.others, 12);
    assert.equal(s.elsewhere, 1);
    assert.equal(s.voice, 'not-owned');
    assert.deepEqual(s.position, { index: 12, count: 13 });
    assert.equal(s.buttons, 'missing');
  }
  assert.equal(wb4State('worst-band-permission').view, 'permission');
});

test('denied-done and allowed: the answer is in the view, the command is the one answered', () => {
  const d = wb4State('denied-done');
  assert.equal(d.view, 'done');
  assert.equal(d.answered, 'deny');
  assert.ok(d.command);
  const a = wb4State('allowed');
  assert.equal(a.view, 'working');
  assert.equal(a.answered, 'allow');
  assert.equal(a.command, d.command);
});
