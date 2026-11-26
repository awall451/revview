import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAX_SESSIONS } from '../state/index.js';
import { MAX_BRIGHTNESS } from './frames.js';

export const DEFAULT_LIGHTS_CONFIG_PATH = fileURLToPath(new URL('../../config/lights.json', import.meta.url));

export class LightsConfigError extends Error {
  constructor(message) {
    super(`lights config: ${message}`);
    this.name = 'LightsConfigError';
  }
}

const isObj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);
const int = (v, lo, hi, name) => {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new LightsConfigError(`"${name}" must be a whole number from ${lo} to ${hi}, got ${JSON.stringify(v)}`);
  return v;
};

const unknownKeys = (o, allowed, prefix) => {
  for (const k of Object.keys(o)) {
    if (!k.startsWith('_') && !allowed.includes(k)) throw new LightsConfigError(`unknown key "${prefix}${k}" (allowed: ${allowed.join(', ')})`);
  }
};

// -> { lights, leds, driver, device, brightness: { day, night } }; throws LightsConfigError. Keys starting with _ are comments.
export function loadLightsConfig(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new LightsConfigError(`cannot read ${file}: ${e?.code ?? e?.message ?? e}`);
  }
  let c;
  try {
    c = JSON.parse(raw);
  } catch (e) {
    throw new LightsConfigError(`${file} is not valid JSON: ${e.message}`);
  }
  if (!isObj(c)) throw new LightsConfigError(`${file} must hold a JSON object`);
  unknownKeys(c, ['lights', 'leds', 'driver', 'device', 'brightness'], '');
  if (c.lights !== 'off' && c.lights !== 'on') throw new LightsConfigError(`"lights" must be "off" or "on", got ${JSON.stringify(c.lights)}`);
  const leds = c.leds === undefined ? MAX_SESSIONS : int(c.leds, 1, MAX_SESSIONS, 'leds');
  const driver = c.driver === undefined ? 'ws2812-spi' : c.driver;
  if (driver !== 'ws2812-spi' && driver !== 'none') throw new LightsConfigError(`"driver" must be "ws2812-spi" or "none", got ${JSON.stringify(driver)}`);
  const device = c.device === undefined ? '/dev/spidev0.0' : c.device;
  if (typeof device !== 'string' || !/^\/dev\/spidev\d+\.\d+$/.test(device)) throw new LightsConfigError(`"device" must look like "/dev/spidev0.0", got ${JSON.stringify(device)}`);
  const b = c.brightness === undefined ? {} : c.brightness;
  if (!isObj(b)) throw new LightsConfigError('"brightness" must be an object like { "day": 48, "night": 12 }');
  unknownKeys(b, ['day', 'night'], 'brightness.');
  const brightness = {
    day: b.day === undefined ? 48 : int(b.day, 1, MAX_BRIGHTNESS, 'brightness.day'),
    night: b.night === undefined ? 12 : int(b.night, 1, MAX_BRIGHTNESS, 'brightness.night'),
  };
  return { lights: c.lights, leds, driver, device, brightness };
}
