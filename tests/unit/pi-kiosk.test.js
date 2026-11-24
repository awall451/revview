import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const KIOSK = path.join(ROOT, 'pi/kiosk.sh');

function setup() {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'revview-kiosk-'));
  const dirs = { t, home: path.join(t, 'home'), run: path.join(t, 'run'), cfg: path.join(t, 'cfg') };
  for (const d of [dirs.home, dirs.run, dirs.cfg]) fs.mkdirSync(d);
  dirs.argv = path.join(t, 'argv.log');
  dirs.browser = path.join(t, 'fake-browser');
  fs.writeFileSync(dirs.browser, '#!/bin/sh\necho "$@" >> "$0.argv"\nexit 0\n', { mode: 0o755 });
  dirs.marker = path.join(t, 'boot-marker');
  return dirs;
}
function kiosk(d, env = {}, runs = 2) {
  const p = spawnSync('/bin/bash', [KIOSK], {
    encoding: 'utf8',
    timeout: 20000,
    env: {
      PATH: process.env.PATH, HOME: d.home, XDG_RUNTIME_DIR: d.run, XDG_CONFIG_HOME: d.cfg,
      REVVIEW_KIOSK_BROWSER: d.browser, REVVIEW_KIOSK_RUNS: String(runs), REVVIEW_KIOSK_BOOT_MARKER: d.marker, ...env,
    },
  });
  const log = fs.existsSync(`${d.browser}.argv`) ? fs.readFileSync(`${d.browser}.argv`, 'utf8').split('\n').filter(Boolean) : [];
  return { code: p.status, err: p.stderr, launches: log };
}
const withDirs = (fn) => () => {
  const d = setup();
  try { fn(d); } finally { fs.rmSync(d.t, { recursive: true, force: true }); }
};

test('kiosk: launches the browser twice with the boot url and the flags', withDirs((d) => {
  const r = kiosk(d);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.launches.length, 2);
  const line = r.launches[0];
  assert.ok(line.endsWith(`file://${ROOT.replace(/\/$/, '')}/src/view/boot.html?port=8138`), line);
  for (const f of ['--kiosk', '--ozone-platform=wayland', '--noerrdialogs', '--disable-infobars', '--no-first-run',
    '--no-default-browser-check', '--hide-crash-restore-bubble', '--password-store=basic',
    '--disable-features=Translate', '--check-for-update-interval=31536000', '--disable-pinch', '--overscroll-history-navigation=0']) {
    assert.ok(line.split(' ').includes(f), `${f} in ${line}`);
  }
  assert.ok(!line.includes('--disable-session-crashed-bubble'), line); // not in Chromium 156 (removed upstream)
  assert.ok(line.includes(`--user-data-dir=${d.run}/revview-kiosk`), line);
  assert.match(r.err, /revview-kiosk: /);
}));

test('kiosk: REVVIEW_PORT changes the url', withDirs((d) => {
  const r = kiosk(d, { REVVIEW_PORT: '9001' }, 1);
  assert.equal(r.launches.length, 1);
  assert.ok(r.launches[0].endsWith('/src/view/boot.html?port=9001'));
}));

test('kiosk: either pause marker stops the launches and logs paused once', withDirs((d) => {
  fs.mkdirSync(path.join(d.cfg, 'revview'));
  fs.writeFileSync(path.join(d.cfg, 'revview/kiosk-paused'), '');
  let r = kiosk(d, {}, 3);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.launches, []);
  assert.equal(r.err.match(/paused/g).length, 1);
  fs.rmSync(path.join(d.cfg, 'revview/kiosk-paused'));
  fs.writeFileSync(d.marker, '');
  r = kiosk(d, {}, 3);
  assert.deepEqual(r.launches, []);
  assert.equal(r.err.match(/paused/g).length, 1);
  fs.rmSync(d.marker);
  r = kiosk(d, {}, 1);
  assert.equal(r.launches.length, 1);
}));

test('kiosk: a crashed profile is marked clean before the launch', withDirs((d) => {
  const prefs = path.join(d.run, 'revview-kiosk/Default/Preferences');
  fs.mkdirSync(path.dirname(prefs), { recursive: true });
  fs.writeFileSync(prefs, '{"profile":{"exit_type":"Crashed","exited_cleanly":false,"x":1}}');
  // the fake browser checks Preferences at launch time
  fs.writeFileSync(d.browser, `#!/bin/sh\ncp "${prefs}" "${d.t}/seen.json"\nexit 0\n`, { mode: 0o755 });
  const r = kiosk(d, {}, 1);
  assert.equal(r.code, 0, r.err);
  const seen = fs.readFileSync(path.join(d.t, 'seen.json'), 'utf8');
  assert.equal(seen, '{"profile":{"exit_type":"Normal","exited_cleanly":true,"x":1}}');
}));

test('kiosk: no browser on PATH is logged and retried', withDirs((d) => {
  const empty = path.join(d.t, 'bin');
  fs.mkdirSync(empty);
  for (const tool of ['sed', 'sleep', 'dirname']) {
    const found = spawnSync('which', [tool], { encoding: 'utf8' }).stdout.trim();
    fs.symlinkSync(found, path.join(empty, tool));
  }
  const r = kiosk(d, { PATH: empty, REVVIEW_KIOSK_BROWSER: '' }, 2);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.launches.length, 0);
  assert.equal(r.err.match(/no chromium/g).length, 2);
}));
