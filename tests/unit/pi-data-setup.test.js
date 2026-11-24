import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = path.join(ROOT, 'pi/data-setup.sh');
const FIX = path.join(ROOT, 'tests/unit/fixtures/pi/data');
const LUKS_UUID = '0b1f6a52-7f0e-4c33-9a43-5a2f2b0d9c10';
const DESTRUCTIVE = /cryptsetup (luksFormat|luksAddKey|open)|^mkfs|^mount|^umount/m;

// Stubs for every command that touches a device. They only log their arguments (one line each) to $STUB_LOG.
// mount of the key device maps the target to the temp "stick" directory; runuser runs the command as ourselves.
const STUBS = {
  lsblk: 'cat "$STUB_LSBLK"',
  cryptsetup: `echo "cryptsetup $*" >> "$STUB_LOG"
case "$1" in
  isLuks) exit "\${STUB_ISLUKS:-0}" ;;
  luksUUID) echo "${LUKS_UUID}" ;;
  luksFormat | luksAddKey | open)
    kf=""
    while [ $# -gt 0 ]; do if [ "$1" = --key-file ]; then kf="$2"; fi; shift; done
    [ -s "$kf" ] || { echo "stub: key file missing or empty: $kf" >&2; exit 9; }
    echo "keyfile $kf" >> "$STUB_LOG" ;;
esac`,
  'mkfs.ext4': 'echo "mkfs.ext4 $*" >> "$STUB_LOG"',
  mount: `echo "mount $*" >> "$STUB_LOG"
for a in "$@"; do t="$a"; done
case "$*" in
  *"/dev/sda1"*) rmdir "$t" && ln -s "$STUB_STICK" "$t" ;;
esac`,
  umount: `echo "umount $*" >> "$STUB_LOG"
if [ -L "$1" ]; then rm "$1"; mkdir "$1"; fi`,
  runuser: 'echo "runuser $*" >> "$STUB_LOG"; shift 3; exec "$@"',
  udevadm: 'echo "udevadm $*" >> "$STUB_LOG"',
  systemctl: 'echo "systemctl $*" >> "$STUB_LOG"',
};

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'revview-dsetup-'));
  const r = path.join(base, 'root');
  const bin = path.join(base, 'bin');
  const stick = path.join(base, 'stick');
  for (const d of [r, bin, stick, path.join(r, 'etc'), path.join(r, 'home/alice')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(r, 'etc/passwd'),
    `root:x:0:0:root:/root:/bin/bash\nalice:x:${process.getuid()}:${process.getgid()}:Alice:/home/alice:/bin/bash\n`);
  for (const [name, body] of Object.entries(STUBS)) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  }
  const log = path.join(base, 'log');
  fs.writeFileSync(log, '');
  return { base, r, bin, stick, log };
}
function snapshot(r) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) out[p] = `-> ${fs.readlinkSync(p)}`;
      else if (e.isDirectory()) { out[p] = 'dir'; walk(p); } else out[p] = fs.readFileSync(p).toString('latin1');
    }
  };
  walk(r);
  return out;
}
const withEnv = (fn) => async () => {
  const e = setup();
  try { await fn(e); } finally { fs.rmSync(e.base, { recursive: true, force: true }); }
};
// detached: no controlling terminal, so /dev/tty cannot be opened (the "no tty" case).
const run = (e, args, env = {}) => {
  const p = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    detached: true,
    env: { ...process.env, PATH: `${e.bin}:${process.env.PATH}`, STUB_LOG: e.log, STUB_STICK: e.stick, STUB_LSBLK: path.join(FIX, 'lsblk.json'), ...env },
  });
  return { code: p.status, out: p.stdout, err: p.stderr, log: fs.readFileSync(e.log, 'utf8') };
};
const base = (e, extra = []) => ['--root', e.r, '--user', 'alice', '--device', '/dev/mmcblk0p3', '--key-device', '/dev/sda1', ...extra, ROOT];
const fmt = (e, extra = []) => base(e, ['--format', '--confirm', '/dev/mmcblk0p3', ...extra]);

function refused(name, args, re, { env, prep } = {}) {
  test(`refused (exit 2, nothing changed): ${name}`, withEnv((e) => {
    if (prep) prep(e);
    const before = snapshot(e.r);
    const res = run(e, args(e), env);
    assert.equal(res.code, 2, res.out + res.err);
    assert.match(res.err, re);
    assert.deepEqual(snapshot(e.r), before);
    assert.doesNotMatch(res.log, DESTRUCTIVE);
  }));
}
refused('unknown device', (e) => ['--root', e.r, '--user', 'alice', '--device', '/dev/sdz9', '--key-device', '/dev/sda1', '--format', '--confirm', '/dev/sdz9', ROOT], /not in the list/);
refused('a mounted device', (e) => ['--root', e.r, '--user', 'alice', '--device', '/dev/mmcblk0p2', '--key-device', '/dev/sda1', '--format', '--confirm', '/dev/mmcblk0p2', ROOT], /mounted/);
refused('a whole disk', (e) => ['--root', e.r, '--user', 'alice', '--device', '/dev/mmcblk0', '--key-device', '/dev/sda1', '--format', '--confirm', '/dev/mmcblk0', ROOT], /not a partition/);
refused('key device == device', (e) => ['--root', e.r, '--user', 'alice', '--device', '/dev/sda1', '--key-device', '/dev/sda1', ROOT], /same/);
refused('a device path with ..', (e) => ['--root', e.r, '--user', 'alice', '--device', '/dev/../etc/x', '--key-device', '/dev/sda1', ROOT], /bad --device/);
refused('a device path with a shell expansion', (e) => ['--root', e.r, '--user', 'alice', '--device', '/dev/$(id)', '--key-device', '/dev/sda1', ROOT], /bad --device/);
refused('--format without --confirm and no tty', (e) => base(e, ['--format']), /no terminal/);
refused('--confirm that does not match', (e) => base(e, ['--format', '--confirm', '/dev/mmcblk0p2']), /not the device/);
refused('--confirm without --format', (e) => base(e, ['--confirm', '/dev/mmcblk0p3']), /only goes with --format/);
refused('the overlay is on (proc/mounts)', (e) => fmt(e), /overlay/, {
  prep: (e) => { fs.mkdirSync(path.join(e.r, 'proc')); fs.writeFileSync(path.join(e.r, 'proc/mounts'), 'overlay / overlay rw 0 0\n'); },
});
refused('the data is already mounted at /srv/revview-data', (e) => fmt(e), /already a mount point/, {
  prep: (e) => { fs.mkdirSync(path.join(e.r, 'proc')); fs.writeFileSync(path.join(e.r, 'proc/mounts'), '/dev/mapper/x /srv/revview-data ext4 rw 0 0\n'); },
});
refused('user root', (e) => ['--root', e.r, '--user', 'root', '--device', '/dev/mmcblk0p3', '--key-device', '/dev/sda1', ROOT], /must not be root/);
refused('a missing user', (e) => ['--root', e.r, '--user', 'bob', '--device', '/dev/mmcblk0p3', '--key-device', '/dev/sda1', ROOT], /does not exist/);
refused('a device that is not LUKS without --format', (e) => base(e), /use --format/, { env: { STUB_ISLUKS: '1' } });
refused('no --device', (e) => ['--root', e.r, '--user', 'alice', '--key-device', '/dev/sda1', ROOT], /--device/);

test('--dry-run --format: prints the commands, calls no destructive stub, changes nothing', withEnv((e) => {
  fs.mkdirSync(path.join(e.r, 'home/alice/.ssh'));
  fs.writeFileSync(path.join(e.r, 'home/alice/.ssh/id'), 'secret');
  const before = snapshot(e.r);
  const res = run(e, [...fmt(e), '--dry-run']);
  assert.equal(res.code, 0, res.out + res.err);
  assert.deepEqual(snapshot(e.r), before);
  assert.doesNotMatch(res.log, DESTRUCTIVE);
  assert.deepEqual(fs.readdirSync(e.stick), []);
  assert.match(res.out, /would run: cryptsetup luksFormat --batch-mode --type luks2 --cipher xchacha12,aes-adiantum-plain64 --key-size 256 --pbkdf pbkdf2 --iter-time 500 --key-file \S+ \/dev\/mmcblk0p3/);
  assert.match(res.out, /would run: cryptsetup luksAddKey/);
  assert.match(res.out, /would run: mkfs\.ext4 -q -L revview-data/);
  assert.match(res.out, /would write .*data\.conf/);
  assert.match(res.out, /data device: \/dev\/mmcblk0p3, 15271960576 bytes/);
  assert.match(res.out, /dry run: nothing was changed/);
}));

test('--dry-run without --format on a LUKS device: no destructive stub, nothing written', withEnv((e) => {
  const before = snapshot(e.r);
  const res = run(e, [...base(e), '--dry-run']);
  assert.equal(res.code, 0, res.out + res.err);
  assert.deepEqual(snapshot(e.r), before);
  assert.doesNotMatch(res.log, DESTRUCTIVE);
  assert.match(res.out, /would write .*data\.conf/);
}));

test('without --format on a LUKS device: only the configuration is written', withEnv((e) => {
  fs.mkdirSync(path.join(e.r, 'home/alice/.ssh'));
  fs.writeFileSync(path.join(e.r, 'home/alice/.ssh/id'), 'secret');
  const res = run(e, base(e));
  assert.equal(res.code, 0, res.out + res.err);
  assert.doesNotMatch(res.log, DESTRUCTIVE);
  assert.match(res.log, /cryptsetup isLuks \/dev\/mmcblk0p3/);
  const conf = fs.readFileSync(path.join(e.r, 'etc/revview/data.conf'), 'utf8');
  assert.match(conf, new RegExp(`^DATA_UUID=${LUKS_UUID}$`, 'm'));
  assert.match(conf, /^KEY_UUID=1234-ABCD$/m);
  assert.equal(fs.readFileSync(path.join(e.r, 'home/alice/.ssh/id'), 'utf8'), 'secret');
  assert.ok(!fs.existsSync(path.join(e.r, 'srv/revview-data/ssh')));
  assert.match(res.out, /INSERT KEY|reboot/);
  assert.doesNotMatch(res.log, /systemctl|udevadm/); // a fake root: nothing is reloaded
}));

const lines = (log) => log.split('\n').filter(Boolean).filter((l) => !l.startsWith('keyfile '));

test('--format: the steps in order, the key only on the stick, files and links made', withEnv((e) => {
  const home = path.join(e.r, 'home/alice');
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude/.credentials.json'), 'CRED');
  fs.mkdirSync(path.join(home, '.claude/projects'));
  fs.writeFileSync(path.join(home, '.claude/projects/a.jsonl'), 'line');
  fs.writeFileSync(path.join(home, '.claude.json'), '{"x":1}');
  fs.mkdirSync(path.join(home, '.ssh'));
  fs.writeFileSync(path.join(home, '.ssh/id_ed25519'), 'PRIVATE');
  fs.mkdirSync(path.join(home, 'repos/proj'), { recursive: true });
  fs.writeFileSync(path.join(home, 'repos/proj/f'), 'code');
  const res = run(e, fmt(e));
  assert.equal(res.code, 0, res.out + res.err);

  const l = lines(res.log);
  const idx = (re) => l.findIndex((x) => re.test(x));
  const order = [/^mount -o rw,nosuid,nodev,noexec \/dev\/sda1 /, /^cryptsetup luksFormat --batch-mode --type luks2 --cipher xchacha12,aes-adiantum-plain64 --key-size 256 --pbkdf pbkdf2 --iter-time 500 --key-file \S+\/revview\/data\.key \/dev\/mmcblk0p3$/,
    /^cryptsetup luksAddKey --key-file \S+ \/dev\/mmcblk0p3$/, /^cryptsetup open --type luks2 --key-file \S+ \/dev\/mmcblk0p3 revview-data$/,
    /^umount /, /^mkfs\.ext4 -q -L revview-data \/dev\/mapper\/revview-data$/, /^mount -o noatime,nosuid,nodev \/dev\/mapper\/revview-data /,
    /^runuser -u alice -- cp -a /, /^cryptsetup luksUUID \/dev\/mmcblk0p3$/];
  let last = -1;
  for (const re of order) {
    const i = idx(re);
    assert.ok(i > last, `${re} after ${last}: ${l.join(' | ')}`);
    last = i;
  }
  assert.equal(l.filter((x) => /^mount /.test(x)).length, 2);
  assert.ok(!l.some((x) => /^cryptsetup isLuks/.test(x)));

  // the key: on the stick only, 4096 bytes, never in output, log or the fake root
  const key = fs.readFileSync(path.join(e.stick, 'revview/data.key'));
  assert.equal(key.length, 4096);
  const needle = key.subarray(0, 48);
  assert.ok(!Buffer.from(res.out + res.err + res.log, 'latin1').includes(needle));
  for (const content of Object.values(snapshot(e.r))) assert.ok(!Buffer.from(content, 'latin1').includes(needle));
  assert.deepEqual(fs.readdirSync(path.join(e.r, 'run')), []); // the temp mount dir is gone
  assert.equal(fs.statSync(path.join(e.r, 'run')).isDirectory(), true);

  // data moved, links made
  const data = path.join(e.r, 'srv/revview-data');
  for (const d of ['claude', 'ssh', 'repos']) {
    assert.equal(fs.statSync(path.join(data, d)).mode & 0o777, 0o700, d);
    assert.equal(fs.readlinkSync(path.join(home, d === 'repos' ? 'repos' : `.${d}`)), `/srv/revview-data/${d}`);
  }
  assert.equal(fs.readFileSync(path.join(data, 'claude/.credentials.json'), 'utf8'), 'CRED');
  assert.equal(fs.readFileSync(path.join(data, 'claude/projects/a.jsonl'), 'utf8'), 'line');
  assert.equal(fs.readFileSync(path.join(data, 'claude/.claude.json'), 'utf8'), '{"x":1}');
  assert.equal(fs.readFileSync(path.join(data, 'ssh/id_ed25519'), 'utf8'), 'PRIVATE');
  assert.equal(fs.readFileSync(path.join(data, 'repos/proj/f'), 'utf8'), 'code');
  assert.ok(!fs.existsSync(path.join(home, '.claude.json')));
  assert.match(res.out, /WARNING:.*flash/s);
  assert.match(res.out, /REVOKE\.md/);

  // configuration
  assert.match(fs.readFileSync(path.join(e.r, 'etc/revview/data.conf'), 'utf8'), new RegExp(`DATA_UUID=${LUKS_UUID}`));
  assert.ok(fs.existsSync(path.join(e.r, 'etc/systemd/system/revview-unlock.service')));
  assert.equal(fs.readlinkSync(path.join(e.r, 'etc/systemd/system/multi-user.target.wants/revview-unlock.service')), '/etc/systemd/system/revview-unlock.service');
}));

test('--format --no-recovery-passphrase: no luksAddKey; an existing key on the stick is reused', withEnv((e) => {
  fs.mkdirSync(path.join(e.stick, 'revview'));
  const old = Buffer.alloc(4096, 7);
  fs.writeFileSync(path.join(e.stick, 'revview/data.key'), old);
  const res = run(e, fmt(e, ['--no-recovery-passphrase']));
  assert.equal(res.code, 0, res.out + res.err);
  assert.doesNotMatch(res.log, /luksAddKey/);
  assert.match(res.log, /luksFormat/);
  assert.deepEqual(fs.readFileSync(path.join(e.stick, 'revview/data.key')), old);
  assert.match(res.out, /reusing the key file/);
}));

test('--format: a key file of the wrong size on the stick stops before luksFormat', withEnv((e) => {
  fs.mkdirSync(path.join(e.stick, 'revview'));
  fs.writeFileSync(path.join(e.stick, 'revview/data.key'), 'short');
  const res = run(e, fmt(e));
  assert.notEqual(res.code, 0);
  assert.doesNotMatch(res.log, /luksFormat|mkfs/);
  assert.match(res.log, /^umount /m);
  assert.deepEqual(fs.readdirSync(path.join(e.r, 'run')), []);
}));

test('--format: a foreign symlink at ~/.ssh is refused, the rest is done, exit 1', withEnv((e) => {
  const home = path.join(e.r, 'home/alice');
  fs.mkdirSync(path.join(e.base, 'elsewhere'));
  fs.writeFileSync(path.join(e.base, 'elsewhere/id'), 'x');
  fs.symlinkSync(path.join(e.base, 'elsewhere'), path.join(home, '.ssh'));
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude/a'), 'a');
  const res = run(e, fmt(e));
  assert.equal(res.code, 1, res.out + res.err);
  assert.match(res.err, /\.ssh is a symlink to somewhere else/);
  assert.equal(fs.readlinkSync(path.join(home, '.ssh')), path.join(e.base, 'elsewhere'));
  assert.equal(fs.readFileSync(path.join(e.base, 'elsewhere/id'), 'utf8'), 'x');
  assert.equal(fs.readlinkSync(path.join(home, '.claude')), '/srv/revview-data/claude');
  assert.equal(fs.readFileSync(path.join(e.r, 'srv/revview-data/claude/a'), 'utf8'), 'a');
  assert.ok(fs.existsSync(path.join(e.r, 'etc/revview/data.conf')));
}));

test('--format: a home entry that is already our symlink is left alone (second run)', withEnv((e) => {
  assert.equal(run(e, fmt(e)).code, 0);
  fs.writeFileSync(path.join(e.r, 'srv/revview-data/claude/keep'), 'k');
  const res = run(e, fmt(e));
  assert.equal(res.code, 0, res.out + res.err);
  assert.equal(fs.readFileSync(path.join(e.r, 'srv/revview-data/claude/keep'), 'utf8'), 'k');
  assert.match(res.out, /already linked/);
}));

test('a failing cryptsetup after work started: exit 1, the stick is unmounted again', withEnv((e) => {
  fs.writeFileSync(path.join(e.bin, 'cryptsetup'), '#!/bin/bash\necho "cryptsetup $*" >> "$STUB_LOG"\nexit 3\n', { mode: 0o755 });
  const res = run(e, fmt(e, ['--no-recovery-passphrase']));
  assert.equal(res.code, 1, res.out + res.err);
  assert.doesNotMatch(res.log, /mkfs/);
  assert.match(res.log, /^umount /m);
  assert.deepEqual(fs.readdirSync(path.join(e.r, 'run')), []);
}));

const hasShellcheck = spawnSync('shellcheck', ['--version']).status === 0;
test('shellcheck is clean on data-setup.sh', { skip: hasShellcheck ? false : 'shellcheck not on PATH' }, () => {
  const p = spawnSync('shellcheck', [SCRIPT, path.join(ROOT, 'pi/lib.sh')], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stdout + p.stderr);
});

// A `node` first on PATH: the real (not --dry-run) data.mjs write is replaced by an exit with `code`; all else is real.
function nodeStub(e, code) {
  fs.writeFileSync(path.join(e.bin, 'node'), `#!/bin/bash
case " $* " in
  *data.mjs\\ write*) case " $* " in *" --dry-run "*) ;; *) echo "stub node: exit ${code}" >&2; exit ${code} ;; esac ;;
esac
exec ${JSON.stringify(process.execPath)} "$@"
`, { mode: 0o755 });
}

test('data.mjs write exiting 3 (crash) after work started: exit 1, the message says failed', withEnv((e) => {
  nodeStub(e, 3);
  const res = run(e, fmt(e));
  assert.equal(res.code, 1, res.out + res.err);
  assert.match(res.err, /data\.mjs failed \(exit 3/);
  assert.doesNotMatch(res.err, /refused to write/);
}));

test('data.mjs write refusing (its exit 4): exit 1 with a message that says refused', withEnv((e) => {
  nodeStub(e, 4);
  const res = run(e, fmt(e));
  assert.equal(res.code, 1, res.out + res.err);
  assert.match(res.err, /data\.mjs refused to write/);
}));
