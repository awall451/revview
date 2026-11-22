import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { parseConfig, loadConfig, ConfigError, DEFAULT_CONFIG_PATH, DEFAULT_TIMING } from '../../src/input/keymap.js';

const base = () => ({ device: { vendor: '1D50' }, buttons: [{ key: 'F13', button: 'push-to-talk' }] });
const bad = (obj, re) => assert.throws(() => parseConfig(obj, 'x.json'), (e) => {
  assert.ok(e instanceof ConfigError);
  assert.match(e.message, /^x\.json: /);
  assert.match(e.message, re);
  return true;
});

test('minimal config, defaults and normalisation', () => {
  const c = parseConfig(base());
  assert.deepEqual(c.device, { name: null, vendor: '1d50', product: null, path: null, grab: true });
  assert.deepEqual(c.timing, { debounceMs: 30, holdMs: 400, longHoldMs: 1000 });
  assert.deepEqual(DEFAULT_TIMING, c.timing);
  assert.deepEqual(c.bindings, [{ mods: [], key: 183, keyName: 'F13', button: 'push-to-talk', hold: false, longHold: false }]);
  assert.ok(Object.isFrozen(c));
  assert.ok(Object.isFrozen(c.bindings));
  assert.ok(Object.isFrozen(c.bindings[0]));
});

test('combo keys give sorted unique mods', () => {
  const o = base();
  o.buttons = [{ key: 'Shift+Ctrl+F24', button: 'spare', hold: true }];
  const b = parseConfig(o).bindings[0];
  assert.deepEqual(b.mods, ['Ctrl', 'Shift']);
  assert.equal(b.key, 194);
  assert.equal(b.keyName, 'F24');
  assert.equal(b.hold, true);
});

test('device options', () => {
  const c = parseConfig({ device: { path: '/dev/input/event3', grab: false, name: 'n', product: 'ABCD' }, buttons: base().buttons });
  assert.deepEqual(c.device, { name: 'n', vendor: null, product: 'abcd', path: '/dev/input/event3', grab: false });
});

test('same button on two keys is allowed', () => {
  const o = base();
  o.buttons.push({ key: 'F14', button: 'push-to-talk' });
  assert.equal(parseConfig(o).bindings.length, 2);
});

test('errors name source and field path', () => {
  const o = base();
  o.buttons = [{ key: 'F13', button: 'a' }, { key: 'F14', button: 'b' }, { key: 'F15', button: 'c' }, { key: 'F25', button: 'd' }];
  bad(o, /buttons\[3\]\.key: unknown key "F25" \(use F1-F24, optionally with Ctrl\+, Shift\+, Alt\+, Meta\+\)/);
});

test('rejections', () => {
  const bt = base().buttons;
  const withBtn = (b) => ({ ...base(), buttons: [b] });
  bad(null, /object/);
  bad({ buttons: bt }, /device/);
  bad({ device: {}, buttons: bt }, /device: .*name.*vendor/);
  bad({ device: { vendor: '1d5' }, buttons: bt }, /device\.vendor/);
  bad({ device: { vendor: 'zzzz' }, buttons: bt }, /device\.vendor/);
  bad({ device: { product: 5 }, buttons: bt }, /device\.product/);
  bad({ device: { path: 'rel/x' }, buttons: bt }, /device\.path/);
  bad({ device: { name: 'n', grab: 'yes' }, buttons: bt }, /device\.grab/);
  bad({ device: { name: 'n', extra: 1 }, buttons: bt }, /device\.extra/);
  bad({ ...base(), extra: 1 }, /extra/);
  bad({ ...base(), note: 5 }, /note/);
  bad({ ...base(), buttons: [] }, /buttons/);
  bad({ ...base(), buttons: 'x' }, /buttons/);
  bad(withBtn({ key: 'F13', button: 'a', foo: 1 }), /buttons\[0\]\.foo/);
  bad(withBtn({ key: 'F13' }), /buttons\[0\]\.button/);
  bad(withBtn({ key: 'F13', button: 'Bad' }), /buttons\[0\]\.button/);
  bad(withBtn({ key: 'F13', button: '1a' }), /buttons\[0\]\.button/);
  bad(withBtn({ key: 'F13', button: 'a'.repeat(33) }), /buttons\[0\]\.button/);
  bad(withBtn({ key: 'F13', button: 'a', hold: 1 }), /buttons\[0\]\.hold/);
  bad(withBtn({ key: 'F13', button: 'a', longHold: 'x' }), /buttons\[0\]\.longHold/);
  bad(withBtn({ key: 'Shift', button: 'a' }), /buttons\[0\]\.key/);
  bad(withBtn({ key: 'F13+F14', button: 'a' }), /buttons\[0\]\.key/);
  bad(withBtn({ key: 'F13+Shift', button: 'a' }), /buttons\[0\]\.key/);
  bad(withBtn({ key: 'Shift+Shift+F13', button: 'a' }), /buttons\[0\]\.key/);
  bad(withBtn({ key: 'shift+F13', button: 'a' }), /buttons\[0\]\.key/);
  bad(withBtn({ key: 7, button: 'a' }), /buttons\[0\]\.key/);
  bad(withBtn({ key: '', button: 'a' }), /buttons\[0\]\.key/);
});

test('duplicate bindings name both indexes, modifier order ignored', () => {
  bad({ ...base(), buttons: [{ key: 'F13', button: 'a' }, { key: 'Ctrl+Shift+F14', button: 'b' }, { key: 'Shift+Ctrl+F14', button: 'c' }] },
    /buttons\[2\].*buttons\[1\]|buttons\[1\].*buttons\[2\]/);
});

test('timing validation', () => {
  const t = (timing) => ({ ...base(), timing });
  assert.deepEqual(parseConfig(t({ holdMs: 500 })).timing, { debounceMs: 30, holdMs: 500, longHoldMs: 1000 });
  assert.equal(parseConfig(t({ debounceMs: 0 })).timing.debounceMs, 0);
  bad(t({ debounceMs: 400 }), /timing/);
  bad(t({ holdMs: 1000 }), /timing/);
  bad(t({ holdMs: 1.5 }), /timing\.holdMs/);
  bad(t({ longHoldMs: 10001 }), /timing/);
  bad(t({ debounceMs: -1 }), /timing\.debounceMs/);
  bad(t({ holdMs: '400' }), /timing\.holdMs/);
  bad(t({ foo: 1 }), /timing\.foo/);
});

test('loadConfig: file errors and JSON errors start with the path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'keymap-'));
  const missing = join(dir, 'nope.json');
  assert.throws(() => loadConfig(missing), (e) => e instanceof ConfigError && e.message.startsWith(missing));
  const broken = join(dir, 'broken.json');
  writeFileSync(broken, '{ nope');
  assert.throws(() => loadConfig(broken), (e) => e instanceof ConfigError && e.message.startsWith(broken));
  const invalid = join(dir, 'invalid.json');
  writeFileSync(invalid, '{"device":{"name":"x"},"buttons":[]}');
  assert.throws(() => loadConfig(invalid), (e) => e instanceof ConfigError && e.message.startsWith(`${invalid}: buttons`));
});

test('shipped config/buttons.json matches the BUTTONS.md table', () => {
  assert.ok(isAbsolute(DEFAULT_CONFIG_PATH));
  const c = loadConfig(DEFAULT_CONFIG_PATH);
  assert.equal(c.device.vendor, '1d50');
  assert.equal(c.device.product, '615e');
  assert.equal(c.device.path, null);
  assert.equal(c.device.grab, true);
  const expect = [
    ['F13', 'push-to-talk', false, false], ['F14', 'read-aloud', true, false], ['F15', 'cancel', false, true],
    ['F16', 'deny', false, false], ['F17', 'up', false, false], ['F18', 'down', false, false],
    ['F19', 'left', false, false], ['F20', 'right', false, false], ['F21', 'press', false, false],
    ['F22', 'back', true, false], ['F23', 'menu', false, false], ['F24', 'spare', false, false],
  ];
  assert.deepEqual(c.bindings.map((b) => [b.keyName, b.button, b.hold, b.longHold]), expect);
  assert.ok(c.bindings.every((b) => b.mods.length === 0));
});
