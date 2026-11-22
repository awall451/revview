import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const UNLOCK = path.join(ROOT, 'pi/unlock.sh');
const DATA_UUID = '0a1b2c3d-1111-2222-3333-444455556666';
const KEY_UUID = 'ABCD-1234';
const SECRET = 'TOPSECRETKEYBYTES-0123456789-abcdefghijklmnopqrstuvwxyz';
const CONF = `# written by data-setup\nDATA_UUID=${DATA_UUID}\nKEY_UUID=${KEY_UUID}\nKEY_FILE=revview/data.key\nOTHER=x\n`;

const STUBS = {
  mountpoint: 'echo "mountpoint $*" >> "$LOG"\n[ "${MOUNTED:-0}" = 1 ]\n',
  mount: 'echo "mount $*" >> "$LOG"\n'
    + 'case "$*" in *ro,nosuid,nodev,noexec*) eval "dst=\\${$#}"; [ -z "$STICK_DIR" ] || cp -a "$STICK_DIR/." "$dst/";; esac\n'
    + 'exit "${MOUNT_RC:-0}"\n',
  umount: 'echo "umount $*" >> "$LOG"\nrm -rf "${!#}"/* "${!#}"/.[!.]*\n',
  cryptsetup: 'echo "cryptsetup $*" >> "$LOG"\nexit "${CRYPT_RC:-0}"\n',
  e2fsck: 'echo "e2fsck $*" >> "$LOG"\nexit "${FSCK_RC:-0}"\n',
  curl: 'echo "curl $*" >> "$LOG"\n',
};

function setup({ conf = CONF, stick = true, data = true, stickFiles } = {}) {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'revview-unlock-'));
  const mk = (d) => fs.mkdirSync(path.join(r, d), { recursive: true });
  for (const d of ['etc/revview', 'dev/disk/by-uuid', 'srv/revview-data', 'run', 'stubs', 'stickdir']) mk(d);
  if (conf !== null) fs.writeFileSync(path.join(r, 'etc/revview/data.conf'), conf);
  if (stick) fs.writeFileSync(path.join(r, 'dev/disk/by-uuid', KEY_UUID), '');
  if (data) fs.writeFileSync(path.join(r, 'dev/disk/by-uuid', DATA_UUID), '');
  if (stickFiles) stickFiles(path.join(r, 'stickdir'));
  else {
    mk('stickdir/revview');
    fs.writeFileSync(path.join(r, 'stickdir/revview/data.key'), SECRET.repeat(4));
  }
  for (const [n, body] of Object.entries(STUBS)) {
    fs.writeFileSync(path.join(r, 'stubs', n), `#!/bin/bash\n${body}`, { mode: 0o755 });
  }
  fs.writeFileSync(path.join(r, 'log'), '');
  return r;
}
function run(r, { env = {}, args } = {}) {
  const p = spawnSync('bash', [UNLOCK, ...(args || ['--root', r])], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${path.join(r, 'stubs')}:${process.env.PATH}`, LOG: path.join(r, 'log'),
      STICK_DIR: path.join(r, 'stickdir'), ...env },
  });
  const log = fs.readFileSync(path.join(r, 'log'), 'utf8');
  return { code: p.status, out: p.stdout, err: p.stderr, log, all: p.stdout + p.stderr + log };
}
const withRoot = (opts, fn) => async () => {
  const r = setup(opts);
  try { await fn(r); } finally { fs.rmSync(r, { recursive: true, force: true }); }
};
const noCrypt = (res) => assert.doesNotMatch(res.log, /cryptsetup/);
const confWith = (over) => CONF.replace(/^KEY_FILE=.*$/m, '').replace(/^KEY_UUID=.*$/m, '') + over;

test('unlock: no data.conf', withRoot({ conf: null }, (r) => {
  const res = run(r);
  assert.equal(res.code, 1);
  assert.match(res.err, /data\.conf/);
  assert.equal(res.log, '');
}));

for (const [name, conf] of [
  ['bad DATA_UUID', CONF.replace(DATA_UUID, 'nonsense')],
  ['bad KEY_UUID', CONF.replace(KEY_UUID, 'XYZ')],
  ['KEY_FILE ../x', CONF.replace('revview/data.key', '../x')],
  ['KEY_FILE a/../b', CONF.replace('revview/data.key', 'a/../b')],
  ['KEY_FILE a/./b', CONF.replace('revview/data.key', 'a/./b')],
  ['KEY_FILE absolute', CONF.replace('revview/data.key', '/etc/shadow')],
  ['KEY_FILE dollar paren', CONF.replace('revview/data.key', '$(touch PWNFILE)')],
  ['KEY_FILE backticks', CONF.replace('revview/data.key', '`touch PWNFILE`')],
  ['KEY_FILE semicolon', CONF.replace('revview/data.key', 'a;touch PWNFILE')],
  ['duplicate DATA_UUID', `${CONF}DATA_UUID=${DATA_UUID}\n`],
  ['missing KEY_FILE', confWith(`KEY_UUID=${KEY_UUID}\n`)],
  ['line without =', `${CONF}garbage\n`],
]) {
  test(`unlock: refuses ${name}`, withRoot({ conf }, (r) => {
    const pwn = path.join(r, 'PWNFILE');
    const res = run(r);
    assert.equal(res.code, 1, res.err);
    assert.match(res.err, /data\.conf/);
    assert.equal(fs.existsSync(pwn), false);
    assert.equal(fs.existsSync(path.join(process.cwd(), 'PWNFILE')), false);
    assert.equal(res.log, '', 'no command ran');
  }));
}

test('unlock: shell metacharacters in the config are not executed', withRoot({
  conf: CONF.replace('revview/data.key', '$(touch /tmp/revview-unlock-pwn)'),
}, (r) => {
  fs.rmSync('/tmp/revview-unlock-pwn', { force: true });
  const res = run(r);
  assert.equal(res.code, 1);
  assert.equal(fs.existsSync('/tmp/revview-unlock-pwn'), false);
}));

test('unlock: accepts comments, blank lines, other KEY_UUID forms', withRoot({
  conf: `\n  # hi\n${CONF}`.replace(KEY_UUID, '0123456789abcdef'),
  stick: false,
}, (r) => {
  const res = run(r);
  assert.equal(res.code, 0, res.err);
  assert.match(res.out, /key stick not found/);
}));

test('unlock: stick absent -> exit 0, no cryptsetup, poke locked:true', withRoot({ stick: false }, (r) => {
  const res = run(r);
  assert.equal(res.code, 0);
  assert.match(res.out, /data locked: key stick not found \(insert it; it unlocks by itself\)/);
  noCrypt(res);
  assert.doesNotMatch(res.log, /^mount /m);
  assert.match(res.log, /curl .*"locked":true.* http:\/\/127\.0\.0\.1:8138\/event/);
}));

test('unlock: already mounted -> no cryptsetup, poke', withRoot({}, (r) => {
  const res = run(r, { env: { MOUNTED: '1' } });
  assert.equal(res.code, 0);
  assert.match(res.out, /already unlocked/);
  noCrypt(res);
  assert.match(res.log, /curl .*"locked":false/);
}));

test('unlock: data partition missing', withRoot({ data: false }, (r) => {
  const res = run(r);
  assert.equal(res.code, 1);
  assert.match(res.err, /data partition not found/);
  noCrypt(res);
}));

test('unlock: key file missing', withRoot({ stickFiles: () => {} }, (r) => {
  const res = run(r);
  assert.equal(res.code, 1);
  noCrypt(res);
  assert.match(res.log, /umount /);
  assert.equal(fs.existsSync(path.join(r, 'run/revview-key')), false);
}));

test('unlock: key file a symlink', withRoot({
  stickFiles: (d) => {
    fs.mkdirSync(path.join(d, 'revview'));
    fs.writeFileSync(path.join(d, 'real.key'), SECRET.repeat(4));
    fs.symlinkSync('../real.key', path.join(d, 'revview/data.key'));
  },
}, (r) => {
  const res = run(r);
  assert.equal(res.code, 1);
  assert.match(res.err, /symlink/);
  noCrypt(res);
  assert.match(res.log, /umount /);
}));

test('unlock: a symlinked directory component', withRoot({
  stickFiles: (d) => {
    fs.mkdirSync(path.join(d, 'elsewhere'));
    fs.writeFileSync(path.join(d, 'elsewhere/data.key'), SECRET.repeat(4));
    fs.symlinkSync('elsewhere', path.join(d, 'revview'));
  },
}, (r) => {
  const res = run(r);
  assert.equal(res.code, 1);
  assert.match(res.err, /symlink/);
  noCrypt(res);
}));

for (const [name, size] of [['too small', 31], ['too large', 8193]]) {
  test(`unlock: key ${name}`, withRoot({
    stickFiles: (d) => {
      fs.mkdirSync(path.join(d, 'revview'));
      fs.writeFileSync(path.join(d, 'revview/data.key'), 'k'.repeat(size));
    },
  }, (r) => {
    const res = run(r);
    assert.equal(res.code, 1);
    assert.match(res.err, /size/);
    noCrypt(res);
    assert.match(res.log, /umount /);
  }));
}

test('unlock: size limits 32 and 8192 are accepted', withRoot({
  stickFiles: (d) => {
    fs.mkdirSync(path.join(d, 'revview'));
    fs.writeFileSync(path.join(d, 'revview/data.key'), 'k'.repeat(32));
  },
}, (r) => {
  assert.equal(run(r).code, 0);
}));

test('unlock: cryptsetup fails -> exit 1, stick unmounted, nothing mounted', withRoot({}, (r) => {
  const res = run(r, { env: { CRYPT_RC: '2' } });
  assert.equal(res.code, 1);
  assert.match(res.err, /does not open the data partition/);
  assert.match(res.log, /umount /);
  assert.doesNotMatch(res.log, /e2fsck/);
  assert.equal(fs.existsSync(path.join(r, 'run/revview-key')), false);
  assert.ok(!res.all.includes(SECRET));
}));

test('unlock: e2fsck 4 -> no mount, exit 1', withRoot({}, (r) => {
  const res = run(r, { env: { FSCK_RC: '4' } });
  assert.equal(res.code, 1);
  assert.match(res.err, /run e2fsck by hand/);
  assert.doesNotMatch(res.log, /mount .*noatime/);
}));

test('unlock: e2fsck 1 -> mounted; 2 -> mounted with a reboot note', withRoot({}, (r) => {
  const a = run(r, { env: { FSCK_RC: '1' } });
  assert.equal(a.code, 0, a.err);
  assert.match(a.log, /mount -o noatime,nosuid,nodev /);
  const b = run(r, { env: { FSCK_RC: '2' } });
  assert.equal(b.code, 0, b.err);
  assert.match(b.out, /file system repaired, a reboot is advised/);
}));

test('unlock: already open mapping skips the stick', withRoot({}, (r) => {
  fs.mkdirSync(path.join(r, 'dev/mapper'));
  fs.writeFileSync(path.join(r, 'dev/mapper/revview-data'), '');
  const res = run(r);
  assert.equal(res.code, 0, res.err);
  noCrypt(res);
  assert.doesNotMatch(res.log, /^umount /m);
  assert.match(res.log, /e2fsck/);
  assert.match(res.log, /mount -o noatime,nosuid,nodev /);
}));

test('unlock: success path order, key never shown', withRoot({}, (r) => {
  const res = run(r);
  assert.equal(res.code, 0, res.err);
  const lines = res.log.trim().split('\n');
  const idx = (re) => lines.findIndex((l) => re.test(l));
  const kd = path.join(r, 'run/revview-key');
  const iStick = idx(/^mount -o ro,nosuid,nodev,noexec /);
  const iCrypt = idx(/^cryptsetup open /);
  const iUmount = idx(/^umount /);
  const iFsck = idx(/^e2fsck -p /);
  const iData = idx(/^mount -o noatime,nosuid,nodev /);
  const iCurl = idx(/^curl .*"locked":false/);
  assert.ok(iStick >= 0 && iStick < iCrypt && iCrypt < iUmount && iUmount < iFsck && iFsck < iData && iData < iCurl, res.log);
  assert.ok(lines[iStick].endsWith(` ${kd}`));
  assert.ok(lines[iCrypt].includes(`--type luks2 --key-file ${kd}/revview/data.key `), lines[iCrypt]);
  assert.ok(lines[iCrypt].includes(`${r}/dev/disk/by-uuid/${DATA_UUID} revview-data`));
  assert.ok(lines[iData].endsWith(`${r}/dev/mapper/revview-data ${r}/srv/revview-data`));
  assert.ok(!res.all.includes(SECRET.slice(0, 20)));
  assert.equal(fs.existsSync(kd), false, 'key mount dir removed');
}));

test('unlock: key mount dir is mode 0700 when created', withRoot({}, (r) => {
  fs.writeFileSync(path.join(r, 'stubs/mount'),
    '#!/bin/bash\nstat -c %a "${!#}" >> "$LOG"\n');
  const res = run(r);
  assert.equal(res.code, 1);
  assert.match(res.log, /^700$/m);
}));

test('unlock: a symlink as the key mount dir is refused', withRoot({}, (r) => {
  fs.mkdirSync(path.join(r, 'elsewhere'));
  fs.symlinkSync('elsewhere', path.join(r, 'run/revview-key'));
  const res = run(r);
  assert.equal(res.code, 1);
  assert.match(res.err, /symlink/);
  assert.doesNotMatch(res.log, /^mount /m);
}));

test('unlock: a data mount dir that is a symlink is refused', withRoot({}, (r) => {
  fs.rmSync(path.join(r, 'srv/revview-data'), { recursive: true });
  fs.mkdirSync(path.join(r, 'elsewhere'));
  fs.symlinkSync('../elsewhere', path.join(r, 'srv/revview-data'));
  const res = run(r);
  assert.equal(res.code, 1);
  assert.doesNotMatch(res.log, /mount -o noatime/);
}));

test('unlock: bad arguments exit 2', withRoot({}, (r) => {
  assert.equal(run(r, { args: ['--bogus'] }).code, 2);
  assert.equal(run(r, { args: ['--root'] }).code, 2);
  assert.equal(run(r, { args: ['--root', path.join(r, 'nonexistent')] }).code, 2);
  assert.equal(run(r, { args: ['extra'] }).code, 2);
}));

test('unlock: --root resolving to / is refused', withRoot({}, (r) => {
  fs.symlinkSync('/', path.join(r, 'rootlink'));
  const res = run(r, { args: ['--root', path.join(r, 'rootlink')] });
  assert.equal(res.code, 2);
  assert.match(res.err, /resolves to \//);
  assert.equal(res.log, '');
}));

test('unlock.sh passes shellcheck', (t) => {
  const v = spawnSync('shellcheck', ['--version']);
  if (v.error) { t.skip('shellcheck not installed'); return; }
  const p = spawnSync('shellcheck', [UNLOCK], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stdout);
});

test('unit and udev rule templates', () => {
  const unit = fs.readFileSync(path.join(ROOT, 'pi/revview-unlock.service'), 'utf8');
  assert.match(unit, /^ExecStart=\/bin\/bash @REVVIEW_DIR@\/pi\/unlock\.sh$/m);
  assert.match(unit, /^Type=oneshot$/m);
  assert.match(unit, /^After=local-fs\.target$/m);
  assert.match(unit, /^WantedBy=multi-user\.target$/m);
  assert.doesNotMatch(unit, /^RemainAfterExit/m);
  const rule = fs.readFileSync(path.join(ROOT, 'pi/72-revview-key.rules'), 'utf8');
  assert.match(rule, /ENV\{ID_FS_UUID\}=="@KEY_UUID@"/);
  assert.match(rule, /ENV\{SYSTEMD_WANTS\}\+="revview-unlock\.service"/);
  const sh = fs.readFileSync(UNLOCK, 'utf8');
  for (const c of ['/etc/revview/data.conf', 'revview-data', '/srv/revview-data', '/run/revview-key',
    'http://127.0.0.1:8138/event']) assert.ok(sh.includes(c), c);
});
