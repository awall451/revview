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
