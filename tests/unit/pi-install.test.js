import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = path.join(ROOT, 'tests/unit/fixtures/pi');
const INSTALL = path.join(ROOT, 'pi/install.sh');

function fakeRoot() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'revview-inst-pi-'));
  for (const d of ['boot/firmware', 'etc/lightdm', 'etc/systemd/system']) fs.mkdirSync(path.join(r, d), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'cmdline.txt'), path.join(r, 'boot/firmware/cmdline.txt'));
  fs.copyFileSync(path.join(FIX, 'config.txt'), path.join(r, 'boot/firmware/config.txt'));
  fs.copyFileSync(path.join(FIX, 'lightdm.conf'), path.join(r, 'etc/lightdm/lightdm.conf'));
  fs.writeFileSync(path.join(r, 'etc/systemd/system/revview.service'), '[Service]\nUser=revview\n');
  fs.writeFileSync(path.join(r, 'etc/passwd'),
    `root:x:0:0:root:/root:/bin/bash\nalice:x:${process.getuid()}:${process.getgid()}:Alice:/home/alice:/bin/bash\n`);
  return r;
}
const run = (args) => {
  const p = spawnSync('bash', [INSTALL, ...args], { encoding: 'utf8' });
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
const withRoot = (fn) => async (t) => {
  const r = fakeRoot();
  try { await fn(r, t); } finally { fs.rmSync(r, { recursive: true, force: true }); }
};
const base = (r, extra = []) => ['--root', r, '--user', 'alice', '--no-apt', ...extra, ROOT];

test('install.sh: fake root gets every file, the hooks, and the old unit goes', withRoot((r) => {
  const res = run(base(r));
  assert.equal(res.code, 0, res.out + res.err);
  const p = (x) => path.join(r, x);
  for (const f of ['boot/firmware/cmdline.txt.revview-backup', 'etc/udev/rules.d/70-revview-dongle.rules',
    'etc/udev/rules.d/71-revview-touch.rules', 'etc/systemd/user/revview.service', 'var/lib/systemd/linger/alice',
    'etc/revview/server.env', 'home/alice/.config/labwc/autostart']) assert.ok(fs.existsSync(p(f)), f);
  assert.equal(fs.readlinkSync(p('etc/systemd/user/default.target.wants/revview.service')), '/etc/systemd/user/revview.service');
  assert.match(fs.readFileSync(p('etc/lightdm/lightdm.conf'), 'utf8'), /^autologin-user=alice$/m);
  assert.equal(fs.existsSync(p('etc/systemd/system/revview.service')), false);
  assert.match(res.out, /removed the old system unit/);
  assert.match(res.out, /userdel revview/);
  assert.match(res.out, /skipped packages/);
  assert.match(res.out, /would add alice to groups input,audio,video,spi/);
  assert.match(res.out, /sudo journalctl --user-unit=revview/);
  const settings = fs.readFileSync(p('home/alice/.claude/settings.json'), 'utf8');
  assert.match(settings, /# revview-hook/);
  const unit = fs.readFileSync(p('etc/systemd/user/revview.service'), 'utf8');
  assert.ok(unit.includes(`${ROOT.replace(/\/$/, '')}/src/server/index.js`));
  assert.match(unit, /--boot/);
  assert.ok(unit.includes(` --lights-config ${ROOT.replace(/\/$/, '')}/config/lights.json --settings /srv/revview-data/revview/settings.json\n`), 'the unit passes --lights-config with the repo path, then --settings on the data partition');
}));

test('install.sh: a second run changes nothing', withRoot((r) => {
  assert.equal(run(base(r)).code, 0);
  const before = snapshot(r);
  const res = run(base(r));
  assert.equal(res.code, 0, res.out + res.err);
  assert.deepEqual(snapshot(r), before);
  assert.doesNotMatch(res.out, /^wrote /m);
}));

test('install.sh: --dry-run writes nothing', withRoot((r) => {
  const before = snapshot(r);
  const res = run(base(r, ['--dry-run']));
  assert.equal(res.code, 0, res.out + res.err);
  assert.match(res.out, /would write /);
  assert.match(res.out, /would install the Claude Code hooks for alice/);
  assert.deepEqual(snapshot(r), before);
}));

test('install.sh: unknown user, bad rotation, root user, bad dir fail', withRoot((r) => {
  assert.notEqual(run(['--root', r, '--user', 'nobody-here', '--no-apt', ROOT]).code, 0);
  assert.notEqual(run(base(r, ['--rotate', '180'])).code, 0);
  assert.notEqual(run(['--root', r, '--user', 'root', '--no-apt', ROOT]).code, 0);
  assert.notEqual(run(['--root', r, '--no-apt', ROOT]).code, 0);
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'revview bad-'));
  try { assert.notEqual(run(['--root', r, '--user', 'alice', '--no-apt', bad]).code, 0); } finally { fs.rmSync(bad, { recursive: true }); }
  assert.equal(fs.existsSync(path.join(r, 'etc/systemd/user')), false, 'nothing written after a refusal');
}));

const hasShellcheck = spawnSync('shellcheck', ['--version']).status === 0;
test('shellcheck is clean on the scripts and the generated autostart', { skip: hasShellcheck ? false : 'shellcheck not on PATH' }, withRoot((r) => {
  assert.equal(run(base(r)).code, 0);
  const files = [INSTALL, path.join(ROOT, 'pi/kiosk.sh'), path.join(r, 'home/alice/.config/labwc/autostart')];
  const p = spawnSync('shellcheck', files, { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stdout + p.stderr);
}));

test('install.sh: REVVIEW_DIR outside the allow-list is refused, usage says so', withRoot((r) => {
  for (const name of ['a$b', 'a;b', "a'b", 'a&b', 'a(b', 'a#b', 'a`b']) {
    const d = path.join(os.tmpdir(), `revview-dir-${process.pid}${name}`);
    fs.mkdirSync(d, { recursive: true });
    try {
      const res = run(['--root', r, '--user', 'alice', '--no-apt', d]);
      assert.equal(res.code, 2, name);
      assert.match(res.err, /A-Za-z0-9/);
    } finally { fs.rmSync(d, { recursive: true }); }
  }
  assert.equal(fs.existsSync(path.join(r, 'etc/systemd/user')), false);
}));

test('install.sh: a --root that is a symlink to / is refused', withRoot((r) => {
  const link = `${r}-slash`;
  fs.symlinkSync('/', link);
  try {
    const res = run(['--root', link, '--user', 'alice', '--no-apt', '--dry-run', ROOT]);
    assert.equal(res.code, 2);
    assert.match(res.err, /resolves to \//);
  } finally { fs.rmSync(link); }
}));

test('install.sh: a failed file step (cmdline.txt without root=) still finishes the rest, then exits non-zero', withRoot((r) => {
  fs.writeFileSync(path.join(r, 'boot/firmware/cmdline.txt'), '');
  const res = run(base(r));
  assert.equal(res.code, 1, res.out + res.err);
  assert.ok(fs.existsSync(path.join(r, 'home/alice/.claude/settings.json')), 'hooks still installed');
  assert.equal(fs.readFileSync(path.join(r, 'boot/firmware/cmdline.txt'), 'utf8'), '');
}));

const OVERLAY_MOUNTS = 'overlayroot / overlay rw,relatime,lowerdir=/media/root-ro,upperdir=/media/root-rw/overlay 0 0\n';
const EXT4_MOUNTS = '/dev/mmcblk0p2 / ext4 rw,noatime 0 0\n/dev/mmcblk0p1 /boot/firmware vfat rw,relatime 0 0\n';
const writeMounts = (r, text) => {
  fs.mkdirSync(path.join(r, 'proc'), { recursive: true });
  fs.writeFileSync(path.join(r, 'proc/mounts'), text);
};

test('install.sh: refused (exit 2, nothing written) when / is an overlay, also with --dry-run', withRoot((r) => {
  writeMounts(r, OVERLAY_MOUNTS);
  const before = snapshot(r);
  for (const extra of [[], ['--dry-run']]) {
    const res = run(base(r, extra));
    assert.equal(res.code, 2, res.out + res.err);
    assert.match(res.err, /overlay/);
    assert.deepEqual(snapshot(r), before);
  }
}));

test('install.sh: refused when /boot/firmware is mounted read-only, also with --dry-run', withRoot((r) => {
  writeMounts(r, '/dev/mmcblk0p2 / ext4 rw 0 0\n/dev/mmcblk0p1 /boot/firmware vfat ro,relatime 0 0\n');
  const before = snapshot(r);
  for (const extra of [[], ['--dry-run']]) {
    const res = run(base(r, extra));
    assert.equal(res.code, 2, res.out + res.err);
    assert.match(res.err, /\/boot\/firmware is mounted read-only/);
    assert.deepEqual(snapshot(r), before);
  }
}));

test('install.sh: runs with a normal ext4 root in proc/mounts', withRoot((r) => {
  writeMounts(r, EXT4_MOUNTS);
  const res = run(base(r));
  assert.equal(res.code, 0, res.out + res.err);
  assert.doesNotMatch(res.out, /read-only root is turned on/);
}));

test('install.sh: overlayroot= in cmdline.txt (overlay not active yet) is a note, not an error', withRoot((r) => {
  const f = path.join(r, 'boot/firmware/cmdline.txt');
  fs.writeFileSync(f, `overlayroot=tmpfs ${fs.readFileSync(f, 'utf8').trim()}\n`);
  const res = run(base(r));
  assert.equal(res.code, 0, res.out + res.err);
  assert.match(res.out, /the read-only root is turned on for the next boot: what this run writes is kept/);
}));

test('install.sh: overlayroot=disabled in cmdline.txt gives no "turned on" note', withRoot((r) => {
  const f = path.join(r, 'boot/firmware/cmdline.txt');
  fs.writeFileSync(f, `overlayroot=disabled ${fs.readFileSync(f, 'utf8').trim()}\n`);
  const res = run(base(r));
  assert.equal(res.code, 0, res.out + res.err);
  assert.doesNotMatch(res.out, /read-only root is turned on/);
}));

test('install.sh: ~/.claude pointing to a missing locked data dir skips the hooks, exits 1, writes the rest', withRoot((r) => {
  fs.mkdirSync(path.join(r, 'home/alice'), { recursive: true });
  fs.symlinkSync('/srv/revview-data/claude', path.join(r, 'home/alice/.claude'));
  const res = run(base(r));
  assert.equal(res.code, 1, res.out + res.err);
  assert.match(res.out, /skipped hooks: ~\/\.claude is a link to \/srv\/revview-data\/claude, which does not exist; if that is the locked data partition, insert the key stick/);
  assert.match(res.err, /not done: some files were refused/);
  assert.doesNotMatch(res.out, /^done\. Next:/m);
  assert.ok(fs.existsSync(path.join(r, 'etc/systemd/user/revview.service')));
  assert.ok(fs.existsSync(path.join(r, 'home/alice/.config/labwc/autostart')));
  assert.equal(fs.existsSync(path.join(r, 'srv')), false, 'nothing created behind the link');
}));

test('install.sh: ~/.claude pointing to an existing data dir gets the hooks installed into it', withRoot((r) => {
  fs.mkdirSync(path.join(r, 'srv/revview-data/claude'), { recursive: true });
  fs.mkdirSync(path.join(r, 'home/alice'), { recursive: true });
  fs.symlinkSync('../../srv/revview-data/claude', path.join(r, 'home/alice/.claude'));
  const res = run(base(r));
  assert.equal(res.code, 0, res.out + res.err);
  assert.doesNotMatch(res.out, /skipped hooks/);
  assert.match(fs.readFileSync(path.join(r, 'srv/revview-data/claude/settings.json'), 'utf8'), /# revview-hook/);
}));

test('revview.service: data.env, the auto-updater off, flags unchanged', () => {
  const unit = fs.readFileSync(path.join(ROOT, 'pi/revview.service'), 'utf8').replace(/^#.*$/gm, '');
  assert.match(unit, /^EnvironmentFile=-\/etc\/revview\/data\.env$/m);
  assert.match(unit, /^Environment=DISABLE_AUTOUPDATER=1$/m);
  assert.match(unit, /--input .*--sessions --boot --netmon --thermal/);
});

test('install.sh: a symlinked ~/.config/labwc is refused: exit 1, nothing at the target', withRoot((r) => {
  const elsewhere = path.join(r, 'elsewhere');
  fs.mkdirSync(path.join(r, 'home/alice/.config'), { recursive: true });
  fs.mkdirSync(elsewhere);
  fs.symlinkSync(elsewhere, path.join(r, 'home/alice/.config/labwc'));
  const res = run(base(r));
  assert.equal(res.code, 1, res.out + res.err);
  assert.match(res.out, /skipped .*autostart: .*labwc is a symlink/);
  assert.match(res.err, /some files were refused/);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
}));

test('install.sh: setup.mjs crashing stops it: exit 3, no hooks, no done line', withRoot((r) => {
  fs.mkdirSync(path.join(r, 'home/alice/.config/labwc/autostart'), { recursive: true });
  const res = run(base(r));
  assert.equal(res.code, 3, res.out + res.err);
  assert.match(res.err, /setup\.mjs: failed part way/);
  assert.match(res.err, /install\.sh: setup\.mjs failed part way \(exit 3\); nothing after that point was done, the hooks were not installed/);
  assert.doesNotMatch(res.err, /some files were refused/);
  assert.doesNotMatch(res.out, /^done\. Next:/m);
  assert.equal(fs.existsSync(path.join(r, 'home/alice/.claude/settings.json')), false);
}));

test('install.sh: a two-line cmdline.txt, a missing cmdline.txt, a missing config.txt: exit 1, rest done', withRoot((r) => {
  const cmd = path.join(r, 'boot/firmware/cmdline.txt');
  fs.writeFileSync(cmd, 'console=tty1 root=/dev/x\nextra\n');
  const res = run(base(r));
  assert.equal(res.code, 1, res.out + res.err);
  assert.match(res.err, /some files were refused/);
  assert.equal(fs.readFileSync(cmd, 'utf8'), 'console=tty1 root=/dev/x\nextra\n');
  assert.ok(fs.existsSync(path.join(r, 'home/alice/.claude/settings.json')), 'hooks still installed on exit 1');
  fs.rmSync(cmd);
  assert.equal(run(base(r)).code, 1);
  fs.writeFileSync(cmd, 'console=tty1 root=/dev/x\n');
  fs.rmSync(path.join(r, 'boot/firmware/config.txt'));
  assert.equal(run(base(r)).code, 1);
}));

// A copy of pi/ whose setup.mjs is replaced by `body`: install.sh is run from the copy (it finds setup.mjs next to itself).
function withFakeSetup(body, fn) {
  return withRoot(async (r) => {
    const piCopy = fs.mkdtempSync(path.join(os.tmpdir(), 'revview-inst-picopy-'));
    try {
      fs.cpSync(path.join(ROOT, 'pi'), piCopy, { recursive: true });
      fs.writeFileSync(path.join(piCopy, 'setup.mjs'), body);
      const p = spawnSync('bash', [path.join(piCopy, 'install.sh'), ...base(r)], { encoding: 'utf8' });
      await fn(r, { code: p.status, out: p.stdout, err: p.stderr });
    } finally { fs.rmSync(piCopy, { recursive: true, force: true }); }
  });
}

test('install.sh: setup.mjs dying at load time (exit 1 from node) is a failure, not a refusal: stops, no hooks, no done', withFakeSetup(
  "throw new Error('boom at import');\n", (r, res) => {
    assert.equal(res.code, 1, res.out + res.err);
    assert.match(res.err, /install\.sh: setup\.mjs failed part way \(exit 1\); nothing after that point was done, the hooks were not installed/);
    assert.doesNotMatch(res.err, /some files were refused/);
    assert.doesNotMatch(res.out, /^done\. Next:/m);
    assert.equal(fs.existsSync(path.join(r, 'home/alice/.claude/settings.json')), false);
  }));

test('install.sh: setup.mjs exit 4 (refused) runs the rest and ends with exit 1', withFakeSetup(
  'process.exit(4);\n', (r, res) => {
    assert.equal(res.code, 1, res.out + res.err);
    assert.match(res.err, /some files were refused/);
    assert.match(res.err, /not done: some files were refused.*\n$/);
    assert.doesNotMatch(res.out, /^done\. Next:/m);
    assert.ok(fs.existsSync(path.join(r, 'home/alice/.claude/settings.json')));
  }));

test('install.sh: setup.mjs exit 2 (bad arguments): exit 2 with its own message, nothing written, no hooks', withFakeSetup(
  'process.exit(2);\n', (r, res) => {
    assert.equal(res.code, 2, res.out + res.err);
    assert.match(res.err, /install\.sh: setup\.mjs refused the arguments \(see above\); nothing was written/);
    assert.doesNotMatch(res.out, /^done\. Next:/m);
    assert.equal(fs.existsSync(path.join(r, 'home/alice/.claude/settings.json')), false);
  }));

// ---- r7-03: the dongle ids and key map live in /etc/revview/buttons.json and survive re-runs ----

const RULE = 'etc/udev/rules.d/70-revview-dongle.rules';
const BTNS = 'etc/revview/buttons.json';

test('install.sh: first run creates /etc/revview/buttons.json from config/buttons.json and the rule has 1d50/615e', withRoot((r) => {
  const res = run(base(r));
  assert.equal(res.code, 0, res.out + res.err);
  assert.equal(fs.readFileSync(path.join(r, BTNS), 'utf8'), fs.readFileSync(path.join(ROOT, 'config/buttons.json'), 'utf8'));
  const rule = fs.readFileSync(path.join(r, RULE), 'utf8');
  assert.match(rule, /ATTRS\{idVendor\}=="1d50", ATTRS\{idProduct\}=="615e"/);
  assert.doesNotMatch(rule, /@VENDOR@|@PRODUCT@/);
  assert.doesNotMatch(res.out, /^note: \/etc\/revview\/buttons\.json/m);
}));

test('install.sh: an edit of the ids in /etc/revview/buttons.json is kept and the rule follows it', withRoot((r) => {
  assert.equal(run(base(r)).code, 0);
  const f = path.join(r, BTNS);
  const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
  cfg.device.vendor = 'ABCD';
  cfg.device.product = '12ef';
  const edited = `${JSON.stringify(cfg, null, 2)}\n`;
  fs.writeFileSync(f, edited);
  const res = run(base(r));
  assert.equal(res.code, 0, res.out + res.err);
  assert.equal(fs.readFileSync(f, 'utf8'), edited);
  const rule = fs.readFileSync(path.join(r, RULE), 'utf8');
  assert.match(rule, /ATTRS\{idVendor\}=="abcd", ATTRS\{idProduct\}=="12ef"/);
  assert.doesNotMatch(rule, /"1d50"|"615e"/);
  // the first run recorded the shipped version, so an owner-only edit is merged silently (pi-buttons-merge.test.js)
  assert.doesNotMatch(res.out, /^note: \/etc\/revview\/buttons\.json/m);
  assert.equal(fs.readFileSync(path.join(r, 'var/lib/revview/buttons.shipped.json'), 'utf8'), fs.readFileSync(path.join(ROOT, 'config/buttons.json'), 'utf8'));
}));

test('install.sh: invalid ids in /etc/revview/buttons.json: exit 1, the rule stays, the message names the file', withRoot((r) => {
  assert.equal(run(base(r)).code, 0);
  const rulePath = path.join(r, RULE);
  const before = fs.readFileSync(rulePath, 'utf8');
  const f = path.join(r, BTNS);
  for (const [label, text] of [['bad hex', JSON.stringify({ device: { vendor: 'zz', product: '615e' } })],
    ['missing', JSON.stringify({ device: { vendor: '1d50' } })], ['not json', '{nope']]) {
    fs.writeFileSync(f, text);
    const res = run(base(r));
    assert.equal(res.code, 1, `${label}: ${res.out}${res.err}`);
    assert.equal(fs.readFileSync(rulePath, 'utf8'), before, label);
    assert.match(res.out + res.err, /\/etc\/revview\/buttons\.json/, label);
  }
}));

test('install.sh: /etc/revview/buttons.json as a symlink is refused, the rule stays', withRoot((r) => {
  assert.equal(run(base(r)).code, 0);
  const rulePath = path.join(r, RULE);
  const before = fs.readFileSync(rulePath, 'utf8');
  const f = path.join(r, BTNS);
  const real = path.join(r, 'elsewhere.json');
  fs.renameSync(f, real);
  fs.symlinkSync(real, f);
  const res = run(base(r));
  assert.equal(res.code, 1, res.out + res.err);
  assert.equal(fs.readFileSync(rulePath, 'utf8'), before);
  assert.match(res.out + res.err, /\/etc\/revview\/buttons\.json/);
}));

test('install.sh: the rendered unit reads --input /etc/revview/buttons.json', withRoot((r) => {
  assert.equal(run(base(r)).code, 0);
  const unit = fs.readFileSync(path.join(r, 'etc/systemd/user/revview.service'), 'utf8');
  const exec = unit.split('\n').find((l) => l.startsWith('ExecStart='));
  assert.match(exec, / --input \/etc\/revview\/buttons\.json /);
  assert.doesNotMatch(exec, /config\/buttons\.json/);
}));

test('install.sh: the Next: line names /etc/revview/buttons.json, the re-run and the restart', withRoot((r) => {
  const res = run(base(r));
  assert.equal(res.code, 0, res.out + res.err);
  const next = res.out.slice(res.out.indexOf('done. Next:'));
  assert.match(next, /edit \/etc\/revview\/buttons\.json/);
  assert.match(next, /sudo bash .*pi\/install\.sh/);
  assert.match(next, /systemctl --user restart revview/);
  assert.doesNotMatch(next, /70-revview-dongle\.rules and config\/buttons\.json/);
}));

test('install.sh: the packages needed include sox (voice recording)', withRoot((r) => {
  const res = run(base(r));
  const line = res.out.split('\n').find((l) => l.startsWith('skipped packages'));
  assert.match(line, /needed: .*\bsox\b/);
}));

// ---- QA r7 round 2: pins for the dongle rule guards ----

const { renderDongleRule } = await import('../../pi/setup.mjs');
const TEMPLATE = fs.readFileSync(path.join(ROOT, 'pi/70-revview-dongle.rules'), 'utf8');
const BAD_IDS = ['1d500', '1d5', '1d50"', '1d50\n', '1d50", GOTO="x', 7350, null];

test('renderDongleRule: anything but exactly 4 hex digits throws; good ids are lowercased and nothing else changes', () => {
  for (const bad of BAD_IDS) {
    assert.throws(() => renderDongleRule(TEMPLATE, { vendor: bad, product: '615e' }), /device\.vendor/, JSON.stringify(bad));
    assert.throws(() => renderDongleRule(TEMPLATE, { vendor: '1d50', product: bad }), /device\.product/, JSON.stringify(bad));
  }
  const ok = renderDongleRule(TEMPLATE, { vendor: '1D50', product: 'ABCD' });
  assert.match(ok, /ATTRS\{idVendor\}=="1d50", ATTRS\{idProduct\}=="abcd"/);
  assert.doesNotMatch(ok, /@/);
});

test('install.sh: ids that could inject into the udev rule are refused: exit 1, rule untouched, no @ or stray line', withRoot((r) => {
  assert.equal(run(base(r)).code, 0);
  const rulePath = path.join(r, RULE);
  const before = fs.readFileSync(rulePath, 'utf8');
  const f = path.join(r, BTNS);
  const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const bad of BAD_IDS) {
    for (const k of ['vendor', 'product']) {
      fs.writeFileSync(f, JSON.stringify({ ...cfg, device: { ...cfg.device, [k]: bad } }));
      const res = run(base(r));
      const label = `${k}=${JSON.stringify(bad)}`;
      assert.equal(res.code, 1, `${label}: ${res.out}${res.err}`);
      const rule = fs.readFileSync(rulePath, 'utf8');
      assert.equal(rule, before, label);
      assert.doesNotMatch(rule, /@/, label);
      assert.equal(rule.split('\n').length, before.split('\n').length, label);
    }
  }
}));

test('install.sh: a symlinked buttons.json pointing at DIFFERENT valid ids: rule does not take them, exit 1, says symlink', withRoot((r) => {
  assert.equal(run(base(r)).code, 0);
  const rulePath = path.join(r, RULE);
  const before = fs.readFileSync(rulePath, 'utf8');
  const f = path.join(r, BTNS);
  const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
  const real = path.join(r, 'elsewhere.json');
  fs.writeFileSync(real, JSON.stringify({ ...cfg, device: { ...cfg.device, vendor: 'abcd', product: '1234' } }));
  fs.rmSync(f);
  fs.symlinkSync(real, f);
  const res = run(base(r));
  assert.notEqual(res.code, 0);
  assert.equal(fs.readFileSync(rulePath, 'utf8'), before);
  assert.doesNotMatch(fs.readFileSync(rulePath, 'utf8'), /abcd|1234/);
  assert.match(res.out + res.err, /symlink/);
}));

test('install.sh: a symlinked /etc/revview directory is refused for the read too: rule untouched, exit 1', withRoot((r) => {
  assert.equal(run(base(r)).code, 0);
  const rulePath = path.join(r, RULE);
  const before = fs.readFileSync(rulePath, 'utf8');
  const dir = path.join(r, 'etc/revview');
  const real = path.join(r, 'elsewhere-dir');
  fs.renameSync(dir, real);
  const cfg = JSON.parse(fs.readFileSync(path.join(real, 'buttons.json'), 'utf8'));
  fs.writeFileSync(path.join(real, 'buttons.json'), JSON.stringify({ ...cfg, device: { ...cfg.device, vendor: 'abcd', product: '1234' } }));
  fs.symlinkSync(real, dir);
  const res = run(base(r));
  assert.equal(res.code, 1, res.out + res.err);
  assert.equal(fs.readFileSync(rulePath, 'utf8'), before);
  assert.match(res.out + res.err, /etc\/revview is a symlink/);
  assert.doesNotMatch(res.out, /differs from/);
}));

test('install.sh: a device with only name (or path): no rule written, a note, exit 0; one id alone is still refused', withRoot((r) => {
  assert.equal(run(base(r)).code, 0);
  const rulePath = path.join(r, RULE);
  const before = fs.readFileSync(rulePath, 'utf8');
  const f = path.join(r, BTNS);
  const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const device of [{ name: 'Wheel' }, { path: '/dev/input/event9' }]) {
    fs.writeFileSync(f, JSON.stringify({ ...cfg, device }));
    const res = run(base(r));
    assert.equal(res.code, 0, res.out + res.err);
    assert.match(res.out, /^note: \/etc\/revview\/buttons\.json has no device\.vendor and device\.product: the dongle udev rule was not written/m);
    assert.equal(fs.readFileSync(rulePath, 'utf8'), before);
  }
  fs.writeFileSync(f, JSON.stringify({ ...cfg, device: { name: 'Wheel', vendor: '1d50' } }));
  assert.equal(run(base(r)).code, 1);
}));

test('install.sh: /etc/revview/buttons.json is mode 0644 whoever runs it, and the closing message says to edit it with sudo', withRoot((r) => {
  const res = run(base(r));
  assert.equal(res.code, 0, res.out + res.err);
  assert.equal(fs.statSync(path.join(r, BTNS)).mode & 0o777, 0o644);
  assert.match(res.out.slice(res.out.indexOf('done. Next:')), /edit \/etc\/revview\/buttons\.json with sudo \(sudoedit/);
}));

test('pi/README.md: says to edit /etc/revview/buttons.json with sudoedit and what a name-or-path-only device does', () => {
  const t = fs.readFileSync(path.join(ROOT, 'pi/README.md'), 'utf8');
  assert.match(t, /sudoedit `?\/etc\/revview\/buttons\.json/);
  assert.match(t, /`name` or `path` only/);
});

test('install.sh: buttons.json three-way merge: conflict exits 1 with the diff command; --adopt-buttons-base is passed on', withRoot((r) => {
  assert.equal(run(base(r)).code, 0);
  const f = path.join(r, BTNS);
  const baseF = path.join(r, 'var/lib/revview/buttons.shipped.json');
  const shipped = JSON.parse(fs.readFileSync(baseF, 'utf8'));
  const old = JSON.parse(JSON.stringify(shipped));
  old.timing.holdMs = 300;
  fs.writeFileSync(baseF, `${JSON.stringify(old, null, 2)}\n`);
  const mine = JSON.parse(JSON.stringify(old));
  mine.timing.holdMs = 350;
  const mineText = `${JSON.stringify(mine, null, 2)}\n`;
  fs.writeFileSync(f, mineText);
  const res = run(base(r));
  assert.equal(res.code, 1, res.out + res.err);
  assert.equal(fs.readFileSync(f, 'utf8'), mineText);
  assert.match(res.out + res.err, /diff \/etc\/revview\/buttons\.json /);
  // an install without a recorded version: kept, then adopted
  fs.rmSync(baseF);
  assert.equal(run(base(r)).code, 0);
  assert.equal(fs.existsSync(baseF), false);
  assert.equal(run([...base(r), '--adopt-buttons-base']).code, 0);
  assert.equal(JSON.parse(fs.readFileSync(baseF, 'utf8')).timing.holdMs, shipped.timing.holdMs);
  assert.equal(fs.readFileSync(f, 'utf8'), mineText);
}));

test('install.sh: SPI for the lights: python3-spidev is needed, dtparam=spi=on once, group spi, a second run changes nothing', withRoot((r) => {
  const res = run(base(r));
  assert.equal(res.code, 0, res.out + res.err);
  const line = res.out.split('\n').find((l) => l.startsWith('skipped packages'));
  assert.match(line, /\bpython3-spidev\b/);
  const cfg = () => fs.readFileSync(path.join(r, 'boot/firmware/config.txt'), 'utf8');
  assert.equal(cfg().match(/^dtparam=spi=on$/gm).length, 1);
  assert.match(res.out, /would add alice to groups input,audio,video,spi/);
  assert.match(res.out, /reboot/);
  const before = snapshot(r);
  assert.equal(run(base(r)).code, 0);
  assert.deepEqual(snapshot(r), before);
  assert.equal(cfg().match(/^dtparam=spi=on$/gm).length, 1);
}));

test('install.sh: a config.txt that already enables spi is not given a second line', withRoot((r) => {
  const f = path.join(r, 'boot/firmware/config.txt');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('#dtparam=spi=on', 'dtparam=spi=on'));
  assert.equal(run(base(r)).code, 0);
  assert.equal(fs.readFileSync(f, 'utf8').match(/^dtparam=spi=on$/gm).length, 1);
  assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /disable_splash=1\ndtparam=spi/);
}));

test('install.sh: an explicit dtparam=spi=off stays as it is, no spi=on is added, and a warning says the lights will not work', withRoot((r) => {
  const f = path.join(r, 'boot/firmware/config.txt');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('#dtparam=spi=on', 'dtparam=spi=off'));
  const res = run(base(r));
  assert.equal(res.code, 0, res.out + res.err);
  const cfg = fs.readFileSync(f, 'utf8');
  assert.equal(cfg.match(/^dtparam=spi=off$/gm).length, 1);
  assert.doesNotMatch(cfg, /^dtparam=spi=on$/m);
  assert.match(res.out, /warning .*config\.txt: dtparam=spi=off .*lights will not work/);
  const before = snapshot(r);
  const again = run(base(r));
  assert.equal(again.code, 0);
  assert.deepEqual(snapshot(r), before);
  assert.match(again.out, /lights will not work/);
}));
