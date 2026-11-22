import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  checkDevices, renderDataConf, renderDataEnv, renderProfile, renderUnlockUnit, renderKeyRule, checkRootOwned,
} from '../../pi/data.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = path.join(ROOT, 'tests/unit/fixtures/pi/data');
const DATA = path.join(ROOT, 'pi/data.mjs');
const lsblk = () => JSON.parse(fs.readFileSync(path.join(FIX, 'lsblk.json'), 'utf8'));
const mounts = fs.readFileSync(path.join(FIX, 'mounts'), 'utf8');
const check = (over = {}, ls = lsblk()) => checkDevices({ lsblk: ls, mounts, device: '/dev/mmcblk0p3', keyDevice: '/dev/sda1', ...over });
const find = (ls, p) => {
  const walk = (n) => (n.path === p ? n : (n.children ?? []).map(walk).find(Boolean));
  return ls.blockdevices.map(walk).find(Boolean);
};
const UUID = '0b1f6a52-7f0e-4c33-9a43-5a2f2b0d9c10';

test('checkDevices: the good case describes both devices', () => {
  const r = check();
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.data, { path: '/dev/mmcblk0p3', size: 15271960576, fstype: null, label: null });
  assert.deepEqual(r.key, { path: '/dev/sda1', uuid: '1234-ABCD', fstype: 'vfat' });
});

const bad = (name, over, re, mutate, mountsText) => test(`checkDevices: ${name}`, () => {
  const ls = lsblk();
  if (mutate) mutate(ls);
  const r = checkDevices({ lsblk: ls, mounts: mountsText ?? mounts, device: '/dev/mmcblk0p3', keyDevice: '/dev/sda1', ...over });
  assert.ok(r.errors.some((e) => re.test(e)), `${re}: ${JSON.stringify(r.errors)}`);
});
bad('a whole disk is refused', { device: '/dev/mmcblk0' }, /not a partition/);
bad('the root partition is refused', { device: '/dev/mmcblk0p2' }, /mounted/);
bad('the boot partition is refused', { device: '/dev/mmcblk0p1' }, /mounted/);
bad('mounted according to /proc/mounts only', {}, /mounted/, null, `${mounts}/dev/mmcblk0p3 /mnt ext4 rw 0 0\n`);
bad('mounted according to lsblk only', {}, /mounted/, (ls) => { find(ls, '/dev/mmcblk0p3').mountpoints = ['/mnt/x']; });
bad('a partition with children (open mapping) is refused', {}, /in use/, (ls) => {
  find(ls, '/dev/mmcblk0p3').children = [{ name: 'revview-data', path: '/dev/mapper/revview-data', type: 'crypt', mountpoints: [null] }];
});
bad('the same device twice', { keyDevice: '/dev/mmcblk0p3' }, /same/);
bad('data on the same disk as the key', { device: '/dev/sda1', keyDevice: '/dev/sda' }, /same disk/, (ls) => {
  Object.assign(find(ls, '/dev/sda'), { fstype: 'vfat', uuid: '1234-ABCD' });
  find(ls, '/dev/sda1').fstype = null;
});
bad('a key that is not on USB', { keyDevice: '/dev/mmcblk0p1' }, /not on USB/);
bad('a mounted key stick', {}, /key device .* is mounted/, (ls) => { find(ls, '/dev/sda1').mountpoints = ['/media/x']; });
bad('a key stick without a UUID', {}, /no file system UUID/, (ls) => { find(ls, '/dev/sda1').uuid = null; });
bad('a key stick with an odd file system', {}, /must be one of/, (ls) => { find(ls, '/dev/sda1').fstype = 'ntfs'; });
bad('a key device that is not a part or disk', {}, /is a loop/, (ls) => { find(ls, '/dev/sda1').type = 'loop'; });
for (const p of ['/dev/../etc/passwd', '/dev/sda 1', '/dev/$(id)', '/dev/sda1;x', '/dev/', '/etc/passwd', 'sda1']) {
  bad(`path ${JSON.stringify(p)}`, { device: p }, /not an acceptable device path/);
  bad(`key path ${JSON.stringify(p)}`, { keyDevice: p }, /not an acceptable device path/);
}
bad('a device that lsblk does not list', { device: '/dev/sdz9' }, /not in the list/);
bad('a key device that lsblk does not list', { keyDevice: '/dev/sdz9' }, /not in the list/);

test('renderDataConf: lines, defaults and validation', () => {
  const t = renderDataConf({ dataUuid: UUID, keyUuid: '1234-ABCD' });
  assert.match(t, /^DATA_UUID=0b1f6a52-7f0e-4c33-9a43-5a2f2b0d9c10$/m);
  assert.match(t, /^KEY_UUID=1234-ABCD$/m);
  assert.match(t, /^KEY_FILE=revview\/data\.key$/m);
  assert.match(t, /^#/);
  for (const l of t.trim().split('\n')) assert.match(l, /^(#.*|DATA_UUID=.+|KEY_UUID=.+|KEY_FILE=.+)$/);
  for (const keyUuid of ['0123456789ABCDEF', UUID]) renderDataConf({ dataUuid: UUID, keyUuid });
  for (const dataUuid of ['1234-ABCD', 'x', `${UUID}\nKEY_UUID=1`, '']) assert.throws(() => renderDataConf({ dataUuid, keyUuid: '1234-ABCD' }), /data UUID/);
  for (const keyUuid of ['12345', '1234-ABCD\nX=1', '$(id)', undefined]) assert.throws(() => renderDataConf({ dataUuid: UUID, keyUuid }), /key UUID/);
  for (const keyFile of ['/abs', '../x', 'a/../b', 'a b', 'a\nb', '']) assert.throws(() => renderDataConf({ dataUuid: UUID, keyUuid: '1234-ABCD', keyFile }), /key file/);
});

test('renderDataEnv, renderProfile: the two variables, validated', () => {
  const e = renderDataEnv({ home: '/home/alice' });
  assert.match(e, /^REVVIEW_DATA_MOUNT=\/srv\/revview-data$/m);
  assert.match(e, /^CLAUDE_CONFIG_DIR=\/home\/alice\/\.claude$/m);
  assert.match(e, /^#/);
  assert.throws(() => renderDataEnv({ home: '/home/a b' }), /home/);
  const p = renderProfile({ user: 'alice', home: '/home/alice' });
  assert.match(p, /id -un/);
  assert.match(p, /= "alice"/);
  assert.match(p, /export CLAUDE_CONFIG_DIR="\$HOME\/\.claude"/);
  assert.throws(() => renderProfile({ user: 'al ice', home: '/home/x' }), /user/);
  assert.throws(() => renderProfile({ user: 'a"; rm', home: '/home/x' }), /user/);
});

test('renderUnlockUnit, renderKeyRule: placeholders replaced, input validated', () => {
  assert.equal(renderUnlockUnit('ExecStart=@REVVIEW_DIR@/pi/unlock.sh @REVVIEW_DIR@\n', { dir: '/opt/revview' }),
    'ExecStart=/opt/revview/pi/unlock.sh /opt/revview\n');
  assert.throws(() => renderUnlockUnit('x', { dir: '/opt/rev view' }), /dir/);
  assert.throws(() => renderUnlockUnit('x', { dir: 'opt' }), /dir/);
  assert.equal(renderKeyRule('ID_FS_UUID=="@KEY_UUID@"', { keyUuid: '1234-ABCD' }), 'ID_FS_UUID=="1234-ABCD"');
  assert.throws(() => renderKeyRule('x', { keyUuid: '1234"; RUN+="x' }), /key UUID/);
});

test('checkRootOwned', () => {
  assert.equal(checkRootOwned({ uid: 0, mode: 0o100755 }), null);
  assert.equal(checkRootOwned({ uid: 0, mode: 0o100644 }), null);
  assert.match(checkRootOwned({ uid: 1000, mode: 0o100755 }), /not root/);
  assert.match(checkRootOwned({ uid: 0, mode: 0o100775 }), /writable/);
  assert.match(checkRootOwned({ uid: 0, mode: 0o100757 }), /writable/);
});

// ---- the CLI ----

const node = (args) => {
  const p = spawnSync(process.execPath, [DATA, ...args], { encoding: 'utf8' });
  return { code: p.status, out: p.stdout, err: p.stderr };
};
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
const withRoot = (fn) => async () => {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'revview-data-'));
  try { await fn(r); } finally { fs.rmSync(r, { recursive: true, force: true }); }
};
const wargs = (r, extra = []) => ['write', '--root', r, '--user', 'alice', '--home', '/home/alice', '--dir', '/opt/revview',
  '--data-uuid', UUID, '--key-uuid', '1234-ABCD', ...extra];

test('write: every file, modes, enable symlink, mount dir', withRoot((r) => {
  const res = node(wargs(r));
  assert.equal(res.code, 0, res.err);
  const p = (x) => path.join(r, x);
  for (const f of ['etc/revview/data.conf', 'etc/revview/data.env', 'etc/profile.d/revview-claude.sh',
    'etc/udev/rules.d/72-revview-key.rules', 'etc/systemd/system/revview-unlock.service']) {
    assert.ok(fs.statSync(p(f)).isFile(), f);
    assert.equal(fs.statSync(p(f)).mode & 0o777, 0o644, f);
    assert.ok(res.out.split('\n').includes(`wrote ${p(f)}`), f);
  }
  assert.equal(fs.readlinkSync(p('etc/systemd/system/multi-user.target.wants/revview-unlock.service')), '/etc/systemd/system/revview-unlock.service');
  assert.equal(fs.statSync(p('srv/revview-data')).mode & 0o777, 0o755);
  const unit = fs.readFileSync(p('etc/systemd/system/revview-unlock.service'), 'utf8');
  assert.match(unit, /^ExecStart=\/bin\/bash \/opt\/revview\/pi\/unlock\.sh$/m);
  assert.doesNotMatch(unit, /@REVVIEW_DIR@/);
  const rule = fs.readFileSync(p('etc/udev/rules.d/72-revview-key.rules'), 'utf8');
  assert.match(rule, /=="1234-ABCD"/);
  assert.doesNotMatch(rule, /@KEY_UUID@/);
  assert.match(fs.readFileSync(p('etc/revview/data.conf'), 'utf8'), /^DATA_UUID=0b1f/m);
}));

test('write: a second run says unchanged for everything and changes nothing', withRoot((r) => {
  assert.equal(node(wargs(r)).code, 0);
  const before = snapshot(r);
  const res = node(wargs(r));
  assert.equal(res.code, 0, res.err);
  assert.deepEqual(snapshot(r), before);
  assert.doesNotMatch(res.out, /^(wrote|would|backup) /m);
  assert.equal(res.out.trim().split('\n').filter((l) => l.startsWith('unchanged ')).length, 7);
}));

test('write: a symlink where a file goes is refused, the rest is written, exit 1', withRoot((r) => {
  fs.mkdirSync(path.join(r, 'etc/revview'), { recursive: true });
  fs.writeFileSync(path.join(r, 'victim'), 'keep');
  fs.symlinkSync(path.join(r, 'victim'), path.join(r, 'etc/revview/data.conf'));
  const res = node(wargs(r));
  assert.equal(res.code, 1);
  assert.match(res.out, /skipped .*data\.conf: is a symlink/);
  assert.equal(fs.readFileSync(path.join(r, 'victim'), 'utf8'), 'keep');
  assert.ok(fs.existsSync(path.join(r, 'etc/revview/data.env')));
}));

test('write: --dry-run writes nothing and says would write', withRoot((r) => {
  const res = node(wargs(r, ['--dry-run']));
  assert.equal(res.code, 0, res.err);
  assert.deepEqual(fs.readdirSync(r), []);
  assert.equal(res.out.split('\n').filter((l) => l.startsWith('would write ')).length, 7);
}));

test('write: bad arguments exit 2 and write nothing', withRoot((r) => {
  const cases = [['--user', 'Bad User'], ['--dir', '/opt/rev view'], ['--data-uuid', 'nope'], ['--key-uuid', '$(id)'], ['--owner', 'x'], ['--bogus', 'x'], ['--home', 'rel']];
  for (const [k, v] of cases) {
    const a = wargs(r);
    const i = a.indexOf(k);
    if (i >= 0) a[i + 1] = v; else a.push(k, v);
    const res = node(a);
    assert.equal(res.code, 2, `${k}: ${res.err}`);
  }
  assert.equal(node(['write', '--root', r]).code, 2);
  assert.equal(node(['nope']).code, 2);
  assert.deepEqual(fs.readdirSync(r), []);
}));

test('check CLI: good case prints JSON, bad exits 1, bad args exit 2', () => {
  const a = ['check', '--lsblk', path.join(FIX, 'lsblk.json'), '--mounts', path.join(FIX, 'mounts'), '--device', '/dev/mmcblk0p3', '--key-device', '/dev/sda1'];
  const ok = node(a);
  assert.equal(ok.code, 0, ok.err);
  assert.equal(ok.out.trim().split('\n').length, 1);
  assert.equal(JSON.parse(ok.out).key.uuid, '1234-ABCD');
  const b = [...a];
  b[b.indexOf('/dev/mmcblk0p3')] = '/dev/mmcblk0p2';
  const no = node(b);
  assert.equal(no.code, 1);
  assert.match(no.err, /mounted/);
  assert.equal(node(a.slice(0, -2)).code, 2);
  assert.equal(node([...a, '--x', 'y']).code, 2);
});
