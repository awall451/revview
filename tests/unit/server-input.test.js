import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLiveServer, parseArgs } from '../../src/server/index.js';
import { parseConfig, DEFAULT_CONFIG_PATH } from '../../src/input/keymap.js';
import { encodeEvent, EV_KEY } from '../../src/input/evdev.js';
import { KEY_CODES } from '../../src/input/keys.js';

const SERVER_JS = fileURLToPath(new URL('../../src/server/index.js', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (code, value) => encodeEvent({ type: EV_KEY, code, value });
const BUTTONS = [
  { key: 'F13', button: 'push-to-talk' },
  { key: 'F14', button: 'read-aloud', hold: true },
  { key: 'F15', button: 'cancel', longHold: true },
  { key: 'F17', button: 'up' },
];

const cfg = (path) => parseConfig({ device: { path, grab: false }, buttons: BUTTONS }, 'test');

async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await sleep(15);
  }
}

const get = async (s, p) => (await fetch(`${s.url}${p}`)).json();
const buttons = (s) => get(s, '/buttons');
const postKey = (s, body) => fetch(`${s.url}/dev/key`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
const postEvent = (s, ev) => fetch(`${s.url}/event`, { method: 'POST', body: JSON.stringify(ev) });

async function withServer(opts, fn) {
  const s = await startLiveServer({ port: 0, ...opts });
  try { await fn(s); } finally { await s.close(); }
}

test('device: FIFO presence, tap, no phantom long-hold on loss, reconnect', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'revview-in-'));
  const fifo = join(dir, 'ev');
  try {
    await withServer({ input: cfg(fifo), inputRetryMs: 30 }, async (s) => {
      await until(async () => (await get(s, '/state')).state.buttons === 'missing');
      execFileSync('mkfifo', [fifo]);
      // opening for write blocks until the reader has opened its end
      let w = await open(fifo, 'w');
      await until(async () => (await buttons(s)).buttons === 'present');
      await w.write(Buffer.concat([key(KEY_CODES.F13, 1), key(KEY_CODES.F13, 0)]));
      await until(async () => (await buttons(s)).gestures.length === 1);
      const g = (await buttons(s)).gestures[0];
      assert.deepEqual([g.button, g.gesture, g.source, g.dropped], ['push-to-talk', 'tap', 'device', false]);

      await w.write(key(KEY_CODES.F15, 1));
      await sleep(100);
      await w.close();
      await until(async () => (await buttons(s)).buttons === 'missing');
      await sleep(1200); // past longHoldMs: a phantom long-hold would have fired by now
      assert.equal((await buttons(s)).gestures.filter((x) => x.button === 'cancel').length, 0);

      w = await open(fifo, 'w');
      await until(async () => (await buttons(s)).buttons === 'present');
      await w.close();
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dev bridge off: /dev/key is an unknown path like any other', async () => {
  await withServer({}, async (s) => {
    assert.equal((await fetch(`${s.url}/dev/key`)).status, 404);
    // a POST to an unknown path is answered like the server always has (405: only GET/HEAD are served)
    const other = (await fetch(`${s.url}/dev/nothing`, { method: 'POST', body: '{}' })).status;
    assert.equal((await postKey(s, { code: 'F13', type: 'down' })).status, other);
    assert.equal((await buttons(s)).gestures.length, 0);
  });
});

test('dev bridge on: statuses', async () => {
  await withServer({ devBridge: true }, async (s) => {
    assert.equal((await postKey(s, { code: 'F13', type: 'down' })).status, 204);
    assert.equal((await postKey(s, { code: 'F13', type: 'up' })).status, 204);
    assert.equal((await postKey(s, { code: 'KeyQ', type: 'down' })).status, 204);
    assert.equal((await postKey(s, { code: '__proto__', type: 'down' })).status, 204);
    assert.equal((await postKey(s, { code: 'F13', type: 'sideways' })).status, 400);
    assert.equal((await postKey(s, 'not json')).status, 400);
    assert.equal((await postKey(s, '[]')).status, 400);
    assert.equal((await postKey(s, { type: 'down' })).status, 400);
    assert.equal((await postKey(s, { code: 'F13', type: 'down', repeat: 'x' })).status, 400);
    assert.equal((await postKey(s, 'x'.repeat(2000))).status, 413);
    const r = await fetch(`${s.url}/dev/key`, { method: 'POST', body: '{}', headers: { origin: 'http://evil.example' } });
    assert.equal(r.status, 403);
    assert.equal((await fetch(`${s.url}/dev/key`)).status, 405);
    assert.equal((await buttons(s)).gestures.length, 1); // only the F13 tap
  });
});

test('dev bridge: tap, hold, repeat, lost', async () => {
  await withServer({ devBridge: true }, async (s) => {
    const seq0 = (await get(s, '/state')).seq;
    await postKey(s, { code: 'F13', type: 'down' });
    await postKey(s, { code: 'F13', type: 'up' });
    await postKey(s, { code: 'F14', type: 'down' });
    await sleep(450);
    await postKey(s, { code: 'F14', type: 'up' });
    await postKey(s, { code: 'F17', type: 'down' });
    for (let i = 0; i < 3; i++) await postKey(s, { code: 'F17', type: 'down', repeat: true });
    await postKey(s, { code: 'F17', type: 'up' });
    await postKey(s, { code: 'F15', type: 'down' });
    await postKey(s, { type: 'lost' });
    await sleep(1100);
    const g = (await buttons(s)).gestures;
    assert.deepEqual(g.map((x) => [x.button, x.gesture, x.source]), [
      ['push-to-talk', 'tap', 'bridge'], ['read-aloud', 'hold', 'bridge'], ['up', 'tap', 'bridge'],
    ]);
    assert.equal((await get(s, '/state')).seq, seq0, 'in-process gestures do not change seq');
    assert.equal(s.gestures().length, 3);
  });
});

test('dev bridge with input: one shared detector (modifier combo)', async () => {
  const config = parseConfig({
    device: { path: join(tmpdir(), 'revview-absent-device'), grab: false },
    buttons: [{ key: 'Shift+F24', button: 'combo-test' }],
  });
  await withServer({ input: config, devBridge: true, inputRetryMs: 50 }, async (s) => {
    await postKey(s, { code: 'ShiftLeft', type: 'down' });
    await postKey(s, { code: 'F24', type: 'down' });
    await postKey(s, { code: 'F24', type: 'up' });
    await postKey(s, { code: 'ShiftLeft', type: 'up' });
    const g = (await buttons(s)).gestures;
    assert.deepEqual(g.map((x) => [x.button, x.source]), [['combo-test', 'bridge']]);
    await until(async () => (await buttons(s)).buttons === 'missing');
  });
});

test('POST /event RevviewButton: counted, logged with source post; invalid ones not logged', async () => {
  const seen = [];
  await withServer({ onGesture: (g) => { seen.push(g); throw new Error('boom'); } }, async (s) => {
    const seq0 = (await get(s, '/state')).seq;
    assert.equal((await postEvent(s, { hook_event_name: 'RevviewButton', button: 'cancel', gesture: 'long-hold' })).status, 204);
    assert.equal((await get(s, '/state')).seq, seq0 + 1);
    for (const bad of [{ button: 'Cancel', gesture: 'tap' }, { button: 'a', gesture: 'double' }, { button: 5, gesture: 'tap' }, { gesture: 'tap' }]) {
      assert.equal((await postEvent(s, { hook_event_name: 'RevviewButton', ...bad })).status, 204);
    }
    const b = await buttons(s);
    assert.equal(b.gestures.length, 1);
    assert.deepEqual([b.gestures[0].button, b.gestures[0].gesture, b.gestures[0].source], ['cancel', 'long-hold', 'post']);
    assert.equal(seen.length, 1);
  });
});

test('log keeps the last 32, oldest first', async () => {
  await withServer({}, async (s) => {
    for (let i = 0; i < 40; i++) await postEvent(s, { hook_event_name: 'RevviewButton', button: `b${i}`, gesture: 'tap' });
    const g = (await buttons(s)).gestures;
    assert.equal(g.length, 32);
    assert.equal(g[0].button, 'b8');
    assert.equal(g[31].button, 'b39');
  });
});

test('a gesture during starting is dropped', async () => {
  await withServer({}, async (s) => {
    await postEvent(s, { hook_event_name: 'RevviewButton', button: 'up', gesture: 'tap' });
    await postEvent(s, { hook_event_name: 'RevviewStarting' });
    await postEvent(s, { hook_event_name: 'RevviewButton', button: 'down', gesture: 'tap' });
    const g = (await buttons(s)).gestures;
    assert.deepEqual(g.map((x) => x.dropped), [false, true]);
  });
});

test('GET /buttons headers and origin check', async () => {
  await withServer({}, async (s) => {
    const r = await fetch(`${s.url}/buttons`);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await r.json(), { buttons: 'unknown', gestures: [] });
    assert.equal((await fetch(`${s.url}/buttons`, { headers: { origin: 'http://evil.example' } })).status, 403);
  });
});

test('parseArgs', () => {
  assert.deepEqual(parseArgs([]), { port: 8138, inputPath: null, devBridge: false });
  assert.deepEqual(parseArgs(['9000', '--dev-bridge']), { port: 9000, inputPath: null, devBridge: true });
  assert.equal(parseArgs(['--input']).inputPath, DEFAULT_CONFIG_PATH);
  assert.equal(parseArgs(['--input', '--dev-bridge']).inputPath, DEFAULT_CONFIG_PATH);
  assert.equal(parseArgs(['--input', '/x/y.json', '7']).inputPath, '/x/y.json');
  assert.equal(parseArgs(['--input', '/x/y.json', '7']).port, 7);
  assert.throws(() => parseArgs(['--nope']), /unknown option --nope/);
  assert.throws(() => parseArgs(['abc']), /unexpected argument/);
});

test('CLI: a bad config file exits 2 before listening, naming the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'revview-cli-'));
  try {
    const f = join(dir, 'broken-buttons.json');
    writeFileSync(f, '{ not json');
    const r = spawnSync(process.execPath, [SERVER_JS, '0', '--input', f], { encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /broken-buttons\.json/);
    assert.equal(r.stdout, '');
    const r2 = spawnSync(process.execPath, [SERVER_JS, '--bogus'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(r2.status, 2);
    assert.match(r2.stderr, /--bogus/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
