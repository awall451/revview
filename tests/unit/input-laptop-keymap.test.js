// The laptop key map for the dev bridge (config/buttons.laptop.json, --dev-keys): the file, the new key
// names, the gestures through the real detector, and the server side (GET /dev/keys, the bridge's own pipeline).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig, parseConfig, ConfigError } from '../../src/input/keymap.js';
import { createInputPipeline } from '../../src/input/index.js';
import { KEY_CODES, BROWSER_CODES, MODIFIER_KIND } from '../../src/input/keys.js';
import { startLiveServer, parseArgs } from '../../src/server/index.js';

const LAPTOP = fileURLToPath(new URL('../../config/buttons.laptop.json', import.meta.url));
const WHEEL = fileURLToPath(new URL('../../config/buttons.json', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeClock() {
  let t = 0;
  let seq = 0;
  let timers = [];
  return {
    now: () => t,
    setTimeout(fn, ms) { const h = { fn, at: t + ms, seq: seq++ }; timers.push(h); return h; },
    clearTimeout(h) { timers = timers.filter((x) => x !== h); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
        if (!due) break;
        timers = timers.filter((x) => x !== due);
        t = due.at;
        due.fn();
      }
      t = end;
    },
  };
}

async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await sleep(15);
  }
}

test('key names: the laptop keys and letters parse; a bad name still fails', () => {
  const dev = { name: 'x' };
  const c = parseConfig({
    device: dev,
    buttons: [
      { key: 'Up', button: 'a' }, { key: 'Esc', button: 'b' }, { key: 'Ctrl+Enter', button: 'c' },
      { key: 'Space', button: 'd' }, { key: 'Z', button: 'e' }, { key: 'Backspace', button: 'f' },
    ],
  });
  assert.deepEqual(c.bindings.map((b) => b.key), [103, 1, 28, 57, 44, 14]);
  assert.deepEqual(c.bindings[2].mods, ['Ctrl']);
  assert.throws(() => parseConfig({ device: dev, buttons: [{ key: 'Escape', button: 'a' }] }, 'x.json'),
    (e) => e instanceof ConfigError && /buttons\[0\]\.key: unknown key "Escape"/.test(e.message));
  assert.throws(() => parseConfig({ device: dev, buttons: [{ key: 'a', button: 'a' }] }, 'x.json'), ConfigError);
});

test('laptop key codes match linux/input-event-codes.h and the browser names', () => {
  assert.equal(KEY_CODES.Up, 103);
  assert.equal(KEY_CODES.Down, 108);
  assert.equal(KEY_CODES.Left, 105);
  assert.equal(KEY_CODES.Right, 106);
  assert.equal(KEY_CODES.Enter, 28);
  assert.equal(KEY_CODES.Backspace, 14);
  assert.equal(KEY_CODES.Space, 57);
  assert.equal(KEY_CODES.Esc, 1);
  assert.equal(KEY_CODES.A, 30);
  assert.equal(KEY_CODES.M, 50);
  assert.equal(KEY_CODES.Q, 16);
  assert.equal(BROWSER_CODES.Escape, 1);
  assert.equal(BROWSER_CODES.ArrowUp, 103);
  assert.equal(BROWSER_CODES.KeyM, 50);
  const letters = Object.keys(KEY_CODES).filter((k) => /^[A-Z]$/.test(k));
  assert.equal(letters.length, 26);
  assert.equal(new Set(letters.map((k) => KEY_CODES[k])).size, 26);
  for (const k of letters) assert.equal(BROWSER_CODES[`Key${k}`], KEY_CODES[k]);
  // no two names share a code
  assert.equal(new Set(Object.values(KEY_CODES)).size, Object.keys(KEY_CODES).length);
});

test('config/buttons.laptop.json: loads, covers every wheel button but spare once, same flags', () => {
  const laptop = loadConfig(LAPTOP);
  const wheel = loadConfig(WHEEL);
  assert.equal(laptop.device.grab, false);
  assert.deepEqual(laptop.timing, wheel.timing);
  const names = laptop.bindings.map((b) => b.button);
  assert.equal(new Set(names).size, names.length);
  const want = wheel.bindings.filter((b) => b.button !== 'spare');
  assert.deepEqual([...names].sort(), want.map((b) => b.button).sort());
  for (const w of want) {
    const l = laptop.bindings.find((b) => b.button === w.button);
    assert.equal(l.hold, w.hold, w.button);
    assert.equal(l.longHold, w.longHold, w.button);
  }
  const ids = laptop.bindings.map((b) => `${b.mods.join('+')}+${b.key}`);
  assert.equal(new Set(ids).size, ids.length);
  const web = new Set(Object.values(BROWSER_CODES));
  for (const b of laptop.bindings) {
    assert.ok(web.has(b.key), `${b.keyName} has a browser code`);
    assert.ok(!(b.key in MODIFIER_KIND));
  }
  assert.ok(/laptop/.test(JSON.parse(readFileSync(LAPTOP, 'utf8')).note));
});

function pipe() {
  const clock = fakeClock();
  const out = [];
  const p = createInputPipeline({ config: loadConfig(LAPTOP), clock, onGesture: (g) => out.push(`${g.button}:${g.gesture}`) });
  return { clock, out, p };
}

test('gestures: Enter tap, Backspace hold, Esc long hold, R hold, arrow autorepeat', () => {
  const { clock, out, p } = pipe();
  p.feed(KEY_CODES.Enter, 1);
  clock.advance(80);
  p.feed(KEY_CODES.Enter, 0);
  clock.advance(100);
  assert.deepEqual(out, ['press:tap']);

  p.feed(KEY_CODES.Backspace, 1);
  clock.advance(600);
  p.feed(KEY_CODES.Backspace, 0);
  clock.advance(100);
  p.feed(KEY_CODES.R, 1);
  clock.advance(600);
  p.feed(KEY_CODES.R, 0);
  clock.advance(100);
  p.feed(KEY_CODES.Esc, 1);
  clock.advance(1200);
  p.feed(KEY_CODES.Esc, 0);
  clock.advance(100);
  assert.deepEqual(out, ['press:tap', 'back:hold', 'read-aloud:hold', 'cancel:long-hold']);

  out.length = 0;
  p.feed(KEY_CODES.Down, 1);
  for (let i = 0; i < 4; i++) { clock.advance(30); p.feed(KEY_CODES.Down, 2); }
  p.feed(KEY_CODES.Down, 0);
  clock.advance(100);
  assert.deepEqual(out, ['down:tap']);
});

test('parseArgs --dev-keys: needs a file and --dev-bridge', () => {
  const a = parseArgs(['--dev-bridge', '--dev-keys', 'config/buttons.laptop.json']);
  assert.equal(a.devKeysPath, 'config/buttons.laptop.json');
  assert.equal(parseArgs(['--dev-bridge']).devKeysPath, undefined);
  assert.throws(() => parseArgs(['--dev-bridge', '--dev-keys']), /--dev-keys needs a file/);
  assert.throws(() => parseArgs(['--dev-bridge', '--dev-keys', '--sessions']), /--dev-keys needs a file/);
  assert.throws(() => parseArgs(['--dev-keys', 'f.json']), /--dev-keys needs --dev-bridge/);
});

const postKey = (s, body) => fetch(`${s.url}/dev/key`, { method: 'POST', body: JSON.stringify(body) });
const summary = async (s) => (await (await fetch(`${s.url}/buttons`)).json()).gestures.map((g) => `${g.button}:${g.gesture}:${g.source}`);

test('server with devBridge + devKeys: /dev/key drives the laptop map, /dev/keys lists the codes', async () => {
  const devKeys = loadConfig(LAPTOP);
  const s = await startLiveServer({ port: 0, devBridge: true, devKeys });
  try {
    const r = await fetch(`${s.url}/dev/keys`);
    assert.equal(r.status, 200);
    const { codes } = await r.json();
    assert.deepEqual([...codes].sort(), [
      'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Backspace', 'Enter', 'Escape', 'KeyM', 'KeyN', 'KeyR', 'Space',
    ].sort());
    assert.equal((await postKey(s, { code: 'KeyM', type: 'down' })).status, 204);
    await sleep(60);
    assert.equal((await postKey(s, { code: 'KeyM', type: 'up' })).status, 204);
    await until(async () => (await summary(s)).includes('menu:tap:bridge'));
    assert.deepEqual(await summary(s), ['menu:tap:bridge']);
    // an F key is not in this map: ignored
    await postKey(s, { code: 'F13', type: 'down' });
    await postKey(s, { code: 'F13', type: 'up' });
    await sleep(100);
    assert.deepEqual(await summary(s), ['menu:tap:bridge']);
  } finally {
    await s.close();
  }
});

test('server with devBridge and no devKeys: the wheel map as before, /dev/keys lists the F keys', async () => {
  const s = await startLiveServer({ port: 0, devBridge: true });
  try {
    const { codes } = await (await fetch(`${s.url}/dev/keys`)).json();
    assert.ok(codes.includes('F13') && codes.includes('F24') && !codes.includes('KeyM'));
    await postKey(s, { code: 'F23', type: 'down' });
    await sleep(60);
    await postKey(s, { code: 'F23', type: 'up' });
    await until(async () => (await summary(s)).includes('menu:tap:bridge'));
  } finally {
    await s.close();
  }
});

test('server without devBridge: no /dev/keys (404), /dev/key unchanged (not a route)', async () => {
  const s = await startLiveServer({ port: 0, devKeys: loadConfig(LAPTOP) });
  try {
    assert.equal((await fetch(`${s.url}/dev/keys`)).status, 404);
    assert.equal((await postKey(s, { code: 'KeyM', type: 'down' })).status, 405); // an unknown path, as today
  } finally {
    await s.close();
  }
});

// menu has a hold (the look toggle): the tap fires on release, a 400 ms hold gives gesture 'hold' (and no tap after it)
test('menu: a short press is a tap, a 400 ms hold is a hold, in both shipped maps', () => {
  for (const [file, key] of [[LAPTOP, KEY_CODES.M], [WHEEL, KEY_CODES.F23]]) {
    const clock = fakeClock();
    const out = [];
    const p = createInputPipeline({ config: loadConfig(file), clock, onGesture: (g) => out.push(`${g.button}:${g.gesture}`) });
    p.feed(key, 1);
    clock.advance(80);
    p.feed(key, 0);
    clock.advance(100);
    assert.deepEqual(out, ['menu:tap'], file);
    p.feed(key, 1);
    clock.advance(400);
    p.feed(key, 0);
    clock.advance(100);
    assert.deepEqual(out, ['menu:tap', 'menu:hold'], file);
  }
});
