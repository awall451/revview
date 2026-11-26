import { setImmediate as nodeSetImmediate } from 'node:timers';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCuePlayer } from '../../src/sounds/player.js';

const FAKE = fileURLToPath(new URL('fixtures/sounds/fake-player.sh', import.meta.url));
const T = { timeout: 15000 };
const tick = () => new Promise((r) => nodeSetImmediate(r));
const flush = async () => { for (let i = 0; i < 5; i++) await tick(); };

// timers by hand: fire(ms) runs every pending timer whose delay is ms
function fakeTimers() {
  let n = 0;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => { const id = ++n; pending.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { pending.delete(id); },
    fire: (ms) => { for (const [id, t] of [...pending]) if (t.ms === ms) { pending.delete(id); t.fn(); } },
    count: () => pending.size,
  };
}

// spawn that records its calls and hands out fake children (no pid: a kill goes to child.kill)
function fakeSpawn() {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.kill = (sig) => { child.killedWith = sig; };
    child.unref = () => {};
    calls.push({ cmd, args, opts, child });
    return child;
  };
  return { spawn, calls };
}

const make = (extra = {}) => {
  const timers = fakeTimers();
  const { spawn, calls } = fakeSpawn();
  const logs = [];
  const player = createCuePlayer({ argv: ['aplay', '-q'], dir: '/cues', spawn, timers, log: (m) => logs.push(m), ...extra });
  return { player, timers, calls, logs };
};

test('plays the file path as the last argument, no shell, own process group, stdio ignored', async () => {
  const { player, calls } = make();
  assert.deepEqual(player.play('needs'), { played: true });
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'aplay');
  assert.deepEqual(calls[0].args, ['-q', '/cues/needs.wav']);
  assert.equal(calls[0].opts.shell, false);
  assert.equal(calls[0].opts.detached, true);
  assert.equal(calls[0].opts.stdio, 'ignore');
  calls[0].child.emit('exit', 0, null);
  await player.idle();
});

test('argv null: silent, nothing started', async () => {
  const { player, calls } = make({ argv: null });
  assert.deepEqual(player.play('done'), { played: false, reason: 'no player' });
  await player.idle();
  assert.equal(calls.length, 0);
});

test('queue of one: three quick plays give two spawns, the last wins, no overlap', async () => {
  const { player, calls } = make();
  player.play('needs');
  player.play('done');
  player.play('failed');
  await flush();
  assert.equal(calls.length, 1);
  calls[0].child.emit('exit', 0, null);
  await flush();
  assert.equal(calls.length, 2);
  assert.match(calls[1].args.at(-1), /failed\.wav$/);
  const idle = player.idle();
  calls[1].child.emit('exit', 0, null);
  await idle;
  assert.equal(calls.length, 2);
});

test('a waiting selected cue is never replaced by other; other is replaced by anything', async () => {
  const { player, calls } = make();
  player.play('other');
  player.play('done');
  assert.equal(player.play('other').played, false);
  await flush();
  calls[0].child.emit('exit', 0, null);
  await flush();
  assert.match(calls[1].args.at(-1), /done\.wav$/);
  player.play('other');
  player.play('needs');
  calls[1].child.emit('exit', 0, null);
  await flush();
  assert.match(calls[2].args.at(-1), /needs\.wav$/);
  calls[2].child.emit('exit', 0, null);
  await player.idle();
});

test('a waiting quiet cue is not replaced by other, but is by needs', async () => {
  const { player, calls } = make();
  player.play('other');
  player.play('quiet');
  assert.equal(player.play('other').played, false);
  await flush();
  calls[0].child.emit('exit', 0, null);
  await flush();
  assert.match(calls[1].args.at(-1), /quiet\.wav$/);
  player.play('other');
  player.play('quiet');
  player.play('needs');
  calls[1].child.emit('exit', 0, null);
  await flush();
  assert.match(calls[2].args.at(-1), /needs\.wav$/);
  calls[2].child.emit('exit', 0, null);
  await player.idle();
});

test('spawn error (ENOENT): one log line, then no more spawns', async () => {
  const { player, calls, logs } = make();
  player.play('needs');
  await flush();
  calls[0].child.emit('error', Object.assign(new Error('x'), { code: 'ENOENT' }));
  await player.idle();
  assert.deepEqual(logs, ['sounds: cue player aplay could not start (ENOENT); cues are off']);
  assert.equal(player.play('done').played, false);
  await player.idle();
  assert.equal(calls.length, 1);
  assert.equal(logs.length, 1);
});

test('a spawn that throws is the same as an error', async () => {
  const logs = [];
  const player = createCuePlayer({ argv: ['x'], dir: '/c', spawn: () => { throw Object.assign(new Error('boom'), { code: 'EACCES' }); }, timers: fakeTimers(), log: (m) => logs.push(m) });
  assert.doesNotThrow(() => player.play('done'));
  await player.idle();
  player.play('done');
  assert.deepEqual(logs, ['sounds: cue player x could not start (EACCES); cues are off']);
});

test('non-zero exit is logged once per distinct code and playing goes on', async () => {
  const { player, calls, logs } = make();
  for (const code of [1, 1, 2]) {
    player.play('done');
    await flush();
    calls.at(-1).child.emit('exit', code, null);
    await player.idle();
  }
  assert.deepEqual(logs, ['sounds: cue player aplay exited with 1', 'sounds: cue player aplay exited with 2']);
  assert.equal(calls.length, 3);
});

test('a child that runs longer than maxMs is killed', async () => {
  const { player, calls, timers } = make({ maxMs: 3000 });
  player.play('done');
  await flush();
  timers.fire(3000);
  await player.idle();
  assert.equal(calls[0].child.killedWith, 'SIGKILL');
  assert.equal(timers.count(), 0);
});

test('waitBefore delays the start', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { player, calls, timers } = make({ waitBefore: () => gate });
  player.play('done');
  await flush();
  assert.equal(calls.length, 0);
  release();
  await flush();
  assert.equal(calls.length, 1);
  calls[0].child.emit('exit', 0, null);
  await player.idle();
  assert.equal(timers.count(), 0);
});

test('waitBefore: after 30 s the cue is dropped without a log line, the waiting one goes on', async () => {
  const never = new Promise(() => {});
  let first = true;
  const { player, calls, timers, logs } = make({ waitBefore: () => { if (first) { first = false; return never; } return Promise.resolve(); } });
  player.play('done');
  player.play('failed');
  await flush();
  assert.equal(calls.length, 0);
  timers.fire(30000);
  await flush();
  assert.equal(calls.length, 1);
  assert.match(calls[0].args.at(-1), /failed\.wav$/);
  calls[0].child.emit('exit', 0, null);
  await player.idle();
  assert.deepEqual(logs, []);
});

test('close kills the playing child, clears the waiting slot and the timers', async () => {
  const { player, calls, timers } = make();
  player.play('needs');
  player.play('done');
  await flush();
  await player.close();
  assert.equal(calls[0].child.killedWith, 'SIGKILL');
  assert.equal(calls.length, 1);
  assert.equal(timers.count(), 0);
  assert.equal(player.play('done').played, false);
  await player.idle();
});

test('close while a cue waits for waitBefore', async () => {
  const { player, calls, timers } = make({ waitBefore: () => new Promise(() => {}) });
  player.play('needs');
  await flush();
  await player.close();
  assert.equal(calls.length, 0);
  assert.equal(timers.count(), 0);
});

// the real stand-in program
const readRecords = (dir, prefix) => fs.readdirSync(dir).filter((f) => f.startsWith(`${prefix}.`))
  .map((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim().split(' ')).sort((a, b) => Number(a[1] ?? a[0]) - Number(b[1] ?? b[0]));

test('with the real stand-in: the file is the last argument, cues never overlap', T, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sounds-player-'));
  const old = { d: process.env.REVVIEW_FAKE_PLAYER_DIR, m: process.env.REVVIEW_FAKE_PLAYER_MS };
  process.env.REVVIEW_FAKE_PLAYER_DIR = dir;
  process.env.REVVIEW_FAKE_PLAYER_MS = '150';
  const player = createCuePlayer({ argv: [FAKE, '-q'], dir: '/cues' });
  try {
    player.play('needs');
    player.play('done');
    player.play('failed');
    await player.idle();
    const starts = readRecords(dir, 'start');
    const ends = readRecords(dir, 'end').map((r) => Number(r[0]));
    assert.deepEqual(starts.map((r) => r[0]), ['/cues/needs.wav', '/cues/failed.wav']);
    assert.equal(ends.length, 2);
    assert.ok(Number(starts[1][1]) >= ends[0], 'the second cue starts after the first ended');
  } finally {
    await player.close();
    if (old.d === undefined) delete process.env.REVVIEW_FAKE_PLAYER_DIR; else process.env.REVVIEW_FAKE_PLAYER_DIR = old.d;
    if (old.m === undefined) delete process.env.REVVIEW_FAKE_PLAYER_MS; else process.env.REVVIEW_FAKE_PLAYER_MS = old.m;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('with the real stand-in: close kills a playing cue', T, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sounds-player-'));
  const old = { d: process.env.REVVIEW_FAKE_PLAYER_DIR, m: process.env.REVVIEW_FAKE_PLAYER_MS };
  process.env.REVVIEW_FAKE_PLAYER_DIR = dir;
  process.env.REVVIEW_FAKE_PLAYER_MS = '20000';
  const player = createCuePlayer({ argv: [FAKE], dir: '/cues' });
  try {
    player.play('needs');
    const t0 = Date.now();
    while (readRecords(dir, 'start').length === 0) {
      assert.ok(Date.now() - t0 < 5000, 'the stand-in started');
      await new Promise((r) => setTimeout(r, 20));
    }
    const pid = Number(fs.readdirSync(dir).find((f) => f.startsWith('start.')).split('.')[1]);
    await player.close();
    const t1 = Date.now();
    for (;;) {
      try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') break; }
      try { if (/^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'))) break; } catch { break; }
      assert.ok(Date.now() - t1 < 5000, 'the stand-in is dead');
      await new Promise((r) => setTimeout(r, 20));
    }
  } finally {
    await player.close();
    if (old.d === undefined) delete process.env.REVVIEW_FAKE_PLAYER_DIR; else process.env.REVVIEW_FAKE_PLAYER_DIR = old.d;
    if (old.m === undefined) delete process.env.REVVIEW_FAKE_PLAYER_MS; else process.env.REVVIEW_FAKE_PLAYER_MS = old.m;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
