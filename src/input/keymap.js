// Button config: parse and validate config/buttons.json. Fails loudly, naming source and field path.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { KEY_CODES } from './keys.js';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const DEFAULT_CONFIG_PATH = fileURLToPath(new URL('../../config/buttons.json', import.meta.url));
export const DEFAULT_TIMING = Object.freeze({ debounceMs: 30, holdMs: 400, longHoldMs: 1000 });

const MODS = ['Ctrl', 'Shift', 'Alt', 'Meta'];
const BUTTON_RE = /^[a-z][a-z0-9-]{0,31}$/;
const KEY_NAME_RE = /^(F([1-9]|1[0-9]|2[0-4])|Up|Down|Left|Right|Enter|Backspace|Space|Esc|[A-Z])$/;
const HEX4 = /^[0-9a-fA-F]{4}$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function parseConfig(obj, source = 'config') {
  const fail = (path, msg) => {
    throw new ConfigError(`${source}: ${path ? `${path}: ` : ''}${msg}`);
  };
  const noExtra = (o, allowed, path) => {
    for (const k of Object.keys(o)) {
      if (!allowed.includes(k)) fail(path ? `${path}.${k}` : k, `unknown field (allowed: ${allowed.join(', ')})`);
    }
  };
  const optString = (o, k, path) => {
    if (o[k] === undefined) return null;
    if (typeof o[k] !== 'string' || o[k] === '') fail(`${path}.${k}`, 'must be a non-empty string');
    return o[k];
  };
  const optHex = (o, k, path) => {
    if (o[k] === undefined) return null;
    if (typeof o[k] !== 'string' || !HEX4.test(o[k])) fail(`${path}.${k}`, 'must be exactly 4 hex digits, e.g. "1d50"');
    return o[k].toLowerCase();
  };

  if (!isObj(obj)) fail('', 'must be a JSON object');
  noExtra(obj, ['note', 'device', 'timing', 'buttons'], '');
  if (obj.note !== undefined && typeof obj.note !== 'string') fail('note', 'must be a string');

  // device
  if (!isObj(obj.device)) fail('device', 'is required and must be an object');
  noExtra(obj.device, ['name', 'vendor', 'product', 'path', 'grab'], 'device');
  const dev = obj.device;
  const device = {
    name: optString(dev, 'name', 'device'),
    vendor: optHex(dev, 'vendor', 'device'),
    product: optHex(dev, 'product', 'device'),
    path: optString(dev, 'path', 'device'),
    grab: true,
  };
  if (device.path !== null && !isAbsolute(device.path)) fail('device.path', 'must be an absolute path');
  if (dev.grab !== undefined) {
    if (typeof dev.grab !== 'boolean') fail('device.grab', 'must be true or false');
    device.grab = dev.grab;
  }
  if (device.name === null && device.vendor === null && device.product === null && device.path === null) {
    fail('device', 'needs at least one of name, vendor, product, path');
  }

  // timing
  const timing = { ...DEFAULT_TIMING };
  if (obj.timing !== undefined) {
    if (!isObj(obj.timing)) fail('timing', 'must be an object');
    noExtra(obj.timing, Object.keys(DEFAULT_TIMING), 'timing');
    for (const k of Object.keys(DEFAULT_TIMING)) {
      const v = obj.timing[k];
      if (v === undefined) continue;
      if (!Number.isInteger(v) || v < 0 || v > 10000) fail(`timing.${k}`, 'must be an integer from 0 to 10000');
      timing[k] = v;
    }
  }
  if (!(timing.debounceMs < timing.holdMs && timing.holdMs < timing.longHoldMs)) {
    fail('timing', `needs debounceMs < holdMs < longHoldMs (got ${timing.debounceMs}, ${timing.holdMs}, ${timing.longHoldMs})`);
  }

  // buttons
  if (!Array.isArray(obj.buttons) || obj.buttons.length === 0) fail('buttons', 'is required and must be a non-empty array');
  const seen = new Map();
  const bindings = obj.buttons.map((b, i) => {
    const p = `buttons[${i}]`;
    if (!isObj(b)) fail(p, 'must be an object');
    noExtra(b, ['key', 'button', 'hold', 'longHold'], p);
    if (typeof b.key !== 'string') fail(`${p}.key`, 'must be a string like "F13" or "Shift+F24"');
    const parts = b.key.split('+');
    const keyPart = parts.pop();
    const mods = [];
    for (const m of parts) {
      if (!MODS.includes(m)) fail(`${p}.key`, `unknown modifier "${m}" in "${b.key}" (use Ctrl, Shift, Alt, Meta, before the key)`);
      if (mods.includes(m)) fail(`${p}.key`, `modifier "${m}" repeated in "${b.key}"`);
      mods.push(m);
    }
    if (!KEY_NAME_RE.test(keyPart)) {
      const hint = MODS.includes(keyPart) ? ' (a key string needs one key last, not only modifiers)' : '';
      fail(`${p}.key`, `unknown key "${keyPart}" (use F1-F24, Up, Down, Left, Right, Enter, Backspace, Space, Esc or a letter A-Z, optionally with Ctrl+, Shift+, Alt+, Meta+)${hint}`);
    }
    if (typeof b.button !== 'string' || !BUTTON_RE.test(b.button)) {
      fail(`${p}.button`, 'must match /^[a-z][a-z0-9-]{0,31}$/ (lowercase letters, digits, dashes)');
    }
    for (const f of ['hold', 'longHold']) {
      if (b[f] !== undefined && typeof b[f] !== 'boolean') fail(`${p}.${f}`, 'must be true or false');
    }
    const sorted = MODS.filter((m) => mods.includes(m)).sort();
    const id = `${sorted.join('+')}+${keyPart}`;
    if (seen.has(id)) fail(p, `key "${b.key}" is the same as buttons[${seen.get(id)}] (buttons[${seen.get(id)}] and buttons[${i}])`);
    seen.set(id, i);
    return Object.freeze({
      mods: Object.freeze(sorted),
      key: KEY_CODES[keyPart],
      keyName: keyPart,
      button: b.button,
      hold: b.hold === true,
      longHold: b.longHold === true,
    });
  });

  return Object.freeze({
    device: Object.freeze(device),
    timing: Object.freeze(timing),
    bindings: Object.freeze(bindings),
  });
}

export function loadConfig(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new ConfigError(`${path}: cannot read file: ${e.message}`);
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`${path}: invalid JSON: ${e.message}`);
  }
  return parseConfig(obj, path);
}
