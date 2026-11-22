import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
  const old = editCmdline('a loglevel=7 b vt.global_cursor_default=1 video=HDMI-A-1:1920x1080 video=HDMI-A-2:640x480 c logo.nologo\n');
  assert.equal(old, 'a b video=HDMI-A-2:640x480 c quiet loglevel=0 logo.nologo vt.global_cursor_default=0 video=HDMI-A-1:400x1280M@60,rotate=90\n');
  assert.match(editCmdline('x', { output: 'DSI-1' }), /video=DSI-1:400x1280M@60,rotate=90\n$/);
});

test('editCmdline: bad input throws', () => {
  assert.throws(() => editCmdline('a b\nc d\n'), /one line/);
  assert.throws(() => editCmdline('a', { rotate: 180 }));
  assert.throws(() => editCmdline('a', { rotate: '90' }));
  assert.throws(() => editCmdline('a', { output: 'HDMI A' }));
  assert.throws(() => editCmdline('a', { output: '' }));
  assert.equal(editCmdline('a b\n\n'), editCmdline('a b'));
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
  assert.equal(fs.readFileSync(p('etc/udev/rules.d/70-revview-dongle.rules'), 'utf8'), fs.readFileSync(path.join(ROOT, 'pi/70-revview-dongle.rules'), 'utf8'));
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
  assert.equal(res.lines.filter((l) => l.startsWith('unchanged')).length, 10);
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
  assert.equal(res.code, 0, res.err);
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
