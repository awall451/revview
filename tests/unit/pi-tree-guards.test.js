// The guards of pi/tree/build.sh (pi/tree/guards.sh), run on crafted input in a temp directory: no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GUARDS = fileURLToPath(new URL('../../pi/tree/guards.sh', import.meta.url));
const run = (script, input = '') =>
  spawnSync('bash', ['-c', `fail() { echo "build.sh: $*" >&2; exit 1; }; . "$1"; ${script}`, 'x', GUARDS], { input, encoding: 'utf8' });
const tmpdir = (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'guards-'));
  t.after(() => { spawnSync('chmod', ['-R', 'u+rwx', d]); fs.rmSync(d, { recursive: true, force: true }); });
  return d;
};
const CONTROL = 'Package: t\nVersion: 1\nArchitecture: all\nMaintainer: x <x@x>\nDescription: t\n';

test('member names: relative names pass; absolute and .. names fail', () => {
  assert.equal(run('check_member_names t', './usr/bin/x\n./etc/a..b\n./usr/lib/..hidden\nusr/share/y\n').status, 0);
  for (const bad of ['/etc/passwd', './a/../../etc/x', '../x', './a/..']) {
    const r = run('check_member_names t', `./ok\n${bad}\n`);
    assert.equal(r.status, 1, bad);
    assert.match(r.stderr, /absolute or has a \.\. component/);
  }
});

test('deb listing: a normal package passes, one with a ../ member is refused', (t) => {
  const d = tmpdir(t);
  const pk = path.join(d, 'good');
  fs.mkdirSync(path.join(pk, 'DEBIAN'), { recursive: true });
  fs.writeFileSync(path.join(pk, 'DEBIAN/control'), CONTROL);
  fs.mkdirSync(path.join(pk, 'usr'));
  fs.writeFileSync(path.join(pk, 'usr/f'), 'x');
  fs.symlinkSync('f', path.join(pk, 'usr/link'));
  const good = path.join(d, 'good.deb');
  assert.equal(spawnSync('dpkg-deb', ['--root-owner-group', '-b', pk, good]).status, 0);
  assert.equal(run(`check_deb_names "${good}"`).status, 0);

  // a deb built by hand with ar whose data.tar holds ../escape
  const w = path.join(d, 'evil');
  fs.mkdirSync(path.join(w, 'in'), { recursive: true });
  fs.mkdirSync(path.join(w, 'c'));
  fs.writeFileSync(path.join(w, 'in/f'), 'x');
  fs.writeFileSync(path.join(w, 'c/control'), CONTROL);
  fs.writeFileSync(path.join(w, 'debian-binary'), '2.0\n');
  assert.equal(spawnSync('tar', ['-C', path.join(w, 'in'), '--transform', 's,^f$,../escape,', '-cf', path.join(w, 'data.tar'), 'f']).status, 0);
  assert.equal(spawnSync('tar', ['-C', path.join(w, 'c'), '-cf', path.join(w, 'control.tar'), 'control']).status, 0);
  assert.equal(spawnSync('ar', ['rc', 'evil.deb', 'debian-binary', 'control.tar', 'data.tar'], { cwd: w }).status, 0);
  const r = run(`check_deb_names "${path.join(w, 'evil.deb')}"`);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /absolute or has a \.\. component/);
});

test('merge_links: new links are copied, existing paths are listed, a tar failure is fatal', (t) => {
  const d = tmpdir(t);
  const pkg = path.join(d, 'pkg');
  const root = path.join(d, 'root');
  fs.mkdirSync(path.join(pkg, 'usr'), { recursive: true });
  fs.mkdirSync(path.join(root, 'usr'), { recursive: true });
  fs.symlinkSync('/etc/a', path.join(pkg, 'usr/new'));
  fs.symlinkSync('/etc/b', path.join(pkg, 'usr/old'));
  fs.writeFileSync(path.join(root, 'usr/old'), 'real file');
  const conf = path.join(d, 'conflicts');
  fs.writeFileSync(conf, '');
  const r = run(`merge_links "${pkg}" "${root}" "${conf}"`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readlinkSync(path.join(root, 'usr/new')), '/etc/a');
  assert.equal(fs.readFileSync(path.join(root, 'usr/old'), 'utf8'), 'real file');
  assert.equal(fs.readFileSync(conf, 'utf8'), './usr/old\n');
  if (process.getuid && process.getuid() === 0) return; // root ignores directory modes
  const root2 = path.join(d, 'root2');
  fs.mkdirSync(path.join(root2, 'usr'), { recursive: true });
  fs.chmodSync(path.join(root2, 'usr'), 0o500);
  const r2 = run(`merge_links "${pkg}" "${root2}" "${conf}"`);
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /copying the symlinks .* failed/);
});
