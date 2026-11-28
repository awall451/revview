// A burst of board changes gives one cue, for where it ends (fake timers, no real waits).
import { setImmediate as nodeSetImmediate } from 'node:timers';
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, reduceBoard } from '../../src/state/index.js';
import { createSounds, cueFor } from '../../src/sounds/index.js';

const A = '11111111-1111-4111-8111-111111111111';
const ev = (name, extra = {}) => ({ hook_event_name: name, session_id: A, ...extra });
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const PERM = ev('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } });
const WORKING = [ev('SessionStart', { cwd: '/w/a' }), { hook_event_name: 'RevviewSounds', mode: 'cues' }, ev('UserPromptSubmit', { prompt: 'go' })];

function fakeTimers() {
  let n = 0;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => { const id = ++n; pending.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { pending.delete(id); },
    // fires the pending timer(s) of delay ms
    fire: (ms) => { for (const [id, t] of [...pending]) if (t.ms === ms) { pending.delete(id); t.fn(); } },
    count: () => pending.size,
  };
}
function make(extra = {}) {
  const timers = fakeTimers();
  const played = [];
  const logs = [];
  const idleGate = { p: Promise.resolve() };
  const player = { play: (c) => { played.push(c); return { played: true }; }, idle: () => idleGate.p, close: () => {} };
  const sounds = createSounds({ player, log: (m) => logs.push(m), timers, ...extra });
  return { sounds, timers, played, logs, idleGate };
}
// feeds the events one by one, each a change observed
const feed = (s, b, events) => events.reduce((acc, e) => { const n = reduceBoard(acc, e); if (n !== acc) s.observe(acc, n); return n; }, b);

test('two changes 10 ms apart: nothing at once, one cue after the settle', () => {
  const { sounds, timers, played } = make();
  const b0 = run(WORKING);
  feed(sounds, b0, [PERM, ev('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }), ev('Stop')]);
  assert.deepEqual(played, []);
  timers.fire(250);
  assert.deepEqual(played, ['done']);
  assert.equal(timers.count(), 0);
});

test('needs -> working -> done in one burst gives done; done -> working -> done gives nothing', () => {
  const a = make();
  const b0 = run(WORKING);
  const needs = reduceBoard(b0, PERM);
  a.sounds.observe(b0, needs);
  a.timers.fire(250);
  assert.deepEqual(a.played, ['needs']);
  feed(a.sounds, needs, [ev('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }), ev('Stop')]);
  a.timers.fire(250);
  assert.deepEqual(a.played, ['needs', 'done']);

  const done = run([ev('Stop')], b0);
  const b = make();
  feed(b.sounds, done, [ev('UserPromptSubmit', { prompt: 'again' }), ev('Stop')]);
  b.timers.fire(250);
  assert.deepEqual(b.played, []);
  assert.equal(cueFor(done, done), null);
});

test('each change extends the settle timer; a long stream gives a cue at maxMs', () => {
  const { sounds, timers, played } = make();
  const b0 = run(WORKING);
  let b = b0;
  const stopped = reduceBoard(b0, ev('Stop'));
  sounds.observe(b0, stopped);
  b = stopped;
  for (let i = 0; i < 20; i++) { // working -> done flips keep the burst open
    const w = reduceBoard(b, ev('UserPromptSubmit', { prompt: `p${i}` }));
    sounds.observe(b, w);
    const d = reduceBoard(w, ev('Stop'));
    sounds.observe(w, d);
    b = d;
    assert.equal(timers.count(), 2, 'one settle timer and one max timer');
  }
  assert.deepEqual(played, []);
  timers.fire(2000);
  assert.deepEqual(played, ['done']);
  assert.equal(timers.count(), 0);
});

test('the mode turned off during a burst: no cue', () => {
  const { sounds, timers, played } = make();
  const b0 = run(WORKING);
  const stopped = reduceBoard(b0, ev('Stop'));
  sounds.observe(b0, stopped);
  const off = reduceBoard(stopped, { hook_event_name: 'RevviewSounds', mode: 'off' });
  sounds.observe(stopped, off);
  timers.fire(250);
  assert.deepEqual(played, []);
  assert.equal(timers.count(), 0);
});

test('mode off from the start: no timer at all; the log line stays per change', () => {
  const { sounds, timers, played, logs } = make();
  const off = run([ev('SessionStart', { cwd: '/w/a' }), { hook_event_name: 'RevviewSounds', mode: 'off' }, ev('UserPromptSubmit', { prompt: 'go' })]);
  const stopped = reduceBoard(off, ev('Stop'));
  sounds.observe(off, stopped);
  assert.equal(timers.count(), 0);
  assert.deepEqual(played, []);
  assert.deepEqual(logs, []);
  const on = reduceBoard(stopped, { hook_event_name: 'RevviewSounds', mode: 'cues' });
  const speech = reduceBoard(on, { hook_event_name: 'RevviewSounds', mode: 'speech' });
  sounds.observe(stopped, on);
  sounds.observe(on, speech);
  assert.deepEqual(logs, ['sounds: cues', 'sounds: speech']);
});

test('idle() resolves only after the settled cue was played and the player is idle', async () => {
  const { sounds, timers, played, idleGate } = make();
  const b0 = run(WORKING);
  sounds.observe(b0, reduceBoard(b0, ev('Stop')));
  let resolved = false;
  const p = sounds.idle().then(() => { resolved = true; });
  await new Promise((r) => nodeSetImmediate(r));
  assert.equal(resolved, false, 'the burst has not settled');
  let release;
  idleGate.p = new Promise((r) => { release = r; });
  timers.fire(250);
  assert.deepEqual(played, ['done']);
  await new Promise((r) => nodeSetImmediate(r));
  assert.equal(resolved, false, 'the cue is still playing');
  release();
  await p;
  assert.equal(resolved, true);
});

test('idle() with no burst goes straight to the player', async () => {
  const { sounds } = make();
  await sounds.idle();
});

test('close() leaves no timer, plays nothing and frees an idle() waiter', async () => {
  const { sounds, timers, played } = make();
  const b0 = run(WORKING);
  sounds.observe(b0, reduceBoard(b0, ev('Stop')));
  assert.equal(timers.count(), 2);
  const p = sounds.idle();
  sounds.close();
  assert.equal(timers.count(), 0);
  await p;
  timers.fire(250);
  timers.fire(2000);
  assert.deepEqual(played, []);
  sounds.observe(b0, reduceBoard(b0, ev('Stop')));
  assert.equal(timers.count(), 0, 'closed: no new burst');
});

test('settleMs 0 (or less): no burst, the cue plays at once and no timer exists', () => {
  for (const settleMs of [0, -1]) {
    const { sounds, timers, played } = make({ settleMs });
    const b0 = run(WORKING);
    const hit = sounds.observe(b0, reduceBoard(b0, ev('Stop')));
    assert.deepEqual(hit, { cue: 'done', session: A });
    assert.deepEqual(played, ['done']);
    assert.equal(timers.count(), 0);
    const off = reduceBoard(b0, { hook_event_name: 'RevviewSounds', mode: 'off' });
    sounds.observe(b0, reduceBoard(off, ev('Stop')));
    assert.deepEqual(played, ['done'], 'mode off: nothing');
  }
});

test('settleMs and maxMs are options', () => {
  const { sounds, timers, played } = make({ settleMs: 5, maxMs: 9 });
  const b0 = run(WORKING);
  sounds.observe(b0, reduceBoard(b0, ev('Stop')));
  timers.fire(5);
  assert.deepEqual(played, ['done']);
});
