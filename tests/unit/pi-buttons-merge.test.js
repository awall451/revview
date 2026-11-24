// Three-way merge of /etc/revview/buttons.json on update (pi/setup.mjs), against a fake root. UNTESTED on a Pi.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeJson, serializeButtons } from '../../pi/setup.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = path.join(ROOT, 'tests/unit/fixtures/pi');
const SETUP = path.join(ROOT, 'pi/setup.mjs');
const SHIPPED_TEXT = fs.readFileSync(path.join(ROOT, 'config/buttons.json'), 'utf8');
const SHIPPED = JSON.parse(SHIPPED_TEXT);
const clone = (v) => JSON.parse(JSON.stringify(v));
const ser = (v) => `${JSON.stringify(v, null, 2)}\n`;

function fakeRoot() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'revview-merge-'));
  fs.mkdirSync(path.join(r, 'boot/firmware'), { recursive: true });
  fs.mkdirSync(path.join(r, 'etc/lightdm'), { recursive: true });
  for (const [f, d] of [['cmdline.txt', 'boot/firmware'], ['config.txt', 'boot/firmware'], ['lightdm.conf', 'etc/lightdm']]) {
    fs.copyFileSync(path.join(FIX, f), path.join(r, d, f));
  }
  return r;
}
function cli(r, extra = []) {
  const args = [SETUP, '--root', r, '--user', 'alice', '--home', '/home/alice', '--dir', '/opt/revview',
    '--node', '/usr/local/bin/node', '--owner', `${process.getuid()}:${process.getgid()}`, ...extra];
  const p = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { code: p.status, out: p.stdout, err: p.stderr };
}
function snapshot(r) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) out[p] = `-> ${fs.readlinkSync(p)}`;
      else if (e.isDirectory()) { out[p] = 'dir'; walk(p); } else out[p] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(r);
  return out;
}
const BTN = 'etc/revview/buttons.json';
const BASE = 'var/lib/revview/buttons.shipped.json';
const put = (r, rel, text) => { fs.mkdirSync(path.dirname(path.join(r, rel)), { recursive: true }); fs.writeFileSync(path.join(r, rel), text); };
const get = (r, rel) => fs.readFileSync(path.join(r, rel), 'utf8');
const getJ = (r, rel) => JSON.parse(get(r, rel));
const backups = (r) => fs.readdirSync(path.join(r, 'etc/revview')).filter((n) => n.startsWith('buttons.json.revview-backup-')).sort();
const withRoot = (fn) => () => {
  const r = fakeRoot();
  try { fn(r); } finally { fs.rmSync(r, { recursive: true, force: true }); }
};
// base: the shipped file as an earlier release had it; mine: the owner's file.
const setup = (r, base, mine) => {
  if (base) put(r, BASE, ser(base));
  if (mine) put(r, BTN, typeof mine === 'string' ? mine : ser(mine));
};
const oldShipped = (fn) => { const b = clone(SHIPPED); fn(b); return b; };

test('serializeButtons reproduces the shipped file byte for byte', () => {
  assert.equal(serializeButtons(SHIPPED), SHIPPED_TEXT);
});

test('mergeJson: per leaf, arrays are one value, removal vs edit conflicts', () => {
  const b = { a: 1, k: [1, 2], x: { y: 1 }, gone: 5 };
  assert.deepEqual(mergeJson(b, { a: 2, k: [1, 2], x: { y: 1 } }, { a: 1, k: [1, 2, 3], x: { y: 1 }, gone: 5 }),
    { value: { a: 2, k: [1, 2, 3], x: { y: 1 } }, conflicts: [] });
  assert.deepEqual(mergeJson(b, { a: 1, k: [9], x: { y: 1 }, gone: 5 }, { a: 1, k: [1, 2, 3], x: { y: 1 }, gone: 5 }).conflicts, ['k']);
  assert.deepEqual(mergeJson(b, { a: 1, k: [1, 2], x: { y: 1 } }, { a: 1, k: [1, 2], x: { y: 1 }, gone: 6 }).conflicts, ['gone']);
  assert.deepEqual(mergeJson(b, { a: 1, k: [1, 2], x: { y: 2 }, gone: 5 }, { a: 1, k: [1, 2], x: { y: 3 }, gone: 5 }).conflicts, ['x.y']);
  assert.deepEqual(mergeJson(b, { a: 7, k: [1, 2], x: { y: 1 }, gone: 5 }, { a: 7, k: [1, 2], x: { y: 1 }, gone: 5 }).conflicts, []);
});

test('first install: file created, shipped version recorded', withRoot((r) => {
  assert.equal(cli(r).code, 0);
  assert.equal(get(r, BTN), SHIPPED_TEXT);
  assert.equal(get(r, BASE), SHIPPED_TEXT);
  assert.equal(fs.statSync(path.join(r, BASE)).mode & 0o777, 0o644);
}));

test('no change: nothing is written, no backup', withRoot((r) => {
  setup(r, SHIPPED, SHIPPED_TEXT);
  put(r, BASE, SHIPPED_TEXT);
  cli(r);
  const before = snapshot(r);
  const res = cli(r);
  assert.equal(res.code, 0, res.err);
  assert.deepEqual(snapshot(r), before);
  assert.equal(backups(r).length, 0);
}));

test('upstream-only change: the owner (unchanged) follows; backup holds the old file', withRoot((r) => {
  const old = oldShipped((b) => { b.timing.holdMs = 300; });
  setup(r, old, old);
  const oldText = get(r, BTN);
  const res = cli(r);
  assert.equal(res.code, 0, res.err);
  assert.equal(get(r, BTN), SHIPPED_TEXT);
  assert.equal(get(r, BASE), SHIPPED_TEXT);
  assert.equal(backups(r).length, 1);
  assert.equal(fs.readFileSync(path.join(r, 'etc/revview', backups(r)[0]), 'utf8'), oldText);
  assert.equal(fs.statSync(path.join(r, BTN)).mode & 0o777, 0o644);
  assert.match(res.out, /merging/);
}));

test('owner-only change: kept byte for byte, not rewritten, no backup, the rule follows', withRoot((r) => {
  const mine = `${SHIPPED_TEXT.replace('"615e"', '"abcd"')}`; // formatting is the owner's
  setup(r, SHIPPED, mine);
  const res = cli(r);
  assert.equal(res.code, 0, res.err);
  assert.equal(get(r, BTN), mine);
  assert.equal(backups(r).length, 0);
  assert.match(get(r, 'etc/udev/rules.d/70-revview-dongle.rules'), /abcd/);
}));

test('both changed, different keys: both kept, the rule from the merged file, old file backed up', withRoot((r) => {
  const old = oldShipped((b) => { b.timing.holdMs = 300; });
  const mine = clone(old);
  mine.device.product = 'abcd';
  setup(r, old, mine);
  const mineText = get(r, BTN);
  const res = cli(r);
  assert.equal(res.code, 0, res.err);
  const out = getJ(r, BTN);
  assert.equal(out.timing.holdMs, 400);
  assert.equal(out.device.product, 'abcd');
  assert.match(get(r, 'etc/udev/rules.d/70-revview-dongle.rules'), /abcd/);
  assert.equal(fs.readFileSync(path.join(r, 'etc/revview', backups(r)[0]), 'utf8'), mineText);
  assert.equal(get(r, BASE), SHIPPED_TEXT);
}));

test('both changed the same key to the same value: no conflict, no rewrite', withRoot((r) => {
  const old = oldShipped((b) => { b.timing.holdMs = 300; });
  setup(r, old, SHIPPED_TEXT);
  const res = cli(r);
  assert.equal(res.code, 0, res.err);
  assert.equal(get(r, BTN), SHIPPED_TEXT);
  assert.equal(backups(r).length, 0);
  assert.equal(get(r, BASE), SHIPPED_TEXT);
}));

test('real conflict: nothing written for the key map, exit 4, the diff command in the message', withRoot((r) => {
  const old = oldShipped((b) => { b.timing.holdMs = 300; });
  const mine = clone(old);
  mine.timing.holdMs = 350;
  setup(r, old, mine);
  const before = { btn: get(r, BTN), base: get(r, BASE) };
  const res = cli(r);
  assert.equal(res.code, 4);
  assert.equal(get(r, BTN), before.btn);
  assert.equal(get(r, BASE), before.base);
  assert.equal(backups(r).length, 0);
  assert.match(res.out + res.err, /timing\.holdMs/);
  assert.match(res.out + res.err, /diff \/etc\/revview\/buttons\.json \/opt\/revview\/config\/buttons\.json/);
}));

test('key added upstream is added; key removed upstream is removed', withRoot((r) => {
  const old = oldShipped((b) => { delete b.timing.debounceMs; b.legacy = 1; });
  setup(r, old, old);
  const res = cli(r);
  assert.equal(res.code, 0, res.err);
  const out = getJ(r, BTN);
  assert.equal(out.timing.debounceMs, 30);
  assert.equal('legacy' in out, false);
}));

test('key removed upstream but edited by the owner: conflict', withRoot((r) => {
  const old = oldShipped((b) => { b.legacy = 1; });
  const mine = clone(old);
  mine.legacy = 2;
  setup(r, old, mine);
  const before = get(r, BTN);
  const res = cli(r);
  assert.equal(res.code, 4);
  assert.equal(get(r, BTN), before);
  assert.match(res.out + res.err, /legacy/);
}));

test('no recorded base: equal to the new shipped file -> base recorded', withRoot((r) => {
  setup(r, null, SHIPPED_TEXT);
  const res = cli(r);
  assert.equal(res.code, 0, res.err);
  assert.equal(get(r, BASE), SHIPPED_TEXT);
}));

test('no recorded base: differs -> kept, a note with the diff command and how to adopt; --adopt-buttons-base records', withRoot((r) => {
  const mine = clone(SHIPPED);
  mine.timing.holdMs = 123;
  setup(r, null, mine);
  const mineText = get(r, BTN);
  let res = cli(r);
  assert.equal(res.code, 0, res.err);
  assert.equal(get(r, BTN), mineText);
  assert.equal(fs.existsSync(path.join(r, BASE)), false);
  assert.match(res.out, /note:.*diff \/etc\/revview\/buttons\.json \/opt\/revview\/config\/buttons\.json/);
  assert.match(res.out, /--adopt-buttons-base/);
  res = cli(r, ['--adopt-buttons-base']);
  assert.equal(res.code, 0, res.err);
  assert.equal(get(r, BTN), mineText);
  assert.equal(get(r, BASE), SHIPPED_TEXT);
  // later runs merge
  assert.equal(cli(r).code, 0);
  assert.equal(get(r, BTN), mineText);
}));

test('damaged owner file: exit 4, nothing written for it, no base', withRoot((r) => {
  setup(r, SHIPPED, '{ "device": ');
  const res = cli(r);
  assert.equal(res.code, 4);
  assert.equal(get(r, BTN), '{ "device": ');
  assert.equal(backups(r).length, 0);
  assert.match(res.out + res.err, /not valid JSON/);
}));

test('backups are bounded: the newest 3 are kept', withRoot((r) => {
  for (let i = 0; i < 5; i++) {
    const old = oldShipped((b) => { b.timing.holdMs = 100 + i; });
    setup(r, old, old);
    assert.equal(cli(r).code, 0);
  }
  assert.equal(backups(r).length, 3);
  // the newest backup is the last old file
  assert.equal(JSON.parse(fs.readFileSync(path.join(r, 'etc/revview', backups(r).at(-1)), 'utf8')).timing.holdMs, 104);
}));

test('second run after a merge: nothing changes', withRoot((r) => {
  const old = oldShipped((b) => { b.timing.holdMs = 300; });
  const mine = clone(old);
  mine.device.product = 'abcd';
  setup(r, old, mine);
  assert.equal(cli(r).code, 0);
  const before = snapshot(r);
  const res = cli(r);
  assert.equal(res.code, 0, res.err);
  assert.deepEqual(snapshot(r), before);
}));

test('--dry-run says what the merge would do and writes nothing', withRoot((r) => {
  const old = oldShipped((b) => { b.timing.holdMs = 300; });
  setup(r, old, old);
  const before = snapshot(r);
  const res = cli(r, ['--dry-run']);
  assert.equal(res.code, 0, res.err);
  assert.match(res.out, /would merge.*timing\.holdMs/);
  assert.deepEqual(snapshot(r), before);
}));

test('--dry-run with a conflict: refuses the same way, writes nothing', withRoot((r) => {
  const old = oldShipped((b) => { b.timing.holdMs = 300; });
  const mine = clone(old);
  mine.timing.holdMs = 350;
  setup(r, old, mine);
  const before = snapshot(r);
  assert.equal(cli(r, ['--dry-run']).code, 4);
  assert.deepEqual(snapshot(r), before);
}));

test('symlinks: the key map file, /etc/revview, and the base directory are refused', withRoot((r) => {
  const old = oldShipped((b) => { b.timing.holdMs = 300; });
  setup(r, old, old);
  const real = path.join(r, 'elsewhere.json');
  fs.renameSync(path.join(r, BTN), real);
  fs.symlinkSync(real, path.join(r, BTN));
  let res = cli(r);
  assert.equal(res.code, 4);
  assert.equal(get(r, 'elsewhere.json'), ser(old));
  assert.equal(fs.lstatSync(path.join(r, BTN)).isSymbolicLink(), true);
  // base directory a symlink: the owner's file is kept, nothing written through it
  fs.rmSync(path.join(r, BTN));
  fs.renameSync(real, path.join(r, BTN));
  fs.mkdirSync(path.join(r, 'tgt'));
  fs.rmSync(path.join(r, 'var/lib/revview'), { recursive: true });
  fs.symlinkSync(path.join(r, 'tgt'), path.join(r, 'var/lib/revview'));
  res = cli(r);
  assert.equal(res.code, 4);
  assert.equal(get(r, BTN), ser(old));
  assert.deepEqual(fs.readdirSync(path.join(r, 'tgt')), []);
}));

// ---- review round: prototype-ish keys, adopt over a valid base, backups on a clock that is wrong ----
test('mergeJson: __proto__ and constructor are ordinary keys, on the owner side and the upstream side', () => {
  const base = JSON.parse('{"a":1}');
  const mine = JSON.parse('{"a":1,"__proto__":{"mine":1}}');
  const theirs = JSON.parse('{"a":2,"constructor":5,"toString":"x"}');
  const { value, conflicts } = mergeJson(base, theirs, mine);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(Object.keys(value).sort(), ['__proto__', 'a', 'constructor', 'toString']);
  assert.deepEqual(Object.getOwnPropertyDescriptor(value, '__proto__').value, { mine: 1 });
  assert.equal(Object.getOwnPropertyDescriptor(value, 'constructor').value, 5);
  assert.equal(value.a, 2);
});

test('owner file with "__proto__" and "constructor" keys: an update elsewhere keeps them in the rewritten file', withRoot((r) => {
  const old = oldShipped((b) => { b.timing.holdMs = 111; });
  const mineText = ser(old).replace(/\n}\n$/, ',\n  "__proto__": { "mine": 1 },\n  "constructor": 7\n}\n');
  assert.ok(mineText.includes('"__proto__"'));
  setup(r, old, mineText);
  const res = cli(r);
  assert.equal(res.code, 0, res.err);
  const parsed = getJ(r, BTN);
  assert.deepEqual(Object.getOwnPropertyDescriptor(parsed, '__proto__').value, { mine: 1 });
  assert.equal(Object.getOwnPropertyDescriptor(parsed, 'constructor').value, 7);
  assert.equal(parsed.timing.holdMs, SHIPPED.timing.holdMs, 'the update still arrived');
  assert.equal(backups(r).length, 1);
  assert.equal(get(r, `etc/revview/${backups(r)[0]}`), mineText);
}));

test('--adopt-buttons-base is refused when a valid base exists: nothing changes, exit 4', withRoot((r) => {
  const old = oldShipped((b) => { b.timing.holdMs = 111; });
  const mine = clone(old);
  mine.device.product = 'abcd';
  setup(r, old, mine);
  const res = cli(r, ['--adopt-buttons-base']);
  assert.equal(res.code, 4);
  assert.match(res.err + res.out, /already holds a valid record/);
  assert.equal(get(r, BASE), ser(old));
  assert.equal(get(r, BTN), ser(mine));
  assert.equal(backups(r).length, 0);
}));

test('backups: the one just written is never pruned, even when its name sorts oldest (no real-time clock)', withRoot((r) => {
  const old = oldShipped((b) => { b.timing.holdMs = 111; });
  setup(r, old, old);
  const dir = path.join(r, 'etc/revview');
  for (const [i, name] of ['99990101-000000', '99990101-000001', '99990101-000002'].entries()) {
    const f = path.join(dir, `buttons.json.revview-backup-${name}`);
    fs.writeFileSync(f, `earlier ${i}`);
    const when = new Date(Date.now() - (10 - i) * 60000);
    fs.utimesSync(f, when, when);
  }
  assert.equal(cli(r).code, 0);
  const left = backups(r);
  assert.equal(left.length, 3);
  assert.ok(left.some((n) => get(r, `etc/revview/${n}`) === ser(old)), 'the backup of the file just replaced survives');
  assert.ok(!left.some((n) => get(r, `etc/revview/${n}`) === 'earlier 0'), 'the oldest by file time went');
}));

test('backups: a symlink or directory named like a backup is skipped (never followed or deleted), the run goes on', withRoot((r) => {
  const old = oldShipped((b) => { b.timing.holdMs = 111; });
  setup(r, old, old);
  const dir = path.join(r, 'etc/revview');
  const outside = path.join(r, 'outside.txt');
  fs.writeFileSync(outside, 'keep me');
  fs.symlinkSync(path.join(r, 'nowhere'), path.join(dir, 'buttons.json.revview-backup-00000000-000000'));
  fs.symlinkSync(outside, path.join(dir, 'buttons.json.revview-backup-00000000-000001'));
  fs.mkdirSync(path.join(dir, 'buttons.json.revview-backup-00000000-000002'));
  for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(dir, `buttons.json.revview-backup-00000001-00000${i}`), `earlier ${i}`);
  const res = cli(r);
  assert.equal(res.code, 0, res.err + res.out);
  assert.equal(fs.lstatSync(path.join(dir, 'buttons.json.revview-backup-00000000-000000')).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(path.join(dir, 'buttons.json.revview-backup-00000000-000001')), outside);
  assert.equal(get(r, 'outside.txt'), 'keep me');
  assert.equal(fs.lstatSync(path.join(dir, 'buttons.json.revview-backup-00000000-000002')).isDirectory(), true);
  assert.match(res.out + res.err, /not a regular file/);
  // the regular backups are still pruned to 3 (the new one and the 2 newest earlier ones)
  const regular = backups(r).filter((n) => fs.lstatSync(path.join(dir, n)).isFile());
  assert.equal(regular.length, 3, regular.join(' '));
}));
