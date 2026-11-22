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
  assert.match(res.out, /would add alice to groups input,audio/);
  assert.match(res.out, /journalctl --user -u revview/);
  const settings = fs.readFileSync(p('home/alice/.claude/settings.json'), 'utf8');
  assert.match(settings, /# revview-hook/);
  const unit = fs.readFileSync(p('etc/systemd/user/revview.service'), 'utf8');
  assert.ok(unit.includes(`${ROOT.replace(/\/$/, '')}/src/server/index.js`));
  assert.match(unit, /--boot/);
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
