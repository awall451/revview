import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSpeaker } from '../../src/speech/speaker.js';
import { createReadAloud } from '../../src/speech/index.js';
import { initialBoard, reduceBoard } from '../../src/state/index.js';

const FAKE = fileURLToPathOf('fixtures/speech/fake-engine.sh');
function fileURLToPathOf(rel) { return path.join(path.dirname(new URL(import.meta.url).pathname), rel); }
const T = { timeout: 10000 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await sleep(20);
  }
}
// a zombie (killed, not yet reaped by whoever adopted it) counts as dead
function alive(pid) {
  try {
    process.kill(pid, 0);
  } catch (e) {
    if (e.code === 'ESRCH') return false;
  }
  try {
    return !/^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return false;
  }
}
const read = (dir, prefix) => fs.readdirSync(dir).filter((f) => f.startsWith(`${prefix}.`) && !f.startsWith('.tmp'));
const readOne = (dir, prefix, n = 1) => (read(dir, prefix).length >= n ? read(dir, prefix).sort().map((f) => fs.readFileSync(path.join(dir, f), 'utf8')) : null);
const pids = (dir, prefix) => read(dir, prefix).map((f) => Number(f.split('.')[1]));
const childPids = (dir) => read(dir, 'child').map((f) => Number(fs.readFileSync(path.join(dir, f), 'utf8')));

async function withDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-speaker-'));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const engineOf = (stages) => ({ name: 'fake', stages, needs: [] });
const fake = (dir, ...rest) => [FAKE, dir, ...rest.map(String)];

async function withSpeaker(opts, fn) {
  const logs = [];
  const speaker = createSpeaker({ log: (m) => logs.push(m), killWaitMs: 300, ...opts });
  try {
    await fn(speaker, logs);
  } finally {
    await speaker.close();
  }
}

test('the text arrives on stdin exactly and is not in the arguments', T, () => withDir((dir) => withSpeaker({ engine: engineOf([fake(dir)]) }, async (s) => {
  const r = await s.speak('Hello there.');
  assert.deepEqual(r, { spoken: true });
  assert.equal(s.speaking(), true);
  const [text] = await until(() => readOne(dir, 'text'), 'the text');
  assert.equal(text, 'Hello there.\n');
  const [argv] = readOne(dir, 'argv');
  assert.ok(!argv.includes('Hello'));
})));

test('hostile text arrives verbatim on stdin; the arguments do not change', T, () => withDir((dir) => withSpeaker({ engine: engineOf([fake(dir)]) }, async (s) => {
  const nasty = "-rf ; rm -rf / $(touch pwned) `id` '\" && x";
  await s.speak(nasty);
  const [text] = await until(() => readOne(dir, 'text'), 'the text');
  assert.equal(text, `${nasty}\n`);
  const [argv] = readOne(dir, 'argv');
  assert.equal(argv, `${dir}\n`);
  assert.ok(!fs.existsSync('pwned'));
})));

test('stop kills the engine and the processes it started', T, () => withDir((dir) => withSpeaker({ engine: engineOf([fake(dir)]) }, async (s) => {
  await s.speak('x');
  await until(() => readOne(dir, 'text'), 'the text');
  const [pid] = pids(dir, 'pid');
  const [kid] = childPids(dir);
  assert.ok(alive(pid) && alive(kid));
  await s.stop();
  assert.equal(s.speaking(), false);
  await until(() => !alive(pid) && !alive(kid), 'both dead');
  await s.stop(); // nothing speaks: returns at once
})));

test('stop works when called many times at once', T, () => withDir((dir) => withSpeaker({ engine: engineOf([fake(dir)]) }, async (s) => {
  await s.speak('x');
  await until(() => readOne(dir, 'text'), 'the text');
  await Promise.all([s.stop(), s.stop(), s.stop()]);
  await until(() => pids(dir, 'pid').every((p) => !alive(p)), 'dead');
  assert.equal(s.speaking(), false);
})));

test('a second speak ends the first one; only the second lives', T, () => withDir((dir) => withSpeaker({ engine: engineOf([fake(dir)]) }, async (s) => {
  await s.speak('first');
  await until(() => readOne(dir, 'text'), 'first text');
  const firstPid = pids(dir, 'pid')[0];
  const firstKid = childPids(dir)[0];
  await s.speak('second');
  assert.ok(!alive(firstPid), 'the first engine was dead when the second speak returned');
  await until(() => readOne(dir, 'text', 2), 'second text');
  await until(() => !alive(firstKid), 'first child dead');
  const second = pids(dir, 'pid').find((p) => p !== firstPid);
  assert.ok(alive(second));
  assert.equal(pids(dir, 'pid').filter(alive).length, 1);
})));

test('quick speak, stop, speak never leaves two alive', T, () => withDir((dir) => withSpeaker({ engine: engineOf([fake(dir)]) }, async (s) => {
  const a = s.speak('one');
  const b = s.stop();
  const c = s.speak('two');
  const d = s.speak('three');
  await Promise.all([a, b, c, d]);
  await until(() => readOne(dir, 'text', 1), 'a text');
  await sleep(300);
  assert.equal(pids(dir, 'pid').filter(alive).length, 1);
  await s.stop();
  await until(() => pids(dir, 'pid').every((p) => !alive(p)), 'all dead');
})));

test('a pipeline passes the text through and stop kills every stage', T, () => withDir((dir) => withSpeaker({ engine: engineOf([['/bin/cat'], fake(dir)]) }, async (s) => {
  await s.speak('through the pipe');
  const [text] = await until(() => readOne(dir, 'text'), 'the text');
  assert.equal(text, 'through the pipe\n');
  const [pid] = pids(dir, 'pid');
  const [kid] = childPids(dir);
  await s.stop();
  await until(() => !alive(pid) && !alive(kid), 'dead');
  assert.equal(s.speaking(), false);
})));

test('a missing program does not throw or crash; nothing is speaking soon', T, () => withDir((dir) => withSpeaker({ engine: engineOf([['/nonexistent/x']]) }, async (s, logs) => {
  const r = await s.speak('hi');
  assert.equal(typeof r.spoken, 'boolean');
  await until(() => !s.speaking(), 'not speaking');
  assert.ok(logs.length >= 1);
  assert.deepEqual(fs.readdirSync(dir), []);
  // a pipeline whose second program is missing: the first is cleaned up too
  const s2 = createSpeaker({ engine: engineOf([fake(dir), ['/nonexistent/y']]), log: () => {}, killWaitMs: 300 });
  try {
    await s2.speak('hi');
    await until(() => !s2.speaking(), 'not speaking (pipeline)');
    await until(() => pids(dir, 'pid').every((p) => !alive(p)) && childPids(dir).every((p) => !alive(p)), 'dead');
  } finally {
    await s2.close();
  }
})));

test('a program that cannot be run (no permission) does not throw', T, () => withDir((dir) => withSpeaker({ engine: engineOf([[path.join(dir, 'not-executable')]]) }, async (s) => {
  fs.writeFileSync(path.join(dir, 'not-executable'), 'x');
  await s.speak('hi');
  await until(() => !s.speaking(), 'not speaking');
})));

test('a non-zero exit is logged and ends the utterance', T, () => withDir((dir) => withSpeaker({ engine: engineOf([fake(dir, 0, 3)]) }, async (s, logs) => {
  await s.speak('hi');
  await until(() => !s.speaking(), 'not speaking');
  assert.deepEqual(logs.filter((l) => l.includes('exited')), ['read aloud: fake exited with 3']);
})));

test('a program that closes stdin early does not crash node', T, () => withDir((dir) => withSpeaker({ engine: engineOf([['/bin/true']]) }, async (s) => {
  await s.speak('x'.repeat(200000));
  await until(() => !s.speaking(), 'not speaking');
  assert.equal(dir.length > 0, true);
})));

test('close stops speech and refuses later speaks', T, () => withDir(async (dir) => {
  const s = createSpeaker({ engine: engineOf([fake(dir)]), killWaitMs: 300 });
  await s.speak('x');
  await until(() => readOne(dir, 'text'), 'the text');
  const [pid] = pids(dir, 'pid');
  await s.close();
  await until(() => !alive(pid), 'dead');
  assert.deepEqual(await s.speak('again'), { spoken: false, reason: 'closed' });
  assert.equal(s.speaking(), false);
}));

test('no engine: nothing is spawned', T, async () => {
  let spawned = 0;
  const s = createSpeaker({ engine: null, spawn: () => { spawned++; } });
  assert.deepEqual(await s.speak('x'), { spoken: false, reason: 'no engine' });
  assert.equal(spawned, 0);
  await s.stop();
  await s.close();
});

test('spawn is called with an argument list, detached, and without a shell', T, async () => {
  const calls = [];
  const spawn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); throw new Error('boom'); };
  const logs = [];
  const s = createSpeaker({ engine: engineOf([['/usr/bin/say', '-v', 'x y']]), spawn, log: (m) => logs.push(m) });
  const r = await s.speak('secret words');
  assert.equal(r.spoken, false);
  assert.equal(calls[0].cmd, '/usr/bin/say');
  assert.deepEqual(calls[0].args, ['-v', 'x y']);
  assert.equal(calls[0].opts.shell, false);
  assert.equal(calls[0].opts.detached, true);
  assert.ok(logs.length >= 1 && logs.every((l) => !l.includes('secret words')));
  assert.equal(s.speaking(), false);
});

// the read-aloud controller, with a speaker that only records
const SID = '7de4c978-52e0-4e1a-ad17-826801362ee2';
const OTHER = '11111111-52e0-4e1a-ad17-826801362ee2';
const ev = (name, extra = {}, id = SID) => ({ session_id: id, hook_event_name: name, ...extra });

function setup({ speakOnStop = false } = {}) {
  const calls = [];
  const speaker = { speak: async (t) => { calls.push(['speak', t]); return { spoken: true }; }, stop: async () => { calls.push(['stop']); }, close: async () => { calls.push(['close']); } };
  const memoEvents = [];
  const memoStore = new Map();
  const memo = {
    note: (e) => { memoEvents.push(e); if (e.hook_event_name === 'Stop') memoStore.set(e.session_id, e.last_assistant_message); },
    get: (id) => memoStore.get(id) ?? null,
  };
  return { calls, memoEvents, ra: createReadAloud({ speaker, memo, speakOnStop, log: () => {} }) };
}
const boardAfter = (...events) => events.reduce((b, e) => reduceBoard(b, e), initialBoard());

test('read aloud: textFor says the pending prompt, else the closing words, else nothing to read', T, () => {
  const { ra } = setup();
  const working = boardAfter(ev('UserPromptSubmit', { prompt: 'x' }));
  assert.equal(ra.textFor(working, SID), 'Nothing to read.');
  ra.onEvent(ev('Stop', { last_assistant_message: 'I fixed `it` in src/a.js. Tests pass.' }), working, null);
  assert.equal(ra.textFor(working, SID), 'I fixed in. Tests pass.');
  const cmd = { command: 'ls' };
  const asking = boardAfter(
    ev('UserPromptSubmit', { prompt: 'x' }),
    ev('PreToolUse', { tool_name: 'Bash', tool_use_id: 't1', tool_input: cmd }),
    ev('PermissionRequest', { tool_name: 'Bash', tool_input: cmd }),
  );
  assert.equal(ra.textFor(asking, SID), 'Permission: Bash ls');
  assert.equal(ra.textFor(asking, OTHER), 'Nothing to read.');
});

test('read aloud: speakFor returns the speaker result and the text; stop and close pass through', T, async () => {
  const { ra, calls } = setup();
  const b = boardAfter(ev('UserPromptSubmit', { prompt: 'x' }));
  assert.deepEqual(await ra.speakFor(b, SID), { spoken: true, text: 'Nothing to read.' });
  await ra.stop();
  await ra.close();
  assert.deepEqual(calls, [['speak', 'Nothing to read.'], ['stop'], ['close']]);
});

test('read aloud: with speakOnStop off a Stop is only remembered', T, async () => {
  const { ra, calls, memoEvents } = setup({ speakOnStop: false });
  const stop = ev('Stop', { last_assistant_message: 'All done.' });
  const b = boardAfter(ev('UserPromptSubmit', { prompt: 'x' }), stop);
  await ra.onEvent(stop, b, SID);
  assert.equal(memoEvents.length, 1);
  assert.deepEqual(calls, []);
});

test('read aloud: with speakOnStop on, the selected session is read at its Stop', T, async () => {
  const { ra, calls } = setup({ speakOnStop: true });
  const stop = ev('Stop', { last_assistant_message: 'All done. See `x`.' });
  const b = boardAfter(ev('UserPromptSubmit', { prompt: 'x' }), stop);
  assert.equal(b.sessions[SID].state.activity, 'done');
  await ra.onEvent(stop, b, SID);
  assert.deepEqual(calls, [['speak', 'All done. See.']]);
});

test('read aloud: another session, no selection, nothing to say, or still working: silent', T, async () => {
  const { ra, calls } = setup({ speakOnStop: true });
  const stop = ev('Stop', { last_assistant_message: 'All done.' });
  const b = boardAfter(ev('UserPromptSubmit', { prompt: 'x' }), stop);
  await ra.onEvent(stop, b, OTHER);
  await ra.onEvent(stop, b, null);
  const code = ev('Stop', { last_assistant_message: '```\ncode only\n```' });
  await ra.onEvent(code, boardAfter(ev('UserPromptSubmit', { prompt: 'x' }), code), SID);
  const working = boardAfter(ev('UserPromptSubmit', { prompt: 'x' }));
  await ra.onEvent(stop, working, SID);
  assert.deepEqual(calls, []);
});

test('read aloud: onEvent never throws', T, async () => {
  const speaker = { speak: async () => { throw new Error('x'); }, stop: async () => {}, close: async () => {} };
  const ra = createReadAloud({ speaker, memo: { note: () => { throw new Error('y'); }, get: () => { throw new Error('z'); } }, speakOnStop: true });
  for (const e of [null, 5, {}, ev('Stop', { last_assistant_message: 'a.' })]) await ra.onEvent(e, initialBoard(), SID);
  await ra.onEvent(null, null, null);
  assert.equal(typeof ra.textFor(null, SID), 'string');
});
