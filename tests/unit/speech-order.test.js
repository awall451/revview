// createReadAloud: speakOnStop as a function, beforeSpeak ordering; speaker.idle()
import { setImmediate as nodeSetImmediate } from 'node:timers';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadAloud, createSpeaker, createClosingMemo } from '../../src/speech/index.js';
import { initialBoard, reduceBoard } from '../../src/state/index.js';

const ENGINE = fileURLToPath(new URL('fixtures/speech/fake-engine.sh', import.meta.url));
const A = '11111111-1111-4111-8111-111111111111';
const ev = (name, extra = {}) => ({ hook_event_name: name, session_id: A, ...extra });
const board = (events) => events.reduce((b, e) => reduceBoard(b, e), initialBoard());
const STOP = ev('Stop', { last_assistant_message: 'All done.' });
const B0 = board([ev('SessionStart', { cwd: '/w' }), ev('UserPromptSubmit', { prompt: 'x' })]);

const make = (opts) => {
  const said = [];
  const speaker = { speak: async (t) => { said.push(t); return { spoken: true }; }, stop: async () => {}, close: async () => {} };
  return { said, ra: createReadAloud({ speaker, memo: createClosingMemo(), ...opts }) };
};

test('speakOnStop as a function is read at each event', async () => {
  let on = false;
  const { said, ra } = make({ speakOnStop: () => on });
  assert.equal(ra.onEvent(STOP, reduceBoard(B0, STOP), A), null);
  on = true;
  await ra.onEvent(STOP, reduceBoard(B0, STOP), A);
  assert.deepEqual(said, ['All done.']);
  on = false;
  assert.equal(ra.onEvent(STOP, reduceBoard(B0, STOP), A), null);
});

test('beforeSpeak is awaited before an automatic speech, not before speakFor', async () => {
  const order = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const speaker = { speak: async (t) => { order.push(`speak ${t}`); return { spoken: true }; } };
  const ra = createReadAloud({ speaker, memo: createClosingMemo(), speakOnStop: true, beforeSpeak: () => gate.then(() => order.push('before')) });
  const p = ra.onEvent(STOP, reduceBoard(B0, STOP), A);
  await new Promise((r) => nodeSetImmediate(r));
  assert.deepEqual(order, []);
  release();
  await p;
  assert.deepEqual(order, ['before', 'speak All done.']);
  order.length = 0;
  await ra.speakFor(reduceBoard(B0, STOP), A);
  assert.equal(order.length, 1);
});

test('an identical Stop posted again is not spoken again; any other event of the session resets it', async () => {
  const { said, ra } = make({ speakOnStop: true });
  const b = reduceBoard(B0, STOP);
  await ra.onEvent(STOP, b, A);
  assert.equal(ra.onEvent({ ...STOP }, b, A), null);
  assert.deepEqual(said, ['All done.']);
  const prompt = ev('UserPromptSubmit', { prompt: 'again' });
  ra.onEvent(prompt, reduceBoard(B0, prompt), A);
  await ra.onEvent(STOP, b, A);
  assert.deepEqual(said, ['All done.', 'All done.']);
  // a different Stop text is spoken; a read-aloud press is unaffected
  const other = ev('Stop', { last_assistant_message: 'Other.' });
  await ra.onEvent(other, reduceBoard(B0, other), A);
  assert.deepEqual(said, ['All done.', 'All done.', 'Other.']);
  await ra.speakFor(b, A);
  assert.equal(said.length, 4);
});

// fake timers: the 2 s wait before an automatic speech
const fakeTimers = () => {
  const pending = new Map();
  let n = 0;
  return {
    pending,
    setTimeout: (fn, ms) => { n += 1; pending.set(n, { fn, ms }); return n; },
    clearTimeout: (id) => { pending.delete(id); },
  };
};
const tick = () => new Promise((r) => nodeSetImmediate(r));

test('a beforeSpeak that never resolves: speech starts when the fake 2000 ms timer fires, which is then cleared', async () => {
  const timers = fakeTimers();
  const { said, ra } = make({ speakOnStop: true, beforeSpeak: () => new Promise(() => {}), timers });
  const p = ra.onEvent(STOP, reduceBoard(B0, STOP), A);
  await tick();
  assert.deepEqual(said, []);
  assert.equal(timers.pending.size, 1);
  const [[, t]] = [...timers.pending];
  assert.equal(t.ms, 2000);
  t.fn();
  await p;
  assert.deepEqual(said, ['All done.']);
  assert.equal(timers.pending.size, 0);
});

test('a beforeSpeak that resolves: speech at once, the timer is cleared', async () => {
  const timers = fakeTimers();
  const { said, ra } = make({ speakOnStop: true, beforeSpeak: async () => {}, timers });
  await ra.onEvent(STOP, reduceBoard(B0, STOP), A);
  assert.deepEqual(said, ['All done.']);
  assert.equal(timers.pending.size, 0);
});

test('a beforeSpeak that fails does not stop the speech', async () => {
  const { said, ra } = make({ speakOnStop: true, beforeSpeak: () => { throw new Error('x'); } });
  await ra.onEvent(STOP, reduceBoard(B0, STOP), A);
  assert.deepEqual(said, ['All done.']);
});

test('speaker.idle() resolves when nothing is spoken, and after the utterance ends', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-order-'));
  const speaker = createSpeaker({ engine: { name: 'f', stages: [[ENGINE, dir, '0.3']], needs: [] }, killWaitMs: 200 });
  try {
    await speaker.idle();
    await speaker.speak('hello');
    assert.equal(speaker.speaking(), true);
    const t0 = Date.now();
    await speaker.idle();
    assert.equal(speaker.speaking(), false);
    assert.ok(Date.now() - t0 >= 150);
  } finally {
    await speaker.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
