import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWriter } from '../../pi/files.mjs';
import {
  editCmdline, editConfigTxt, editLightdm, renderAutostart, renderTouchRule, renderUnit, renderServerEnv,
} from '../../pi/setup.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = path.join(ROOT, 'tests/unit/fixtures/pi');
const fix = (n) => fs.readFileSync(path.join(FIX, n), 'utf8');
const SETUP = path.join(ROOT, 'pi/setup.mjs');

test('editCmdline: quiet boot tokens and the rotated mode, other tokens kept in order', () => {
  const out = editCmdline(fix('cmdline.txt'));
  assert.equal(out, 'console=serial0,115200 console=tty1 root=PARTUUID=1a2b3c4d-02 rootfstype=ext4 fsck.repair=yes rootwait '
    + 'plymouth.ignore-serial-consoles cfg80211.ieee80211_regdom=GB '
    + 'quiet loglevel=0 logo.nologo vt.global_cursor_default=0 video=HDMI-A-1:400x1280M@60,rotate=90\n');
  assert.equal(out.split('\n').length, 2);
  assert.doesNotMatch(out, /splash(?!\.)/);
});

test('editCmdline: idempotent, rotate 270, replaces old values', () => {
  const once = editCmdline(fix('cmdline.txt'));
  assert.equal(editCmdline(once), once);
  const flipped = editCmdline(once, { rotate: 270 });
  assert.match(flipped, /video=HDMI-A-1:400x1280M@60,rotate=270\n$/);
  assert.equal(flipped.match(/video=/g).length, 1);
  const old = editCmdline('root=x a loglevel=7 b vt.global_cursor_default=1 video=HDMI-A-1:1920x1080 video=HDMI-A-2:640x480 c logo.nologo\n');
  assert.equal(old, 'root=x a b video=HDMI-A-2:640x480 c quiet loglevel=0 logo.nologo vt.global_cursor_default=0 video=HDMI-A-1:400x1280M@60,rotate=90\n');
  assert.match(editCmdline('root=x', { output: 'DSI-1' }), /video=DSI-1:400x1280M@60,rotate=90\n$/);
});

test('editCmdline: bad input throws', () => {
  assert.throws(() => editCmdline('root=x b\nc d\n'), /one line/);
  assert.throws(() => editCmdline('root=x', { rotate: 180 }));
  assert.throws(() => editCmdline('root=x', { rotate: '90' }));
  assert.throws(() => editCmdline('root=x', { output: 'HDMI A' }));
  assert.throws(() => editCmdline('root=x', { output: '' }));
  assert.equal(editCmdline('root=x b\n\n'), editCmdline('root=x b'));
});

test('editConfigTxt: disable_splash=1 in a final [all] block, idempotent, warnings', () => {
  const { text, warnings } = editConfigTxt(fix('config.txt'));
  assert.deepEqual(warnings, []);
  assert.ok(text.endsWith('\n# revview: quiet boot (pi/install.sh)\n[all]\ndisable_splash=1\n'));
  assert.ok(text.startsWith(fix('config.txt').trimEnd()));
  assert.equal(text.match(/disable_splash/g).length, 1);
  assert.doesNotMatch(text, /hdmi_group|hdmi_timings/);
  assert.equal(editConfigTxt(text).text, text);
  const messy = editConfigTxt(`${fix('config.txt')}\n[cm4]\n  disable_splash = 0\n`).text;
  assert.equal(messy.match(/disable_splash/g).length, 1);
  assert.ok(messy.endsWith('disable_splash=1\n'));
});

test('editConfigTxt: warns without an active vc4 KMS overlay', () => {
  const noKms = fix('config.txt').replace('dtoverlay=vc4-kms-v3d', '#dtoverlay=vc4-kms-v3d');
  const { warnings } = editConfigTxt(noKms);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /vc4-kms-v3d/);
  assert.equal(editConfigTxt('').text, '# revview: quiet boot (pi/install.sh)\n[all]\ndisable_splash=1\n');
});

test('editLightdm: sets autologin-user in [Seat:*], idempotent, leaves the rest', () => {
  const out = editLightdm(fix('lightdm.conf'), 'alice');
  assert.equal(out, fix('lightdm.conf').replace('#autologin-user=\n', 'autologin-user=alice\n'));
  assert.equal(editLightdm(out, 'alice'), out);
  assert.match(editLightdm(out, 'bob'), /^autologin-user=bob$/m);
  assert.doesNotMatch(editLightdm(out, 'bob'), /alice/);
});

test('editLightdm: section missing, key missing, other section untouched', () => {
  assert.equal(editLightdm('[LightDM]\na=b\n', 'alice'), '[LightDM]\na=b\n\n[Seat:*]\nautologin-user=alice\n');
  assert.equal(editLightdm('[Seat:*]\nx=1\n[Other]\n#autologin-user=\n', 'alice'), '[Seat:*]\nautologin-user=alice\nx=1\n[Other]\n#autologin-user=\n');
  assert.equal(editLightdm('', 'alice'), '[Seat:*]\nautologin-user=alice\n');
  for (const bad of ['Alice', 'a b', '', 'root;x', '-x']) assert.throws(() => editLightdm('', bad), /user/);
});

test('renderAutostart: sh, rotation first, kiosk backgrounded', () => {
  const a = renderAutostart({ dir: '/opt/revview', output: 'HDMI-A-1', transform: 90 });
  assert.ok(a.startsWith('#!/bin/sh\n# labwc autostart, written by pi/install.sh'));
  assert.match(a, /REPLACES the system \/etc\/xdg\/labwc\/autostart/);
  assert.match(a, /^wlr-randr --output HDMI-A-1 --transform 90$/m);
  assert.match(a, /^\/opt\/revview\/pi\/kiosk\.sh &$/m);
  assert.ok(a.indexOf('wlr-randr') < a.indexOf('kiosk.sh &'));
  assert.match(renderAutostart({ dir: '/x', output: 'DSI-1', transform: 270 }), /--output DSI-1 --transform 270/);
  assert.throws(() => renderAutostart({ dir: '/x', output: 'a', transform: 0 }));
  assert.throws(() => renderAutostart({ dir: '/x y', output: 'a', transform: 90 }));
});

test('renderTouchRule: the matrices from DESIGN.md', () => {
  assert.ok(renderTouchRule(90).includes('ATTRS{idVendor}=="0712", ATTRS{idProduct}=="000a", ENV{LIBINPUT_CALIBRATION_MATRIX}="0 -1 1 1 0 0"\n'));
  assert.ok(renderTouchRule(270).includes('ENV{LIBINPUT_CALIBRATION_MATRIX}="0 1 0 -1 0 1"\n'));
  assert.ok(renderTouchRule(90).startsWith('#'));
  assert.throws(() => renderTouchRule(180));
});

test('renderUnit: placeholders replaced, unsafe values rejected', () => {
  const tpl = fs.readFileSync(path.join(ROOT, 'pi/revview.service'), 'utf8');
  const unit = renderUnit(tpl, { dir: '/opt/revview', node: '/usr/bin/node', user: 'alice' });
  assert.doesNotMatch(unit, /@[A-Z_]+@/);
  assert.match(unit, /^ConditionUser=alice$/m);
  assert.match(unit, /^ExecStart=\/usr\/bin\/node \/opt\/revview\/src\/server\/index\.js /m);
  assert.doesNotMatch(unit, /^User=/m);
  assert.doesNotMatch(unit, /^SupplementaryGroups=/m);
  for (const bad of ['/a b', '/a@b', '/a|b', '/a%b', '/a"b', '/a\\b', '/a\nb', '/a\tb', '']) {
    assert.throws(() => renderUnit(tpl, { dir: bad, node: '/usr/bin/node', user: 'alice' }), undefined, JSON.stringify(bad));
    assert.throws(() => renderUnit(tpl, { dir: '/opt/revview', node: bad, user: 'alice' }), undefined, JSON.stringify(bad));
  }
});

test('the rendered unit keeps the dongle test rules and has --boot and --netmon', () => {
  const tpl = fs.readFileSync(path.join(ROOT, 'pi/revview.service'), 'utf8');
  const unit = renderUnit(tpl, { dir: '/opt/revview', node: '/usr/bin/node', user: 'alice' });
  const exec = unit.split('\n').find((l) => l.startsWith('ExecStart='));
  assert.match(exec, /--input /);
  assert.match(exec, /--sessions/);
  assert.match(exec, /--boot/);
  assert.match(exec, /--netmon/);
  assert.match(exec, /--thermal/);
  assert.doesNotMatch(exec, /--dev-bridge/);
  assert.doesNotMatch(unit.replace(/^#.*$/gm, ''), /^(Requires|Wants|After|Before|BindsTo)=/m);
  assert.match(unit, /^WantedBy=default\.target$/m);
});

test('renderServerEnv: everything commented out', () => {
  const env = renderServerEnv();
  assert.match(env, /#REVVIEW_PROJECTS=/);
  assert.match(env, /#REVVIEW_START=/);
  assert.match(env, /#REVVIEW_NETMON_HOST=api\.anthropic\.com:443/);
  assert.equal(env.split('\n').filter((l) => l.trim() && !l.startsWith('#')).length, 0);
});

// ---- CLI against a fake root ----

function fakeRoot() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'revview-pi-'));
  fs.mkdirSync(path.join(r, 'boot/firmware'), { recursive: true });
  fs.mkdirSync(path.join(r, 'etc/lightdm'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'cmdline.txt'), path.join(r, 'boot/firmware/cmdline.txt'));
  fs.copyFileSync(path.join(FIX, 'config.txt'), path.join(r, 'boot/firmware/config.txt'));
  fs.copyFileSync(path.join(FIX, 'lightdm.conf'), path.join(r, 'etc/lightdm/lightdm.conf'));
  return r;
}
function cli(r, extra = []) {
  const args = [SETUP, '--root', r, '--user', 'alice', '--home', '/home/alice', '--dir', '/opt/revview',
    '--node', '/usr/local/bin/node', '--owner', `${process.getuid()}:${process.getgid()}`, ...extra];
  const p = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { code: p.status, out: p.stdout, err: p.stderr, lines: p.stdout.split('\n').filter(Boolean) };
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
const withRoot = (fn) => () => {
  const r = fakeRoot();
  try { fn(r); } finally { fs.rmSync(r, { recursive: true, force: true }); }
};

test('CLI: writes every file, with backups, in order', withRoot((r) => {
  const res = cli(r);
  assert.equal(res.code, 0, res.err);
  const p = (x) => path.join(r, x);
  assert.deepEqual(res.lines.filter((l) => l.startsWith('backup')), [
    `backup ${p('boot/firmware/cmdline.txt')} -> ${p('boot/firmware/cmdline.txt')}.revview-backup`,
    `backup ${p('boot/firmware/config.txt')} -> ${p('boot/firmware/config.txt')}.revview-backup`,
    `backup ${p('etc/lightdm/lightdm.conf')} -> ${p('etc/lightdm/lightdm.conf')}.revview-backup`,
  ]);
  for (const l of res.lines) assert.match(l, /^(wrote|backup|warning) /);
  assert.equal(fs.readFileSync(p('boot/firmware/cmdline.txt.revview-backup'), 'utf8'), fix('cmdline.txt'));
  assert.match(fs.readFileSync(p('boot/firmware/cmdline.txt'), 'utf8'), /rotate=90\n$/);
  assert.match(fs.readFileSync(p('boot/firmware/config.txt'), 'utf8'), /disable_splash=1\n$/);
  assert.match(fs.readFileSync(p('etc/lightdm/lightdm.conf'), 'utf8'), /^autologin-user=alice$/m);
  // the rule is the template with the ids of config/buttons.json (1d50 / 615e) filled in
  assert.equal(fs.readFileSync(p('etc/udev/rules.d/70-revview-dongle.rules'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'pi/70-revview-dongle.rules'), 'utf8').replaceAll('@VENDOR@', '1d50').replaceAll('@PRODUCT@', '615e'));
  assert.equal(fs.readFileSync(p('etc/revview/buttons.json'), 'utf8'), fs.readFileSync(path.join(ROOT, 'config/buttons.json'), 'utf8'));
  assert.match(fs.readFileSync(p('etc/udev/rules.d/71-revview-touch.rules'), 'utf8'), /"0 -1 1 1 0 0"/);
  const unit = fs.readFileSync(p('etc/systemd/user/revview.service'), 'utf8');
  assert.match(unit, /^ConditionUser=alice$/m);
  assert.match(unit, /^ExecStart=\/usr\/local\/bin\/node \/opt\/revview\/src\/server\/index\.js /m);
  assert.doesNotMatch(unit, /@[A-Z_]+@/);
  const link = p('etc/systemd/user/default.target.wants/revview.service');
  assert.equal(fs.readlinkSync(link), '/etc/systemd/user/revview.service');
  assert.equal(fs.readFileSync(p('var/lib/systemd/linger/alice'), 'utf8'), '');
  assert.match(fs.readFileSync(p('etc/revview/server.env'), 'utf8'), /#REVVIEW_START=/);
  const auto = p('home/alice/.config/labwc/autostart');
  assert.match(fs.readFileSync(auto, 'utf8'), /^\/opt\/revview\/pi\/kiosk\.sh &$/m);
  assert.ok(fs.statSync(auto).mode & 0o100, 'autostart is executable');
  assert.equal(fs.existsSync(`${auto}.revview-backup`), false);
}));

test('CLI: a second run only prints unchanged and changes nothing', withRoot((r) => {
  cli(r);
  const before = snapshot(r);
  const res = cli(r);
  assert.equal(res.code, 0, res.err);
  for (const l of res.lines) assert.match(l, /^(unchanged|warning) /, l);
  assert.equal(res.lines.filter((l) => l.startsWith('unchanged')).length, 11); // +1: /etc/revview/buttons.json
  assert.deepEqual(snapshot(r), before);
}));

test('CLI: --dry-run writes nothing, not even directories', withRoot((r) => {
  const before = snapshot(r);
  const res = cli(r, ['--dry-run']);
  assert.equal(res.code, 0, res.err);
  assert.ok(res.lines.some((l) => l.startsWith('would write ') && l.endsWith('cmdline.txt')));
  assert.ok(res.lines.some((l) => l.startsWith('would write ') && l.endsWith('revview.service')));
  assert.deepEqual(snapshot(r), before);
}));

test('CLI: server.env is never overwritten; a foreign autostart is backed up once', withRoot((r) => {
  fs.mkdirSync(path.join(r, 'etc/revview'), { recursive: true });
  fs.writeFileSync(path.join(r, 'etc/revview/server.env'), 'REVVIEW_START=/home/alice/x\n');
  const cfg = path.join(r, 'home/alice/.config/labwc');
  fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, 'autostart'), '#!/bin/sh\nmy-panel &\n');
  const res = cli(r);
  assert.equal(res.code, 0, res.err);
  assert.equal(fs.readFileSync(path.join(r, 'etc/revview/server.env'), 'utf8'), 'REVVIEW_START=/home/alice/x\n');
  assert.equal(fs.readFileSync(path.join(cfg, 'autostart.revview-backup'), 'utf8'), '#!/bin/sh\nmy-panel &\n');
  assert.ok(res.lines.some((l) => l.startsWith('backup ') && l.includes('autostart')));
  // changing the rotation rewrites our own autostart without a second backup, and keeps the first backup
  const res2 = cli(r, ['--rotate', '270']);
  assert.ok(!res2.lines.some((l) => l.startsWith('backup') && l.includes('autostart')));
  assert.equal(fs.readFileSync(path.join(cfg, 'autostart.revview-backup'), 'utf8'), '#!/bin/sh\nmy-panel &\n');
  assert.match(fs.readFileSync(path.join(cfg, 'autostart'), 'utf8'), /--transform 270/);
  assert.match(fs.readFileSync(path.join(r, 'boot/firmware/cmdline.txt'), 'utf8'), /rotate=270\n$/);
  assert.equal(fs.readFileSync(path.join(r, 'boot/firmware/cmdline.txt.revview-backup'), 'utf8'), fix('cmdline.txt'));
}));

test('CLI: missing files are skipped with a reason; a two-line cmdline is left alone', withRoot((r) => {
  fs.rmSync(path.join(r, 'boot/firmware/config.txt'));
  fs.rmSync(path.join(r, 'etc/lightdm'), { recursive: true });
  fs.writeFileSync(path.join(r, 'boot/firmware/cmdline.txt'), 'a\nb\n');
  const res = cli(r);
  assert.equal(res.code, 4, res.err); // boot files skipped: the run ends non-zero (qa r6-03)
  assert.ok(res.lines.some((l) => l.startsWith('skipped ') && l.endsWith('config.txt: missing')));
  assert.ok(res.lines.some((l) => l.includes('cmdline.txt: ') && l.startsWith('skipped')));
  assert.ok(res.lines.some((l) => l.endsWith('no lightdm.conf; set Desktop Autologin with raspi-config')));
  assert.equal(fs.readFileSync(path.join(r, 'boot/firmware/cmdline.txt'), 'utf8'), 'a\nb\n');
}));

test('CLI: warns about a missing KMS overlay', withRoot((r) => {
  fs.writeFileSync(path.join(r, 'boot/firmware/config.txt'), '[all]\n');
  const res = cli(r);
  assert.ok(res.lines.some((l) => l.startsWith('warning ') && l.includes('vc4-kms-v3d')));
}));

test('CLI: bad arguments exit 2', withRoot((r) => {
  for (const extra of [['--rotate', '180'], ['--output', 'a b'], ['--bogus'], ['--owner', 'x'], ['--user', 'Bad User']]) {
    const res = cli(r, extra);
    assert.equal(res.code, 2, extra.join(' '));
    assert.match(res.err, /revview setup:/);
  }
  const p = spawnSync(process.execPath, [SETUP, '--root', r], { encoding: 'utf8' });
  assert.equal(p.status, 2);
  const q = spawnSync(process.execPath, [SETUP, '--root', r, '--user', 'a', '--home', 'rel', '--dir', '/d'], { encoding: 'utf8' });
  assert.equal(q.status, 2);
  const w = spawnSync(process.execPath, [SETUP, '--root', r, '--user', 'a', '--home', '/h', '--dir', '/d e'], { encoding: 'utf8' });
  assert.equal(w.status, 2);
}));

// ---- hardening round ----

const UNSAFE_DIRS = ['/a$b', '/a`b', '/a;b', "/a'b", '/a&b', '/a(b', '/a#b', '/a b', '/a"b', '/a|b', '/a*b', '/a\\b', 'rel/dir', '/a\nb', '/a~b', '/a<b', '/a!b'];

test('dir allow-list: autostart, unit and CLI refuse shell metacharacters', withRoot((r) => {
  const tpl = fs.readFileSync(path.join(ROOT, 'pi/revview.service'), 'utf8');
  for (const bad of UNSAFE_DIRS) {
    assert.throws(() => renderAutostart({ dir: bad, output: 'HDMI-A-1', transform: 90 }), /dir/, `autostart ${JSON.stringify(bad)}`);
    assert.throws(() => renderUnit(tpl, { dir: bad, node: '/usr/bin/node', user: 'alice' }), /dir/, `unit ${JSON.stringify(bad)}`);
    assert.throws(() => renderUnit(tpl, { dir: '/opt/revview', node: bad, user: 'alice' }), /node/, `node ${JSON.stringify(bad)}`);
  }
  renderAutostart({ dir: '/opt/revview-1.2_x', output: 'HDMI-A-1', transform: 90 });
  const before = snapshot(r);
  const res = cli(r, ['--dir', '/opt/a$b']);
  assert.equal(res.code, 2);
  assert.match(res.err, /revview setup:/);
  assert.deepEqual(snapshot(r), before);
}));

const CMD_ROOT = 'console=tty1 root=PARTUUID=1-02 rootwait';
test('editCmdline: refuses a line without root=, accepts CRLF and a missing final newline', () => {
  for (const bad of ['', '   \n', '\n\n', '\r\n', 'console=tty1 rootwait\n', 'xroot=/dev/x']) {
    assert.throws(() => editCmdline(bad), /root=/, JSON.stringify(bad));
  }
  const want = `${CMD_ROOT} quiet loglevel=0 logo.nologo vt.global_cursor_default=0 video=HDMI-A-1:400x1280M@60,rotate=90\n`;
  assert.equal(editCmdline(`${CMD_ROOT}\r\n`), want);
  assert.equal(editCmdline(CMD_ROOT), want);
  assert.equal(editCmdline(`${CMD_ROOT}\n\n`), want);
});

test('CLI: a cmdline.txt without root= is left byte-identical, warns, exits 4; the rest is still done', withRoot((r) => {
  const f = path.join(r, 'boot/firmware/cmdline.txt');
  for (const body of ['', '  \n', 'console=tty1 quiet\n']) {
    fs.writeFileSync(f, body);
    const res = cli(r);
    assert.equal(res.code, 4, JSON.stringify(body));
    assert.equal(fs.readFileSync(f, 'utf8'), body);
    assert.equal(fs.existsSync(`${f}.revview-backup`), false);
    assert.ok(res.lines.some((l) => l.startsWith('skipped ') && l.includes('cmdline.txt') && l.includes('root=')), res.out);
    assert.match(res.err, /root=/);
    assert.ok(fs.existsSync(path.join(r, 'etc/systemd/user/revview.service')));
  }
}));

test('editCmdline: drops fbcon=rotate and our earlier video= with another output, keeps unrelated video=', () => {
  const first = editCmdline(`${CMD_ROOT} fbcon=rotate:1 video=HDMI-A-1:400x1280M@60,rotate=90`, { output: 'HDMI-A-1' });
  assert.doesNotMatch(first, /fbcon/);
  const moved = editCmdline(first, { output: 'HDMI-A-2', rotate: 270 });
  assert.equal(moved.match(/video=/g).length, 1);
  assert.match(moved, /video=HDMI-A-2:400x1280M@60,rotate=270\n$/);
  const keep = editCmdline(`${CMD_ROOT} video=DSI-1:800x480 fbcon=rotate:3 fbcon=map:10`);
  assert.match(keep, /video=DSI-1:800x480/);
  assert.match(keep, /fbcon=map:10/);
  assert.doesNotMatch(keep, /fbcon=rotate/);
});

test('editLightdm: every [Seat:*] section is edited', () => {
  const out = editLightdm('[Seat:*]\nautologin-user=x\n[Other]\na=b\n[Seat:*]\n#autologin-user=\nfoo=1\n', 'alice');
  assert.equal(out, '[Seat:*]\nautologin-user=alice\n[Other]\na=b\n[Seat:*]\nautologin-user=alice\nfoo=1\n');
  assert.equal(editLightdm(out, 'alice'), out);
  assert.equal(editLightdm('[Seat:*]\na=1\n[Seat:*]\nb=2\n', 'alice'), '[Seat:*]\nautologin-user=alice\na=1\n[Seat:*]\nautologin-user=alice\nb=2\n');
});

test('CLI: writes are atomic (no temp file left, mode of an existing file kept)', withRoot((r) => {
  const f = path.join(r, 'boot/firmware/cmdline.txt');
  fs.chmodSync(f, 0o600);
  const res = cli(r);
  assert.equal(res.code, 0, res.err);
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(snapshot(r)).filter((p) => /revview-tmp/.test(p)), []);
}));

test('CLI: refuses to write through a symlink, nothing is written through it', withRoot((r) => {
  const outside = path.join(r, 'outside');
  fs.writeFileSync(outside, 'keep\n');
  for (const rel of ['boot/firmware/cmdline.txt', 'boot/firmware/config.txt', 'etc/lightdm/lightdm.conf']) {
    const p = path.join(r, rel);
    const body = fs.readFileSync(p, 'utf8');
    fs.rmSync(p);
    fs.symlinkSync(outside, p);
    const res = cli(r);
    assert.equal(res.code, 4, rel);
    assert.ok(res.lines.some((l) => l.startsWith('skipped ') && l.includes(rel) && /symlink/.test(l)), res.out);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'keep\n', rel);
    assert.ok(fs.lstatSync(p).isSymbolicLink());
    fs.rmSync(p);
    fs.writeFileSync(p, body);
  }
}));

test('CLI: a symlinked ~/.config/labwc/autostart and a symlinked udev rule are refused', withRoot((r) => {
  const outside = path.join(r, 'outside');
  fs.writeFileSync(outside, 'keep\n');
  const cfg = path.join(r, 'home/alice/.config/labwc');
  fs.mkdirSync(cfg, { recursive: true });
  fs.symlinkSync(outside, path.join(cfg, 'autostart'));
  fs.mkdirSync(path.join(r, 'etc/udev/rules.d'), { recursive: true });
  fs.symlinkSync(outside, path.join(r, 'etc/udev/rules.d/71-revview-touch.rules'));
  const res = cli(r);
  assert.equal(res.code, 4);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep\n');
  assert.ok(fs.lstatSync(path.join(cfg, 'autostart')).isSymbolicLink());
  assert.equal(res.lines.filter((l) => l.startsWith('skipped ') && /symlink/.test(l)).length, 2, res.out);
  fs.rmSync(path.join(cfg, 'autostart'));
  fs.symlinkSync(path.join(r, 'nowhere'), path.join(cfg, 'autostart'));
  assert.equal(cli(r).code, 4);
  assert.equal(fs.existsSync(path.join(r, 'nowhere')), false);
}));

const symlinkedDir = (r, rel, elsewhere) => {
  fs.mkdirSync(path.dirname(path.join(r, rel)), { recursive: true });
  fs.mkdirSync(elsewhere, { recursive: true });
  fs.symlinkSync(elsewhere, path.join(r, rel));
};

test('CLI: a symlinked ~/.config/labwc is refused, nothing is written at the link target', withRoot((r) => {
  const elsewhere = path.join(r, 'elsewhere');
  symlinkedDir(r, 'home/alice/.config/labwc', elsewhere);
  const res = cli(r);
  assert.equal(res.code, 4, res.out + res.err);
  assert.ok(res.lines.some((l) => l.startsWith('skipped ') && l.includes('autostart') && /labwc is a symlink/.test(l)), res.out);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
  assert.ok(fs.existsSync(path.join(r, 'etc/udev/rules.d/71-revview-touch.rules')), 'the rest is still written');
}));

test('CLI: a symlinked ~/.config, and a symlinked home, are refused', withRoot((r) => {
  const elsewhere = path.join(r, 'elsewhere');
  symlinkedDir(r, 'home/alice/.config', elsewhere);
  let res = cli(r);
  assert.equal(res.code, 4, res.out + res.err);
  assert.match(res.out, /skipped .*autostart: .*\.config is a symlink/);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
  fs.rmSync(path.join(r, 'home'), { recursive: true });
  symlinkedDir(r, 'home/alice', elsewhere);
  res = cli(r);
  assert.equal(res.code, 4, res.out + res.err);
  assert.match(res.out, /skipped .*autostart: .*home\/alice is a symlink/);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
}));

test('CLI: a symlinked directory under the root is refused for system files (udev rules, boot)', withRoot((r) => {
  const elsewhere = path.join(r, 'elsewhere');
  symlinkedDir(r, 'etc/udev/rules.d', elsewhere);
  let res = cli(r);
  assert.equal(res.code, 4, res.out + res.err);
  assert.equal(res.lines.filter((l) => l.startsWith('skipped ') && /rules\.d is a symlink/.test(l)).length, 2, res.out);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
  fs.rmSync(path.join(r, 'etc/udev/rules.d'));
  const boot = path.join(r, 'bootreal');
  fs.renameSync(path.join(r, 'boot/firmware'), boot);
  fs.symlinkSync(boot, path.join(r, 'boot/firmware'));
  const before = fs.readFileSync(path.join(boot, 'cmdline.txt'), 'utf8');
  res = cli(r);
  assert.equal(res.code, 4, res.out + res.err);
  assert.match(res.out, /skipped .*cmdline\.txt: .*firmware is a symlink/);
  assert.equal(fs.readFileSync(path.join(boot, 'cmdline.txt'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(boot).filter((f) => /tmp/.test(f)), []);
}));

test('CLI: a symlinked parent of the enable symlink is refused', withRoot((r) => {
  const elsewhere = path.join(r, 'elsewhere');
  symlinkedDir(r, 'etc/systemd/user/default.target.wants', elsewhere);
  const res = cli(r);
  assert.equal(res.code, 4, res.out + res.err);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
}));

test('CLI: a missing cmdline.txt or config.txt, and a two-line cmdline.txt, end with exit 4', withRoot((r) => {
  const cmd = path.join(r, 'boot/firmware/cmdline.txt');
  fs.writeFileSync(cmd, 'a root=x\nb\n');
  let res = cli(r);
  assert.equal(res.code, 4, res.out + res.err);
  assert.equal(fs.readFileSync(cmd, 'utf8'), 'a root=x\nb\n');
  fs.rmSync(cmd);
  res = cli(r);
  assert.equal(res.code, 4);
  assert.match(res.out, /skipped .*cmdline\.txt: missing/);
  fs.rmSync(path.join(r, 'boot/firmware/config.txt'));
  assert.equal(cli(r).code, 4);
}));

test('CLI: a missing lightdm.conf alone stays a note, exit 0', withRoot((r) => {
  fs.rmSync(path.join(r, 'etc/lightdm'), { recursive: true });
  assert.equal(cli(r).code, 0);
}));

test('CLI: an unexpected error exits 3 with a one-line message and no stack', withRoot((r) => {
  fs.mkdirSync(path.join(r, 'home/alice/.config/labwc/autostart'), { recursive: true }); // a directory where the file goes
  const res = cli(r);
  assert.equal(res.code, 3, res.out + res.err);
  assert.match(res.err, /^setup\.mjs: failed part way: /m);
  assert.match(res.err, /files after this point were not written; fix the cause and run it again/);
  assert.doesNotMatch(res.err, /\n\s+at /);
}));

test('CLI: a fake passwd uid that is not ours does not crash a run as an ordinary user', withRoot((r) => {
  if (process.getuid() === 0) return;
  const res = cli(r, ['--owner', `${process.getuid() + 1}:${process.getgid() + 1}`]);
  assert.equal(res.code, 0, res.out + res.err);
  assert.ok(fs.existsSync(path.join(r, 'home/alice/.config/labwc/autostart')));
}));

test('CLI: a refusal exits 4 and bad arguments exit 2', withRoot((r) => {
  fs.writeFileSync(path.join(r, 'boot/firmware/cmdline.txt'), '');
  assert.equal(cli(r).code, 4);
  assert.equal(spawnSync(process.execPath, [SETUP], { encoding: 'utf8' }).status, 2);
}));

test('files.mjs: a root below a symlinked directory is fine for files directly in it and for a child named ..x', withRoot((r) => {
  const real = path.join(r, 'real');
  fs.mkdirSync(path.join(real, 'root'), { recursive: true });
  fs.symlinkSync(real, path.join(r, 'lnk'));
  const root = path.join(r, 'lnk', 'root'); // the root itself is reached through a symlink: not our business
  const w = createWriter({ root, say: () => {} });
  w.write(path.join(root, 'a.txt'), 'x\n');
  w.write(path.join(root, '..x', 'b.txt'), 'y\n');
  assert.equal(w.failed(), false);
  assert.equal(fs.readFileSync(path.join(real, 'root/a.txt'), 'utf8'), 'x\n');
  assert.equal(fs.readFileSync(path.join(real, 'root/..x/b.txt'), 'utf8'), 'y\n');
}));

test('files.mjs: a symlink below the root is still refused, also in a child named ..x', withRoot((r) => {
  const w = createWriter({ root: r, say: () => {} });
  fs.mkdirSync(path.join(r, 'elsewhere'));
  fs.mkdirSync(path.join(r, '..x'));
  fs.symlinkSync(path.join(r, 'elsewhere'), path.join(r, '..x', 'l'));
  const err = process.stderr.write;
  process.stderr.write = () => true;
  try { w.write(path.join(r, '..x', 'l', 'f'), 'z'); } finally { process.stderr.write = err; }
  assert.equal(w.failed(), true);
  assert.deepEqual(fs.readdirSync(path.join(r, 'elsewhere')), []);
}));
