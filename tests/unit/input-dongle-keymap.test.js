import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConfig, DEFAULT_CONFIG_PATH } from '../../src/input/keymap.js';
import { renderDongleRule } from '../../pi/setup.mjs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

// The F-key table of docs/BUTTONS.md section 1: | Label | F13 | pod |
function docTable() {
  const rows = [];
  for (const line of read('docs/BUTTONS.md').split('\n')) {
    const m = /^\| ([^|]+) \| (F(?:1[3-9]|2[0-4])) \| ([^|]+) \|$/.exec(line);
    if (m) rows.push({ label: m[1].trim(), key: m[2] });
  }
  return rows;
}

test('the shipped key map covers every F13-F24 action of the BUTTONS.md table, once', () => {
  const rows = docTable();
  assert.equal(rows.length, 12);
  const cfg = loadConfig(DEFAULT_CONFIG_PATH);
  assert.equal(cfg.bindings.length, 12);
  for (const r of rows) {
    const b = cfg.bindings.filter((x) => x.keyName === r.key && x.mods.length === 0);
    assert.equal(b.length, 1, `${r.key} (${r.label}) has exactly one binding`);
  }
  assert.deepEqual(
    cfg.bindings.map((b) => b.button),
    ['push-to-talk', 'read-aloud', 'cancel', 'deny', 'up', 'down', 'left', 'right', 'press', 'back', 'menu', 'spare'],
  );
});

test('the dongle USB ids in the config and the udev rule agree', () => {
  const cfg = loadConfig(DEFAULT_CONFIG_PATH);
  const template = read('pi/70-revview-dongle.rules');
  assert.match(template, /idVendor\}=="@VENDOR@"/);
  assert.match(template, /idProduct\}=="@PRODUCT@"/);
  // the installed rule: the template with the ids of the config (/etc/revview/buttons.json, created from this one)
  const rule = renderDongleRule(template, cfg.device);
  assert.doesNotMatch(rule, /@VENDOR@|@PRODUCT@/);
  assert.match(rule, new RegExp(`idVendor\\}=="${cfg.device.vendor}"`));
  assert.match(rule, new RegExp(`idProduct\\}=="${cfg.device.product}"`));
});

test('the reference ZMK keymap sends F13-F24 as plain keys, in table order', () => {
  const keymap = read('docs/zmk/wheel.keymap');
  const keys = [...keymap.matchAll(/&kp (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(keys, docTable().map((r) => r.key));
  assert.doesNotMatch(keymap.replace(/\/\*[\s\S]*?\*\//g, ''), /&(mt|lt|sk|sl|mo|to|tog)\b/, 'no hold-tap or layers in firmware');
});

test('the unit passes --input and --sessions and never --dev-bridge', () => {
  const unit = read('pi/revview.service');
  const exec = unit.split('\n').find((l) => l.startsWith('ExecStart='));
  assert.match(exec, /--input /);
  assert.match(exec, /--sessions/);
  assert.doesNotMatch(exec, /--dev-bridge/);
  assert.doesNotMatch(unit.replace(/^#.*$/gm, ''), /^(Requires|Wants|After|Before|BindsTo)=/m);
});
