import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadLightsConfig, LightsConfigError, DEFAULT_LIGHTS_CONFIG_PATH } from '../../src/lights/config.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-cfg-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
let n = 0;
const load = (text) => { const f = path.join(dir, `c${n++}.json`); fs.writeFileSync(f, typeof text === 'string' ? text : JSON.stringify(text)); return loadLightsConfig(f); };
const bad = (c, re) => assert.throws(() => load(c), (e) => e instanceof LightsConfigError && re.test(e.message));

test('defaults', () => {
  assert.deepEqual(load({ lights: 'off' }), { lights: 'off', leds: 8, driver: 'ws2812-spi', device: '/dev/spidev0.0', brightness: { day: 48, night: 12 } });
  assert.match(DEFAULT_LIGHTS_CONFIG_PATH, /config[\\/]lights\.json$/);
});

test('full config, _ comments ignored', () => {
  const c = load({ _note: 'x', lights: 'on', leds: 4, driver: 'none', device: '/dev/spidev1.2', brightness: { day: 64, night: 1 } });
  assert.deepEqual(c, { lights: 'on', leds: 4, driver: 'none', device: '/dev/spidev1.2', brightness: { day: 64, night: 1 } });
});

test('errors are clear', () => {
  bad({}, /"lights" must be/);
  bad({ lights: 'yes' }, /"lights" must be/);
  bad({ lights: 'on', leds: 0 }, /"leds"/);
  bad({ lights: 'on', leds: 9 }, /"leds"/);
  bad({ lights: 'on', leds: 2.5 }, /"leds"/);
  bad({ lights: 'on', driver: 'x' }, /"driver"/);
  bad({ lights: 'on', device: '/dev/null' }, /"device"/);
  bad({ lights: 'on', device: '/dev/spidev0.0; rm' }, /"device"/);
  bad({ lights: 'on', brightness: { day: 65 } }, /brightness\.day/);
  bad({ lights: 'on', brightness: { night: 0 } }, /brightness\.night/);
  bad({ lights: 'on', brightness: 5 }, /"brightness"/);
  bad('{nope', /not valid JSON/);
  bad('[]', /JSON object/);
  assert.throws(() => loadLightsConfig(path.join(dir, 'missing.json')), LightsConfigError);
});
