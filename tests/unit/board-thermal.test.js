import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, reduceBoard, boardView } from '../../src/state/index.js';

const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const thermal = (hot, lowPower) => ev('RevviewThermal', { hot, lowPower });
const S = { session_id: 'A', cwd: '/w/a' };

test('initial board: hot and lowPower are false', () => {
  const b = initialBoard();
  assert.equal(b.hot, false);
  assert.equal(b.lowPower, false);
  assert.equal(boardView(b).hot, false);
  assert.equal(boardView(b).lowPower, false);
});

test('RevviewThermal sets the two flags; repeats keep the reference', () => {
  const b0 = initialBoard();
  assert.equal(reduceBoard(b0, thermal(false, false)), b0);
  const hot = reduceBoard(b0, thermal(true, false));
  assert.deepEqual([hot.hot, hot.lowPower], [true, false]);
  assert.equal(reduceBoard(hot, thermal(true, false)), hot);
  const both = reduceBoard(hot, thermal(true, true));
  assert.deepEqual([both.hot, both.lowPower], [true, true]);
  const cool = reduceBoard(both, thermal(false, true));
  assert.deepEqual([cool.hot, cool.lowPower], [false, true]);
});

test('RevviewThermal: a non-boolean field is ignored, the other still applies', () => {
  const b = reduceBoard(initialBoard(), thermal(true, true));
  for (const bad of ['true', 1, 0, null, undefined, {}, []]) {
    assert.equal(reduceBoard(b, thermal(bad, bad)), b);
    const one = reduceBoard(b, thermal(false, bad));
    assert.deepEqual([one.hot, one.lowPower], [false, true]);
    const two = reduceBoard(b, thermal(bad, false));
    assert.deepEqual([two.hot, two.lowPower], [true, false]);
  }
  assert.equal(reduceBoard(b, ev('RevviewThermal')), b);
});

test('RevviewThermal never touches sessions, phase or focus and never makes a session', () => {
  const b0 = initialBoard();
  const b1 = reduceBoard(b0, thermal(true, true));
  assert.deepEqual(b1.sessions, {});
  assert.equal(b1.phase, b0.phase);
  assert.equal(b1.focus, b0.focus);
  assert.equal(b1.tick, b0.tick);
  const b2 = run([ev('SessionStart', S), ev('UserPromptSubmit', S)]);
  const b3 = reduceBoard(b2, thermal(true, false));
  assert.equal(b3.sessions, b2.sessions);
  assert.equal(b3.phase, b2.phase);
  assert.equal(b3.focus, b2.focus);
  assert.equal(b3.tick, b2.tick);
});

test('the flags survive RevviewStarting, session events and a session end', () => {
  const b = run([thermal(true, true), ev('SessionStart', S), ev('UserPromptSubmit', S), ev('RevviewStarting'), ev('SessionStart', S), ev('Stop', S), ev('SessionEnd', S)]);
  assert.deepEqual([b.hot, b.lowPower], [true, true]);
  const v = boardView(b);
  assert.deepEqual([v.hot, v.lowPower], [true, true]);
  const boot = run([thermal(true, false), ev('RevviewBootBegin'), ev('RevviewBootDone')]);
  assert.deepEqual([boot.hot, boot.lowPower], [true, false]);
});

test('boardView has the flags with and without a shown session', () => {
  const none = boardView(run([thermal(false, true)]));
  assert.deepEqual([none.hot, none.lowPower], [false, true]);
  const shown = boardView(run([ev('SessionStart', S), ev('UserPromptSubmit', S), thermal(true, false)]));
  assert.equal(shown.activity, 'working');
  assert.deepEqual([shown.hot, shown.lowPower], [true, false]);
});

test('old boards without the keys are valid (absent = false); bad values are rejected', () => {
  const old = { ...initialBoard(), phase: 'working' };
  delete old.hot;
  delete old.lowPower;
  assert.equal(boardView(old).activity, 'working');
  assert.equal(boardView(old).hot, false);
  const up = reduceBoard(old, thermal(true, false));
  assert.equal(up.hot, true);
  assert.equal(up.lowPower, false);
  assert.equal(reduceBoard(old, thermal(false, false)), old);
  for (const key of ['hot', 'lowPower']) {
    const bad = { ...initialBoard(), phase: 'working', [key]: 'yes' };
    assert.equal(boardView(bad).activity, 'unknown');
    assert.equal(boardView(bad).hot, false);
  }
});
