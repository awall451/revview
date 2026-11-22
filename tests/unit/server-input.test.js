import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { startLiveServer, parseArgs, installShutdown } from '../../src/server/index.js';
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
    // the only change is the list the F17 (up) tap opened; no gesture adds a seq of its own
    const after = await get(s, '/state');
    assert.equal(after.seq, seq0 + 1, 'in-process gestures change the board only through navigation');
    assert.equal(after.state.nav.kind, 'list');
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
  await withServer({ devBridge: true, onGesture: (g) => { seen.push(g); throw new Error('boom'); } }, async (s) => {
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

test('POST /event RevviewButton / RevviewInput without the dev bridge: 403, no gesture, no onGesture, board unchanged', async () => {
  const seen = [];
  await withServer({ onGesture: (g) => seen.push(g) }, async (s) => {
    const before = await get(s, '/state');
    const r = await postEvent(s, { hook_event_name: 'RevviewButton', button: 'cancel', gesture: 'tap' });
    assert.equal(r.status, 403);
    assert.match(await r.text(), /RevviewButton is not accepted over HTTP \(dev bridge only\)/);
    const r2 = await postEvent(s, { hook_event_name: 'RevviewInput', present: false });
    assert.equal(r2.status, 403);
    assert.match(await r2.text(), /RevviewInput is not accepted over HTTP/);
    assert.deepEqual(await get(s, '/state'), before);
    assert.deepEqual((await buttons(s)).gestures, []);
    assert.equal(seen.length, 0);
    assert.equal(s.gestures().length, 0);
  });
});

test('POST /event RevviewInput with the dev bridge changes the board', async () => {
  await withServer({ devBridge: true }, async (s) => {
    assert.equal((await postEvent(s, { hook_event_name: 'RevviewInput', present: false })).status, 204);
    assert.equal((await buttons(s)).buttons, 'missing');
  });
});

test('log keeps the last 32, oldest first', async () => {
  await withServer({ devBridge: true }, async (s) => {
    for (let i = 0; i < 40; i++) await postEvent(s, { hook_event_name: 'RevviewButton', button: `b${i}`, gesture: 'tap' });
    const g = (await buttons(s)).gestures;
    assert.equal(g.length, 32);
    assert.equal(g[0].button, 'b8');
    assert.equal(g[31].button, 'b39');
  });
});

test('a gesture during the boot starting is dropped (the server boot, not a posted RevviewStarting)', async () => {
  await withServer({ devBridge: true, boot: true }, async (s) => {
    await postEvent(s, { hook_event_name: 'RevviewButton', button: 'down', gesture: 'tap' });
    s.bootDone();
    await postEvent(s, { hook_event_name: 'RevviewButton', button: 'up', gesture: 'tap' });
    const g = (await buttons(s)).gestures;
    assert.deepEqual(g.map((x) => x.dropped), [true, false]);
  });
});

test('a POSTed RevviewStarting after the boot never drops presses, not even for a quiet placeholder', async () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const runner = { list: async () => [{ id: A, window: '@1', cwd: '/tmp', name: 'one' }], target: async () => null, send: async () => ({ sent: false }) };
  await withServer({ devBridge: true, boot: true, sessions: runner }, async (s) => {
    s.select(A);
    s.bootDone();
    await postEvent(s, { hook_event_name: 'RevviewStarting' });
    assert.equal(s.state().view, 'starting', 'the bar is blank until something comes back');
    await s.refreshOwned();
    s.select(A);
    assert.notEqual(s.state().view, 'starting', 'the placeholder reads UNKNOWN, not STARTING');
    await postEvent(s, { hook_event_name: 'RevviewButton', button: 'up', gesture: 'tap' });
    assert.deepEqual((await buttons(s)).gestures.map((x) => x.dropped), [false]);
  });
});

test('after the boot is done a press while the view is starting is not dropped (the rule keys on the booting flag, not on the phase)', async () => {
  await withServer({ devBridge: true, boot: true }, async (s) => {
    s.bootDone();
    await postEvent(s, { hook_event_name: 'RevviewStarting' });
    assert.equal(s.state().view, 'starting');
    await postEvent(s, { hook_event_name: 'RevviewButton', button: 'up', gesture: 'tap' });
    assert.deepEqual((await buttons(s)).gestures.map((x) => x.dropped), [false]);
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
  assert.deepEqual(parseArgs([]), { port: 8138, inputPath: null, devBridge: false, sessions: false, start: [], projects: null });
  assert.deepEqual(parseArgs(['9000', '--dev-bridge']), { port: 9000, inputPath: null, devBridge: true, sessions: false, start: [], projects: null });
  assert.deepEqual(parseArgs(['--sessions']), { port: 8138, inputPath: null, devBridge: false, sessions: true, start: [], projects: null });
  assert.deepEqual(parseArgs(['--start', '/a', '--start', '/b', '7']), { port: 7, inputPath: null, devBridge: false, sessions: true, start: ['/a', '/b'], projects: null });
  assert.throws(() => parseArgs(['--start']), /--start needs a directory/);
  assert.throws(() => parseArgs(['--start', '--dev-bridge']), /--start needs a directory/);
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

test('installShutdown: SIGTERM and SIGINT close the server, then exit 0', async () => {
  for (const sig of ['SIGTERM', 'SIGINT']) {
    const proc = new EventEmitter();
    const exits = [];
    proc.exit = (c) => exits.push(c);
    const order = [];
    installShutdown({ close: async () => { order.push('close'); } }, proc);
    proc.emit(sig);
    proc.emit(sig); // a second signal does not close twice
    await sleep(10);
    assert.deepEqual(order, ['close']);
    assert.deepEqual(exits, [0]);
  }
});
