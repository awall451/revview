import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = path.join(ROOT, 'pi/readonly.sh');

const OVERLAY = 'overlayroot / overlay rw,relatime,lowerdir=/media/root-ro,upperdir=/media/root-rw/overlay 0 0\n';
const EXT4 = '/dev/mmcblk0p2 / ext4 rw,noatime 0 0\n';
const BOOT_RO = '/dev/mmcblk0p1 /boot/firmware vfat ro,relatime 0 0\n';
const BOOT_RW = '/dev/mmcblk0p1 /boot/firmware vfat rw,relatime 0 0\n';
const FSTAB_RO = 'proc /proc proc defaults 0 0\n/dev/mmcblk0p1 /boot/firmware vfat defaults,ro 0 2\n';
const FSTAB_RW = 'proc /proc proc defaults 0 0\n/dev/mmcblk0p1 /boot/firmware vfat defaults 0 2\n';

// opts: mounts (text), cmdline (text), fstab (text or null), stubAddsOverlay (bool)
function setup(opts = {}) {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'revview-ro-'));
  fs.mkdirSync(path.join(r, 'proc'));
  fs.mkdirSync(path.join(r, 'boot/firmware'), { recursive: true });
  fs.mkdirSync(path.join(r, 'etc'));
  fs.writeFileSync(path.join(r, 'proc/mounts'), opts.mounts ?? (EXT4 + BOOT_RW));
  fs.writeFileSync(path.join(r, 'boot/firmware/cmdline.txt'), opts.cmdline ?? 'console=tty1 root=PARTUUID=1a2b3c4d-02 rootwait\n');
  if (opts.fstab !== null) fs.writeFileSync(path.join(r, 'etc/fstab'), opts.fstab ?? FSTAB_RW);
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revview-ro-stub-'));
  const log = path.join(stubDir, 'calls.log');
  const stub = path.join(stubDir, 'raspi-config');
  const addOverlay = `if [ "$2" = do_overlayfs ] && [ "$3" = 0 ]; then printf '%s overlayroot=tmpfs\\n' "$(tr -d '\\n' < '${r}/boot/firmware/cmdline.txt')" > '${r}/boot/firmware/cmdline.txt'; fi\n`;
  fs.writeFileSync(stub, `#!/bin/bash\necho "$*" >> '${log}'\n${opts.stubAddsOverlay ? addOverlay : ''}`,
  { mode: 0o755 });
  return { r, stubDir, log, stub };
}
const calls = (e) => (fs.existsSync(e.log) ? fs.readFileSync(e.log, 'utf8').trim().split('\n') : []);
function run(e, args) {
  const p = spawnSync('bash', [SCRIPT, ...args, '--root', e.r], {
    encoding: 'utf8', env: { ...process.env, REVVIEW_RASPI_CONFIG: e.stub },
  });
  return { code: p.status, out: p.stdout, err: p.stderr };
}
const withEnv = (opts, fn) => async () => {
  const e = setup(opts);
  try { await fn(e); } finally {
    fs.rmSync(e.r, { recursive: true, force: true });
    fs.rmSync(e.stubDir, { recursive: true, force: true });
  }
};

test('status: normal system', withEnv({}, (e) => {
  const res = run(e, ['status']);
  assert.equal(res.code, 0);
  assert.match(res.out, /^overlay: off$/m);
  assert.match(res.out, /^boot partition: rw$/m);
  assert.match(res.out, /^overlay at next boot: off$/m);
  assert.match(res.out, /^boot read-only at next boot: off$/m);
}));

test('status: overlay on, boot ro, both on at next boot', withEnv({
  mounts: OVERLAY + BOOT_RO, cmdline: 'console=tty1 root=/dev/x overlayroot=tmpfs\n', fstab: FSTAB_RO,
}, (e) => {
  const res = run(e, ['status']);
  assert.equal(res.code, 0);
  assert.match(res.out, /^overlay: on$/m);
  assert.match(res.out, /^boot partition: ro$/m);
  assert.match(res.out, /^overlay at next boot: on$/m);
  assert.match(res.out, /^boot read-only at next boot: on$/m);
}));

test('status: nothing readable gives unknown, mixed states are told apart', withEnv({ fstab: null }, (e) => {
  fs.rmSync(path.join(e.r, 'boot/firmware/cmdline.txt'));
  fs.rmSync(path.join(e.r, 'proc/mounts'));
  const res = run(e, ['status']);
  assert.equal(res.code, 0);
  assert.match(res.out, /^overlay: off$/m);
  assert.match(res.out, /^boot partition: rw$/m);
  assert.match(res.out, /^overlay at next boot: unknown$/m);
  assert.match(res.out, /^boot read-only at next boot: unknown$/m);
}));

test('status: overlay off now but on at next boot, boot ro now but not at next boot', withEnv({
  mounts: EXT4 + BOOT_RO, cmdline: 'overlayroot=tmpfs root=/dev/x\n', fstab: FSTAB_RW,
}, (e) => {
  const res = run(e, ['status']);
  assert.match(res.out, /^overlay: off$/m);
  assert.match(res.out, /^boot partition: ro$/m);
  assert.match(res.out, /^overlay at next boot: on$/m);
  assert.match(res.out, /^boot read-only at next boot: off$/m);
}));

test('enable: refused (exit 2) when the overlay is already on, nothing called', withEnv({ mounts: OVERLAY + BOOT_RO }, (e) => {
  const res = run(e, ['enable']);
  assert.equal(res.code, 2);
  assert.match(res.err, /already on/);
  assert.deepEqual(calls(e), []);
}));

test('enable --dry-run prints the commands and calls nothing', withEnv({}, (e) => {
  const res = run(e, ['enable', '--dry-run']);
  assert.equal(res.code, 0, res.out + res.err);
  assert.match(res.out, /would run: raspi-config nonint do_overlayfs 0/);
  assert.match(res.out, /would run: raspi-config nonint enable_bootro/);
  assert.deepEqual(calls(e), []);
}));

test('enable calls do_overlayfs 0 then enable_bootro, checks cmdline.txt, says reboot', withEnv({ stubAddsOverlay: true }, (e) => {
  const res = run(e, ['enable']);
  assert.equal(res.code, 0, res.out + res.err);
  assert.deepEqual(calls(e), ['nonint do_overlayfs 0', 'nonint enable_bootro']);
  assert.match(res.out, /reboot to make the root read-only/);
}));

test('enable: raspi-config that leaves no overlayroot= in cmdline.txt gives a warning and exit 1', withEnv({}, (e) => {
  const res = run(e, ['enable']);
  assert.equal(res.code, 1);
  assert.deepEqual(calls(e), ['nonint do_overlayfs 0', 'nonint enable_bootro']);
  assert.match(res.err, /did not do what we expected/);
  assert.match(res.out, /reboot to make the root read-only/);
}));

test('disable, round 1: overlay on and boot ro: remount rw (would, fake root), do_overlayfs 1, reboot hint', withEnv({
  mounts: OVERLAY + BOOT_RO, fstab: FSTAB_RO,
}, (e) => {
  const res = run(e, ['disable']);
  assert.equal(res.code, 0, res.out + res.err);
  assert.deepEqual(calls(e), ['nonint do_overlayfs 1']);
  assert.match(res.out, /would run: mount -o remount,rw \/boot\/firmware/);
  assert.ok(res.out.indexOf('remount') < res.out.indexOf('do_overlayfs 1'));
  assert.match(res.out, /reboot, then run `sudo bash pi\/readonly\.sh disable` once more/);
}));

test('disable, round 1 with the boot partition rw: no remount', withEnv({ mounts: OVERLAY + BOOT_RW }, (e) => {
  const res = run(e, ['disable']);
  assert.equal(res.code, 0);
  assert.doesNotMatch(res.out, /remount/);
  assert.deepEqual(calls(e), ['nonint do_overlayfs 1']);
}));

test('disable, round 2: overlay off, boot ro: disable_bootro and update hint', withEnv({
  mounts: EXT4 + BOOT_RO, fstab: FSTAB_RO,
}, (e) => {
  const res = run(e, ['disable']);
  assert.equal(res.code, 0, res.out + res.err);
  assert.deepEqual(calls(e), ['nonint disable_bootro']);
  assert.match(res.out, /now update/);
}));

test('disable, round 2 when only fstab says ro: disable_bootro, no remount', withEnv({ fstab: FSTAB_RO }, (e) => {
  const res = run(e, ['disable']);
  assert.equal(res.code, 0);
  assert.deepEqual(calls(e), ['nonint disable_bootro']);
  assert.doesNotMatch(res.out, /remount/);
}));

test('disable --dry-run calls nothing', withEnv({ mounts: OVERLAY + BOOT_RO }, (e) => {
  const res = run(e, ['disable', '--dry-run']);
  assert.equal(res.code, 0);
  assert.match(res.out, /would run: raspi-config nonint do_overlayfs 1/);
  assert.deepEqual(calls(e), []);
}));

test('disable: both off says already off and calls nothing', withEnv({}, (e) => {
  const res = run(e, ['disable']);
  assert.equal(res.code, 0);
  assert.match(res.out, /already off/);
  assert.deepEqual(calls(e), []);
}));

test('bad subcommand, missing subcommand, unknown option exit 2', withEnv({}, (e) => {
  for (const args of [['frobnicate'], [], ['status', '--bogus'], ['status', 'enable']]) {
    assert.equal(run(e, args).code, 2, args.join(' '));
  }
  assert.deepEqual(calls(e), []);
}));

test('--root that resolves to / is refused', withEnv({}, (e) => {
  const link = `${e.r}-slash`;
  fs.symlinkSync('/', link);
  try {
    const p = spawnSync('bash', [SCRIPT, 'status', '--root', link], { encoding: 'utf8' });
    assert.equal(p.status, 2);
    assert.match(p.stderr, /resolves to \//);
  } finally { fs.rmSync(link); }
}));

const hasShellcheck = spawnSync('shellcheck', ['--version']).status === 0;
test('shellcheck is clean on readonly.sh and lib.sh', { skip: hasShellcheck ? false : 'shellcheck not on PATH' }, () => {
  const p = spawnSync('shellcheck', [SCRIPT, path.join(ROOT, 'pi/lib.sh')], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stdout + p.stderr);
});
