// Settings kept over a restart, on the live server: a fake in-memory file system, fake lights driver, no speech engine or player.
// Buttons go through the dev bridge (the real button map with a 400 ms hold and a long hold that never comes in a test), the data-lock poll is a fake timer called by hand.
import test from 'node:test';
import fsNode from 'node:fs';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { startLiveServer, parseArgs } from '../../src/server/index.js';
import { defaultSettingsPath } from '../../src/server/settings.js';
import { parseConfig, DEFAULT_CONFIG_PATH } from '../../src/input/keymap.js';
import { fakeFs } from './settings-fake-fs.js';

const T = { timeout: 20000 };
const P = '/state/revview/settings.json';
const D = '/srv/revview-data';
const INSIDE = `${D}/revview/settings.json`;
const MAPPER = `45 29 253:0 / ${D} rw - ext4 /dev/mapper/revview-data rw`;
const ROOT = '29 1 179:2 / / rw - ext4 /dev/mmcblk0p2 rw';
const LIGHTS = (lights = 'on') => ({ config: { lights, leds: 3, driver: 'none', device: '/dev/spidev0.0', brightness: { day: 48, night: 12 } }, driver: { show() {}, close: () => Promise.resolve() } });
const SPEECH = (sounds = 'cues') => ({ engine: null, sounds, cuePlayer: { argv: null } });
const LOOK = (mode = 'day') => ({ mode, night: { from: '21:00', to: '07:00' } });
const CODES = { menu: 'F12', menuHold: 'F23', down: 'F18', press: 'F21' }; // F12: a tap-only menu key (F23 also holds, and a tap there would race the hold timer)
const FAST_KEYS = () => {
  const c = JSON.parse(fsNode.readFileSync(DEFAULT_CONFIG_PATH, 'utf8'));
  return parseConfig({ ...c, timing: { debounceMs: 0, holdMs: 400, longHoldMs: 10000 }, buttons: [...c.buttons, { key: 'F12', button: 'menu' }] });
};
const FULL = (extra = {}) => ({ speech: SPEECH(), look: LOOK(), lights: LIGHTS(), lookNow: () => new Date(2026, 0, 1, 12, 0), ...extra });
const NO_SPEECH_LIGHTS = () => ({ look: LOOK(), lookNow: () => new Date(2026, 0, 1, 12, 0) });
const SOUNDS_ROW = 4;
const LIGHTS_ROW = 5;
const LOOK_ROW = 6;

async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

// what a person does with the wheel, through the dev bridge
function drive(s, g) { // g.n counts the gestures (the server's own log keeps only the last 32)
  const key = (code, type) => fetch(`${s.url}/dev/key`, { method: 'POST', body: JSON.stringify({ code, type }) });
  const tap = async (button, gesture = 'tap') => {
    const n = g.n;
    const code = gesture === 'hold' ? CODES.menuHold : CODES[button];
    await key(code, 'down');
    if (gesture === 'hold') await until(() => g.n > n, 'the hold');
    await key(code, 'up');
    await until(() => g.n > n, 'a gesture');
    await new Promise((r) => setImmediate(r)); // the action runs in a microtask chain after the gesture
  };
  const open = async () => {
    while (s.state().nav !== null) await tap('menu'); // close whatever is open
    for (const b of ['menu', 'down', 'down', 'press']) await tap(b);
  };
  // menu -> Settings -> row n -> press
  const pressRow = async (row) => {
    await open();
    for (let i = 0; i < row; i++) await tap('down');
    await tap('press');
  };
  // what the Settings rows say now (opens Settings, reads the labels, closes it again)
  const modes = async () => {
    await open();
    const labels = s.state().nav.rows.map((r) => r.label);
    await tap('menu');
    assert.equal(s.state().nav, null);
    const pick = (re) => labels.find((l) => re.test(l))?.replace(re, '') ?? null;
    const sounds = pick(/^Sounds: /);
    return { sounds: sounds === 'cues and speech' ? 'speech' : sounds, lights: pick(/^Lights: /), look: pick(/^Look: /)?.split(',')[0] ?? null };
  };
  const devLights = async () => (await fetch(`${s.url}/dev/lights`)).json();
  return { s, tap, open, pressRow, modes, devLights };
}

// starts servers (all closed at the end) on one fake fs; logs collects the settings log lines
function rig(t, files = {}) {
  const fs = fakeFs(files);
  const logs = [];
  const servers = [];
  t.after(async () => { for (const s of servers) await s.close(); });
  const start = async (opts = {}, file = P) => {
    const g = { n: 0 };
    const s = await startLiveServer({ port: 0, devBridge: true, devKeys: FAST_KEYS(), onGesture: () => { g.n++; }, settings: { path: file, fs, log: (m) => logs.push(m) }, ...opts });
    servers.push(s);
    return drive(s, g);
  };
  return { fs, logs, start, file: (f = P) => JSON.parse(fs.files.get(f)), servers };
}

test('kept values are on the board at the start, for sounds, look and lights; one start line', T, async (t) => {
  const r = rig(t, { [P]: '{"sounds":"speech","look":"night","lights":"off"}' });
  const c = await r.start(FULL());
  assert.deepEqual(await c.modes(), { sounds: 'speech', look: 'night', lights: 'off' });
  assert.equal(c.s.state().look, 'night');
  assert.equal((await c.devLights()).lights, 'off');
  assert.equal(r.logs.length, 1);
  assert.match(r.logs[0], /settings: kept .*sounds=speech look=night lights=off/);
  assert.deepEqual(r.fs.calls, [`read ${P}`], 'only the start read; opening the menu writes nothing');
});

test('a kept value needs the feature: no speech config -> no sounds, no lights config -> no lights; look always', T, async (t) => {
  const r = rig(t, { [P]: '{"sounds":"speech","look":"auto","lights":"on"}' });
  const c = await r.start(NO_SPEECH_LIGHTS());
  assert.deepEqual(await c.modes(), { sounds: null, lights: null, look: 'auto' });
  assert.equal((await c.devLights()).lights, null);
  // and without a look config at all
  const c2 = await r.start({});
  assert.equal((await c2.modes()).look, 'auto');
});

test('nothing kept: the config defaults; the start line says so; nothing is written at the start', T, async (t) => {
  const r = rig(t, {});
  const c = await r.start(FULL({ look: LOOK('night'), speech: SPEECH('off'), lights: LIGHTS('on') }));
  assert.deepEqual(await c.modes(), { sounds: 'off', look: 'night', lights: 'on' });
  assert.equal(r.logs.length, 1);
  assert.match(r.logs[0], /nothing kept yet/);
  assert.deepEqual(r.fs.calls, [`read ${P}`]);
});

test('settings null: nothing is read or written (today\'s behaviour)', T, async (t) => {
  const fs = fakeFs({ [P]: '{"look":"night"}' });
  const g = { n: 0 };
  const s = await startLiveServer({ port: 0, devBridge: true, devKeys: FAST_KEYS(), onGesture: () => { g.n++; }, settings: null, ...FULL() });
  t.after(() => s.close());
  const c = drive(s, g);
  assert.equal((await c.modes()).look, 'day');
  await c.pressRow(LOOK_ROW);
  await until(() => s.state().look === 'night', 'night');
  assert.deepEqual(fs.calls, []);
});

test('the Settings rows write the file; the next server on the same files shows the choice', T, async (t) => {
  const r = rig(t, {});
  const c = await r.start(FULL());
  await c.pressRow(SOUNDS_ROW); // cues -> speech
  assert.deepEqual(r.file(), { sounds: 'speech' });
  await c.tap('down'); // Lights row
  await c.tap('press');
  assert.deepEqual(r.file(), { sounds: 'speech', lights: 'off' });
  await c.tap('down'); // Look row
  await c.tap('press');
  assert.deepEqual(r.file(), { sounds: 'speech', lights: 'off', look: 'night' });
  assert.ok(r.fs.calls.includes(`rename ${P}.tmp ${P}`));
  assert.equal(r.fs.files.has(`${P}.tmp`), false);
  assert.ok(r.fs.dirs.has('/state/revview'), 'the parent directory was made');
  await c.s.close();
  r.logs.length = 0;
  const c2 = await r.start(FULL());
  assert.deepEqual(await c2.modes(), { sounds: 'speech', lights: 'off', look: 'night' });
  assert.equal(c2.s.state().look, 'night');
  assert.equal((await c2.devLights()).lights, 'off');
  assert.equal(r.logs.length, 1);
});

test('the Lights row press is written (LIGHTS_ROW alone)', T, async (t) => {
  const r = rig(t, {});
  const c = await r.start(FULL());
  await c.pressRow(LIGHTS_ROW);
  assert.deepEqual(r.file(), { lights: 'off' });
});

test('the menu hold (day/night flip) writes the look', T, async (t) => {
  const r = rig(t, {});
  const c = await r.start(FULL());
  await c.tap('menu', 'hold');
  await until(() => c.s.state().look === 'night', 'night');
  assert.deepEqual(r.file(), { look: 'night' });
  await c.tap('menu', 'hold');
  await until(() => c.s.state().look === 'day', 'day');
  assert.deepEqual(r.file(), { look: 'day' });
});

test('a setting nobody changed is not written (a config default is not pinned)', T, async (t) => {
  const r = rig(t, {});
  const c = await r.start(FULL());
  await c.pressRow(LOOK_ROW);
  assert.deepEqual(r.file(), { look: 'night' });
});

test('keys for features this run lacks are carried over unchanged into the write', T, async (t) => {
  const r = rig(t, { [P]: '{"sounds":"speech","lights":"on"}' });
  const c = await r.start(NO_SPEECH_LIGHTS());
  await c.tap('menu', 'hold');
  await until(() => c.s.state().look === 'night', 'night');
  assert.deepEqual(r.file(), { sounds: 'speech', lights: 'on', look: 'night' });
});

test('a corrupt file: defaults, exactly one log line with the reason, the server runs, the next change overwrites it', T, async (t) => {
  const r = rig(t, { [P]: '{"look":"dusk"}' });
  const c = await r.start(FULL());
  assert.equal(c.s.state().look, 'day');
  assert.equal(r.logs.length, 1);
  assert.match(r.logs[0], /refused/);
  assert.match(r.logs[0], /"look" must be/);
  assert.equal(r.fs.files.get(P), '{"look":"dusk"}', 'not touched at the start');
  await c.tap('menu', 'hold');
  await until(() => c.s.state().look === 'night', 'night');
  assert.deepEqual(r.file(), { look: 'night' });
});

test('an unreadable file: defaults and one log line', T, async (t) => {
  const r = rig(t, { [P]: '{}' });
  r.fs.failOn.read = 'EACCES';
  const c = await r.start(FULL());
  assert.equal(c.s.state().look, 'day');
  assert.equal(r.logs.length, 1);
  assert.match(r.logs[0], /unreadable.*EACCES/);
});

test('an unwritable place: the choice stays on the board, one log line per streak, nothing throws', T, async (t) => {
  const r = rig(t, {});
  const c = await r.start(FULL());
  r.logs.length = 0;
  r.fs.failOn = { mkdir: 'EROFS', open: 'EROFS', rename: 'EROFS' };
  await c.tap('menu', 'hold');
  await until(() => c.s.state().look === 'night', 'night');
  await c.tap('menu', 'hold');
  await until(() => c.s.state().look === 'day', 'day');
  assert.equal(r.logs.length, 1);
  assert.match(r.logs[0], /cannot write .*EROFS/);
  assert.equal(r.fs.files.has(P), false);
  r.fs.failOn = {};
  await c.tap('menu', 'hold');
  await until(() => c.s.state().look === 'night', 'night again');
  assert.deepEqual(r.file(), { look: 'night' });
  assert.equal(r.logs.length, 1);
});

// data lock: the mount table is injected, the poll is a fake timer called by hand
function lockRig(t, files, mountText = ROOT, file = INSIDE) {
  const r = rig(t, files);
  const mount = { text: mountText };
  const timer = { fn: null };
  const dataLock = { mountPoint: D, read: () => mount.text, pollMs: 1000, setInterval: (fn) => { timer.fn = fn; return { unref() {} }; }, clearInterval() {} };
  const unlock = () => { mount.text = MAPPER; timer.fn(); };
  const start = (opts = {}) => r.start({ ...FULL(), dataLock, ...opts }, file);
  return { ...r, mount, timer, unlock, start };
}

test('locked at the start: defaults, no read, no write; the start line says it waits', T, async (t) => {
  const r = lockRig(t, { [INSIDE]: '{"look":"night"}' });
  const c = await r.start();
  assert.equal(c.s.dataLocked(), true);
  assert.equal(c.s.state().look, 'day');
  assert.deepEqual(r.fs.calls, []);
  assert.equal(r.logs.length, 1);
  assert.match(r.logs[0], /waiting for the data unlock/);
});

test('unlock: the kept values are read and applied (broadcast); the file is read only then', T, async (t) => {
  const r = lockRig(t, { [INSIDE]: '{"sounds":"speech","look":"night","lights":"off"}' });
  const c = await r.start();
  const seq0 = (await (await fetch(`${c.s.url}/state`)).json()).seq;
  r.unlock();
  assert.equal(c.s.dataLocked(), false);
  assert.ok((await (await fetch(`${c.s.url}/state`)).json()).seq > seq0, 'applied as events: clients get it');
  assert.deepEqual(r.fs.calls, [`read ${INSIDE}`]);
  assert.deepEqual(await c.modes(), { sounds: 'speech', look: 'night', lights: 'off' });
  assert.equal(r.logs.length, 2);
  assert.match(r.logs[1], /kept/);
  assert.deepEqual(r.fs.calls, [`read ${INSIDE}`], 'applying what was read writes nothing back');
});

test('a change while locked: kept on the board, no write while locked, written at the unlock; the file values are not applied', T, async (t) => {
  const r = lockRig(t, { [INSIDE]: '{"sounds":"speech","look":"night"}' });
  const c = await r.start();
  await c.tap('menu', 'hold'); // day -> night, while locked
  await until(() => c.s.state().look === 'night', 'night while locked');
  await c.pressRow(SOUNDS_ROW); // cues -> speech (what the file also has)... then once more
  await c.tap('press'); // speech -> off
  assert.deepEqual(r.fs.calls, [], 'no read and no write while locked');
  r.unlock();
  assert.deepEqual(await c.modes(), { sounds: 'off', look: 'night', lights: 'on' }, 'the driver acted first: the file values are not applied');
  assert.deepEqual(r.file(INSIDE), { sounds: 'off', look: 'night' }, 'the current choices written over the file');
});

test('a change while locked keeps the other keys of the file (carried)', T, async (t) => {
  const r = lockRig(t, { [INSIDE]: '{"sounds":"speech","lights":"off"}' });
  const c = await r.start(NO_SPEECH_LIGHTS());
  await c.tap('menu', 'hold');
  await until(() => c.s.state().look === 'night', 'night while locked');
  r.unlock();
  assert.deepEqual(r.file(INSIDE), { sounds: 'speech', lights: 'off', look: 'night' });
});

test('a data lock that is open at the first look reads at the start of the monitor', T, async (t) => {
  const r = lockRig(t, { [INSIDE]: '{"look":"night"}' }, MAPPER);
  const c = await r.start();
  assert.equal(c.s.dataLocked(), false);
  assert.equal(c.s.state().look, 'night');
});

test('a settings file outside the mount is used at once, even with a data lock that is locked', T, async (t) => {
  const r = lockRig(t, { [P]: '{"look":"night"}' }, ROOT, P);
  const c = await r.start();
  assert.equal(c.s.dataLocked(), true);
  assert.equal(c.s.state().look, 'night');
});

test('parseArgs: --settings, --settings file, REVVIEW_SETTINGS, absent', () => {
  const old = process.env.REVVIEW_SETTINGS;
  delete process.env.REVVIEW_SETTINGS;
  try {
    assert.equal('settings' in parseArgs([]), false);
    assert.equal(parseArgs(['--settings']).settings, defaultSettingsPath(process.env));
    assert.equal(parseArgs(['--settings', '--dev-bridge']).settings, defaultSettingsPath(process.env));
    assert.equal(parseArgs(['--dev-bridge', '--settings']).devBridge, true);
    assert.equal(parseArgs(['--settings', '/x/s.json']).settings, '/x/s.json');
    assert.equal(parseArgs(['--settings', '/x/s.json', '9000']).port, 9000);
    process.env.REVVIEW_SETTINGS = '/env/s.json';
    assert.equal(parseArgs([]).settings, '/env/s.json');
    assert.equal(parseArgs(['--settings', '/x/s.json']).settings, '/x/s.json');
    assert.equal(parseArgs(['--settings']).settings, defaultSettingsPath(process.env));
  } finally {
    if (old === undefined) delete process.env.REVVIEW_SETTINGS; else process.env.REVVIEW_SETTINGS = old;
  }
});
