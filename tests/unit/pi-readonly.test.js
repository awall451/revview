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

// opts: mounts (text), cmdline (text), fstab (text or null), noOverlayroot (bool: overlayroot package absent),
// stub: 'real' (default; mirrors raspi-config-core 20261026+2) | 'nobootro' (do_overlayfs does not set bootro)
//       | 'stuck' (disable_bootro never clears ro).
// The stub mirrors raspi-config-core 20261026+2 as read in the unpacked package (the seds are copied from it): do_overlayfs 0 PREPENDS "overlayroot=tmpfs " to cmdline.txt and, when the
// overlay is not active now, applies enable_bootro (do_overlayfs 1: disable_bootro); enable_bootro / disable_bootro
// are the real seds on etc/fstab and refuse (message, exit 1) when the overlay is active now. The fake root has no
// /proc/cmdline, so "active now" is whether <root>/proc/mounts shows / as overlay.
function setup(opts = {}) {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'revview-ro-'));
  fs.mkdirSync(path.join(r, 'proc'));
  fs.mkdirSync(path.join(r, 'boot/firmware'), { recursive: true });
  fs.mkdirSync(path.join(r, 'etc'));
  if (!opts.noOverlayroot) {
    fs.mkdirSync(path.join(r, 'usr/share/initramfs-tools/scripts/init-bottom'), { recursive: true });
    fs.writeFileSync(path.join(r, 'usr/share/initramfs-tools/scripts/init-bottom/overlayroot'), '#!/bin/sh\n');
  }
  fs.writeFileSync(path.join(r, 'proc/mounts'), opts.mounts ?? (EXT4 + BOOT_RW));
  fs.writeFileSync(path.join(r, 'boot/firmware/cmdline.txt'), opts.cmdline ?? 'console=tty1 root=PARTUUID=1a2b3c4d-02 rootwait\n');
  if (opts.fstab !== null) fs.writeFileSync(path.join(r, 'etc/fstab'), opts.fstab ?? FSTAB_RW);
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revview-ro-stub-'));
  const log = path.join(stubDir, 'calls.log');
  const stub = path.join(stubDir, 'raspi-config');
  const mode = opts.stub ?? 'real';
  const body = `#!/bin/bash
R='${r}'
echo "$*" >> '${log}'
active() { awk '$2 == "/" && $3 == "overlay" { f = 1 } END { exit !f }' "$R/proc/mounts"; }
enable_bootro() {
  if active; then echo "Overlay in use; cannot update fstab"; return 1; fi
  sed -i "$R/etc/fstab" -e "s#\\(.*/boot/firmware.*\\)defaults\\(.*\\)#\\1defaults,ro\\2#"
}
disable_bootro() {
  if active; then echo "Overlay in use; cannot update fstab"; return 1; fi
  ${mode === 'stuck' ? 'return 0' : 'sed -i "$R/etc/fstab" -e "s#\\(.*/boot/firmware.*\\)defaults,ro\\(.*\\)#\\1defaults\\2#"'}
}
do_overlayfs() {
  if [ "$1" = 0 ]; then
    sed -i "$R/boot/firmware/cmdline.txt" -e "s/^/overlayroot=tmpfs /"
    ${mode === 'nobootro' ? ':' : 'if ! active; then enable_bootro; fi'}
  else
    sed -i "$R/boot/firmware/cmdline.txt" -e "s/\\(.*\\)overlayroot=tmpfs \\(.*\\)/\\1\\2/"
    if ! active; then disable_bootro; fi
  fi
}
[ "$1" = nonint ] || exit 0
shift
"$@"
`;
  fs.writeFileSync(stub, body, { mode: 0o755 });
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
  assert.match(res.out, /would run: raspi-config nonint enable_bootro \(only if fstab has no ro yet\)/);
  assert.deepEqual(calls(e), []);
}));

test('enable: without the overlayroot package: exit 2, raspi-config not called, says how to install it', withEnv({ noOverlayroot: true }, (e) => {
  const res = run(e, ['enable']);
  assert.equal(res.code, 2);
  assert.match(res.err, /overlayroot is not installed/);
  assert.match(res.err, /raspi-config would apt-get it/);
  assert.match(res.err, /needs a network/);
  assert.match(res.err, /sudo apt-get install overlayroot/);
  assert.deepEqual(calls(e), []);
}));

test('enable calls exactly do_overlayfs 0 (which sets bootro itself), fstab gets exactly one ro, says reboot', withEnv({}, (e) => {
  const res = run(e, ['enable']);
  assert.equal(res.code, 0, res.out + res.err);
  assert.deepEqual(calls(e), ['nonint do_overlayfs 0']);
  assert.match(fs.readFileSync(path.join(e.r, 'etc/fstab'), 'utf8'), /vfat defaults,ro 0 2\n$/);
  assert.match(fs.readFileSync(path.join(e.r, 'boot/firmware/cmdline.txt'), 'utf8'), /^overlayroot=tmpfs console=tty1/);
  assert.match(res.out, /reboot to make the root read-only/);
}));

test('enable: when do_overlayfs does not set bootro, enable_bootro is called once', withEnv({ stub: 'nobootro' }, (e) => {
  const res = run(e, ['enable']);
  assert.equal(res.code, 0, res.out + res.err);
  assert.deepEqual(calls(e), ['nonint do_overlayfs 0', 'nonint enable_bootro']);
  assert.match(fs.readFileSync(path.join(e.r, 'etc/fstab'), 'utf8'), /vfat defaults,ro 0 2\n$/);
}));

test('enable: raspi-config that leaves no overlayroot= in cmdline.txt gives a warning and exit 1', withEnv({}, (e) => {
  // a raspi-config that does nothing at all
  fs.writeFileSync(e.stub, `#!/bin/bash\necho "$*" >> '${e.log}'\n`, { mode: 0o755 });
  const res = run(e, ['enable']);
  assert.equal(res.code, 1);
  assert.deepEqual(calls(e), ['nonint do_overlayfs 0', 'nonint enable_bootro']);
  assert.match(res.err, /did not do what we expected/);
  assert.match(res.err, /P2 Overlay File System/);
  assert.match(res.out, /reboot to make the root read-only/);
}));

test('enable: raspi-config that never sets ro in fstab gives a warning and exit 1', withEnv({}, (e) => {
  fs.writeFileSync(e.stub, `#!/bin/bash\necho "$*" >> '${e.log}'\nif [ "$2" = do_overlayfs ]; then sed -i '${e.r}/boot/firmware/cmdline.txt' -e 's/^/overlayroot=tmpfs /'; fi\n`, { mode: 0o755 });
  const res = run(e, ['enable']);
  assert.equal(res.code, 1);
  assert.match(res.err, /raspi-config did not set ro on \/boot\/firmware in fstab/);
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

test('disable, round 2 starting from defaults,ro,ro: disable_bootro until no ro is left (twice)', withEnv({
  fstab: 'proc /proc proc defaults 0 0\n/dev/mmcblk0p1 /boot/firmware vfat defaults,ro,ro 0 2\n',
}, (e) => {
  const res = run(e, ['disable']);
  assert.equal(res.code, 0, res.out + res.err);
  assert.deepEqual(calls(e), ['nonint disable_bootro', 'nonint disable_bootro']);
  assert.match(fs.readFileSync(path.join(e.r, 'etc/fstab'), 'utf8'), /vfat defaults 0 2\n$/);
}));

test('disable, round 2 where ro never clears: at most 3 calls, warning, exit 1', withEnv({ fstab: FSTAB_RO, stub: 'stuck' }, (e) => {
  const res = run(e, ['disable']);
  assert.equal(res.code, 1);
  assert.equal(calls(e).length, 3);
  assert.match(res.err, /still has ro/);
}));

test('disable, round 1: overlayroot=tmpfs as the last token is left by the real sed: warning naming the file, exit 1', withEnv({
  mounts: OVERLAY + BOOT_RW, cmdline: 'console=tty1 root=/dev/x overlayroot=tmpfs\n',
}, (e) => {
  const res = run(e, ['disable']);
  assert.equal(res.code, 1);
  assert.deepEqual(calls(e), ['nonint do_overlayfs 1']);
  assert.match(res.err, /cmdline\.txt/);
  assert.match(res.err, /overlayroot/);
  assert.doesNotMatch(res.out, /reboot, then run/);
}));

test('disable, round 1: overlayroot=tmpfs at the start is removed, exit 0', withEnv({
  mounts: OVERLAY + BOOT_RW, cmdline: 'overlayroot=tmpfs console=tty1\n',
}, (e) => {
  const res = run(e, ['disable']);
  assert.equal(res.code, 0, res.out + res.err);
  assert.equal(fs.readFileSync(path.join(e.r, 'boot/firmware/cmdline.txt'), 'utf8'), 'console=tty1\n');
}));

for (const opts of ['ro,defaults', 'defaults,noatime,ro']) {
  test(`disable, round 2 with fstab options ${opts}: raspi-config cannot remove it, say so at once, exit 1, no call`, withEnv({
    fstab: `proc /proc proc defaults 0 0\n/dev/mmcblk0p1 /boot/firmware vfat ${opts} 0 2\n`,
  }, (e) => {
    const res = run(e, ['disable']);
    assert.equal(res.code, 1);
    assert.deepEqual(calls(e), []);
    assert.match(res.err, /only removes defaults,ro/);
    assert.match(res.err, /edit \/etc\/fstab by hand/);
    const dry = run(e, ['disable', '--dry-run']);
    assert.equal(dry.code, 1, 'the dry run reads fstab too and says the same');
    assert.deepEqual(calls(e), []);
    assert.match(dry.err, /only removes defaults,ro/);
  }));
}

test('enable: fstab /boot/firmware line without defaults is refused (exit 2), also with --dry-run, nothing called', withEnv({
  fstab: 'proc /proc proc defaults 0 0\n/dev/mmcblk0p1 /boot/firmware vfat rw,noatime 0 2\n',
}, (e) => {
  for (const args of [['enable'], ['enable', '--dry-run']]) {
    const res = run(e, args);
    assert.equal(res.code, 2, args.join(' '));
    assert.match(res.err, /defaults/);
  }
  assert.deepEqual(calls(e), []);
}));

test('enable --dry-run without the overlayroot package exits 2', withEnv({ noOverlayroot: true }, (e) => {
  assert.equal(run(e, ['enable', '--dry-run']).code, 2);
}));

test('enable: no fstab keeps today\'s behaviour', withEnv({ fstab: null }, (e) => {
  const res = run(e, ['enable', '--dry-run']);
  assert.equal(res.code, 0, res.out + res.err);
}));

test('enable: no /boot/firmware line in fstab keeps today\'s behaviour', withEnv({ fstab: 'proc /proc proc defaults 0 0\n' }, (e) => {
  const res = run(e, ['enable', '--dry-run']);
  assert.equal(res.code, 0, res.out + res.err);
}));

test('status: overlayroot=disabled or an empty value in cmdline.txt is off at next boot', withEnv({
  cmdline: 'overlayroot=disabled console=tty1 root=/dev/x\n',
}, (e) => {
  const f = path.join(e.r, 'boot/firmware/cmdline.txt');
  assert.match(run(e, ['status']).out, /^overlay at next boot: off$/m);
  fs.writeFileSync(f, 'console=tty1 overlayroot= root=/dev/x\n');
  assert.match(run(e, ['status']).out, /^overlay at next boot: off$/m);
  fs.writeFileSync(f, 'console=tty1 overlayroot=disabled overlayroot=tmpfs:swap=1\n');
  assert.match(run(e, ['status']).out, /^overlay at next boot: on$/m);
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
