// Lights on the live server: the lights module's frames reach the driver as the board changes (a recording driver is injected).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startLiveServer, parseArgs } from '../../src/server/index.js';
import { createSpiDriver } from '../../src/lights/index.js';

const SERVER = fileURLToPath(new URL('../../src/server/index.js', import.meta.url));
const T = { timeout: 20000 };
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const DARK = [0, 0, 0];
const AMBER = [48, 33, 6]; // #ffb020 under the day cap 48
const GREEN = [15, 41, 23]; // #4fdc7a under the day cap 48
const CONFIG = (lights = 'on') => ({ lights, leds: 3, driver: 'none', device: '/dev/spidev0.0', brightness: { day: 48, night: 12 } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await sleep(20);
  }
}
const recorder = () => {
  const d = { frames: [], closed: 0, show(f) { d.frames.push(f); }, close() { d.closed++; return Promise.resolve(); } };
  return d;
};
const CODES = { menu: 'F23', down: 'F18', press: 'F21' };
const isDark = (f) => f.every((p) => p.join(',') === '0,0,0');
const post = (s, e) => fetch(`${s.url}/event`, { method: 'POST', body: JSON.stringify(e) });

async function withServer(opts, fn) {
  const driver = recorder();
  const s = await startLiveServer({ port: 0, devBridge: true, lights: opts.noLights ? null : { config: opts.config ?? CONFIG(), driver }, ...opts.server });
  const ev = async (e) => assert.equal((await post(s, e)).status, 204);
  const key = async (code) => {
    const n = s.gestures().length;
    await fetch(`${s.url}/dev/key`, { method: 'POST', body: JSON.stringify({ code, type: 'down' }) });
    await fetch(`${s.url}/dev/key`, { method: 'POST', body: JSON.stringify({ code, type: 'up' }) });
    await until(() => s.gestures().length > n, 'a gesture');
    await sleep(40);
  };
  const last = () => driver.frames.at(-1);
  const devLights = async () => (await fetch(`${s.url}/dev/lights`)).json();
  try {
    await fn({ s, ev, key, driver, last, devLights });
  } finally {
    await s.close();
  }
}

test('permission request: LED 0 amber (capped, flashing); Stop: green steady; SessionEnd: dark', T, () => withServer({}, async (c) => {
  assert.deepEqual(c.driver.frames[0], [DARK, DARK, DARK]); // the first frame, at creation: nobody yet
  await c.ev({ hook_event_name: 'SessionStart', session_id: A, cwd: '/w/a' });
  await c.ev({ hook_event_name: 'UserPromptSubmit', session_id: A, prompt: 'go' });
  await c.ev({ hook_event_name: 'PermissionRequest', session_id: A, tool_name: 'Bash', tool_input: { command: 'ls' } });
  const seen = new Set();
  await until(() => { for (const f of c.driver.frames) seen.add(f[0].join(',')); return seen.has(AMBER.join(',')) && seen.has('0,0,0'); }, 'the slow flash (amber and dark)', 5000);
  assert.deepEqual(c.driver.frames.at(-1).slice(1), [DARK, DARK]);
  await c.ev({ hook_event_name: 'Stop', session_id: A, last_assistant_message: 'done' });
  await until(() => c.last()[0].join(',') === GREEN.join(','), 'green');
  const n = c.driver.frames.length;
  await sleep(600);
  assert.equal(c.driver.frames.length, n, 'steady: no more frames');
  assert.deepEqual((await c.devLights()).frame[0], GREEN);
  await c.ev({ hook_event_name: 'SessionEnd', session_id: A });
  await until(() => isDark(c.last()), 'dark after SessionEnd');
}));

test('the Settings row Lights turns the lights off (a dark frame) and on again', T, () => withServer({}, async (c) => {
  await c.ev({ hook_event_name: 'SessionStart', session_id: A, cwd: '/w/a' });
  await c.ev({ hook_event_name: 'Stop', session_id: A, last_assistant_message: 'done' });
  await until(() => c.last()[0].join(',') === GREEN.join(','), 'green');
  assert.equal((await c.devLights()).lights, 'on');
  for (const b of ['menu', 'down', 'down', 'press', 'down', 'down', 'down', 'down']) await c.key(CODES[b]);
  await c.key(CODES.press);
  await until(async () => (await c.devLights()).lights === 'off', 'lights off');
  await until(() => isDark(c.last()), 'dark frame');
  assert.equal((await c.devLights()).lights, 'off');
  await c.key(CODES.press);
  await until(async () => (await c.devLights()).lights === 'on', 'lights on');
  await until(() => c.last()[0].join(',') === GREEN.join(','), 'green again');
}));

test('config lights off: dark at start, the board says off; close() shows a dark frame and closes the driver', T, async () => {
  const driver = recorder();
  const s = await startLiveServer({ port: 0, devBridge: true, lights: { config: CONFIG('off'), driver } });
  try {
    assert.equal((await (await fetch(`${s.url}/dev/lights`)).json()).lights, 'off');
    assert.deepEqual(driver.frames, [[DARK, DARK, DARK]]);
  } finally { await s.close(); }
  assert.equal(driver.closed, 1);
  assert.deepEqual(driver.frames.at(-1), [DARK, DARK, DARK]);
});

test('close() while a session is lit: the last show is all dark, driver.close ran once', T, async () => {
  const driver = recorder();
  const s = await startLiveServer({ port: 0, lights: { config: CONFIG(), driver } });
  await post(s, { hook_event_name: 'SessionStart', session_id: A, cwd: '/w/a' });
  await post(s, { hook_event_name: 'Stop', session_id: A, last_assistant_message: 'x' });
  await until(() => driver.frames.at(-1)[0].join(',') === GREEN.join(','), 'green');
  await s.close();
  assert.equal(driver.closed, 1);
  assert.ok(isDark(driver.frames.at(-1)));
  const n = driver.frames.length;
  await sleep(400);
  assert.equal(driver.frames.length, n, 'no frames after close');
});

test('without the option: no lights on the board, no row, /dev/lights has nothing', T, () => withServer({ noLights: true }, async (c) => {
    assert.deepEqual(await c.devLights(), { lights: null, frame: [], dayCap: null });
  for (const b of ['menu', 'down', 'down', 'press']) await c.key(CODES[b]);
  assert.equal(c.s.state().nav?.kind, 'settings');
  assert.doesNotMatch(JSON.stringify(c.s.state()), /Lights:/);
}));

test('/dev/lights is not there without the dev bridge', T, async () => {
  const s = await startLiveServer({ port: 0, lights: { config: CONFIG(), driver: recorder() } });
  try {
    const r = await fetch(`${s.url}/dev/lights`);
    assert.notEqual(r.headers.get('content-type'), 'application/json');
  } finally { await s.close(); }
});

test('/dev/lights answers no-store JSON with the frame', T, () => withServer({}, async (c) => {
  const r = await fetch(`${c.s.url}/dev/lights`);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await r.json(), { lights: 'on', frame: [DARK, DARK, DARK], dayCap: 48 });
}));

test('a driver that cannot start: exactly one stopped line, the server keeps answering, no respawn', T, async () => {
  const lines = [];
  const driver = createSpiDriver({ argv: ['/nonexistent/revview-no-such-program'], log: (m) => lines.push(m), leds: 3 });
  const s = await startLiveServer({ port: 0, lights: { config: { ...CONFIG(), driver: 'ws2812-spi' }, driver } });
  try {
    await until(() => lines.length > 0, 'the stopped line');
    for (const id of [A, B]) {
      await post(s, { hook_event_name: 'SessionStart', session_id: id, cwd: '/w/x' });
      await post(s, { hook_event_name: 'Stop', session_id: id, last_assistant_message: 'x' });
    }
    await sleep(500);
    assert.equal((await fetch(`${s.url}/state`)).status, 200);
    assert.equal(lines.filter((l) => /lights: LED driver stopped/.test(l)).length, 1, lines.join('\n'));
    assert.equal(lines.length, 1);
  } finally { await s.close(); }
  assert.equal(lines.length, 1, 'close adds no line');
});

test('parseArgs: --lights-config takes a file', () => {
  assert.equal(parseArgs(['--lights-config', '/x/lights.json']).lightsConfig, '/x/lights.json');
  assert.equal(parseArgs([]).lightsConfig, undefined);
  assert.throws(() => parseArgs(['--lights-config']), /--lights-config needs a file/);
  assert.throws(() => parseArgs(['--lights-config', '--boot']), /--lights-config needs a file/);
});

// a bad or missing file must not stop the bar: the Pi service restarts on exit, an exit would loop
async function runsWithout(file, errRe) {
  const child = spawn(process.execPath, [SERVER, '0', '--lights-config', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  try {
    await until(() => /^lights: /m.test(out), 'the lights line');
    assert.match(out, /^lights: none \(bad lights config, see the log\)$/m);
    assert.match(err, errRe);
    assert.equal(child.exitCode, null, 'the server keeps running');
  } finally {
    child.kill('SIGTERM');
    await until(() => child.exitCode !== null || child.signalCode !== null, 'exit').catch(() => child.kill('SIGKILL'));
  }
}

test('the CLI: a missing lights config logs the message and the server runs without lights', T, async () => {
  await runsWithout('/nonexistent/lights.json', /lights config: cannot read \/nonexistent\/lights\.json/);
});

test('the CLI: a good config prints the lights line; a bad one (not JSON) runs without lights', T, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-lights-'));
  try {
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, '{nope');
    await runsWithout(bad, /not valid JSON/);
    const good = path.join(dir, 'good.json');
    fs.writeFileSync(good, JSON.stringify({ lights: 'off', leds: 8, driver: 'none' }));
    const child = spawn(process.execPath, [SERVER, '0', '--lights-config', good], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    try {
      await until(() => /lights: off/.test(out), 'the lights line');
      assert.match(out, /^lights: off \(no driver, 8 LEDs, untested on hardware\)$/m);
    } finally {
      child.kill('SIGTERM');
      await until(() => child.exitCode !== null || child.signalCode !== null, 'exit').catch(() => child.kill('SIGKILL'));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
