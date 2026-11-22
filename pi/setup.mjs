#!/usr/bin/env node
// Edits and writes the Pi's boot, display, login and service files. UNTESTED on a Pi: written without one and
// tested only against a fake root in a temp dir (tests/unit/pi-setup.test.js). Called by pi/install.sh.
// The edit/render functions are pure (text in, text out). The CLI writes files at <root><path as seen on the Pi>.
// Usage: node pi/setup.mjs --root R --user U --home H --dir D [--rotate 90|270] [--output HDMI-A-1]
//                          [--node /usr/bin/node] [--owner UID:GID] [--dry-run]
// One line per file: wrote | unchanged | backup A -> B | skipped P: why | would write (--dry-run, nothing written).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const OUTPUT_RE = /^[A-Za-z0-9-]+$/;
const BLOCK_HEAD = '# revview: quiet boot (pi/install.sh)';
const AUTOSTART_MARK = 'written by pi/install.sh';

function checkRotate(rotate) {
  if (rotate !== 90 && rotate !== 270) throw new Error(`rotate must be 90 or 270, got ${rotate}`);
}
function checkOutput(output) {
  if (typeof output !== 'string' || !OUTPUT_RE.test(output)) throw new Error(`bad output name ${JSON.stringify(output)}`);
}
function checkUser(user) {
  if (typeof user !== 'string' || !USER_RE.test(user)) throw new Error(`bad user name ${JSON.stringify(user)}`);
}

export function editCmdline(text, { output = 'HDMI-A-1', rotate = 90 } = {}) {
  checkRotate(rotate);
  checkOutput(output);
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length > 1) throw new Error('cmdline.txt must be one line, found several');
  const drop = (t) => t === 'splash' || t === 'quiet' || t === 'logo.nologo' || t.startsWith('loglevel=')
    || t.startsWith('vt.global_cursor_default=') || t.startsWith(`video=${output}:`);
  const tokens = (lines[0] ?? '').split(/\s+/).filter((t) => t && !drop(t));
  tokens.push('quiet', 'loglevel=0', 'logo.nologo', 'vt.global_cursor_default=0', `video=${output}:400x1280M@60,rotate=${rotate}`);
  return `${tokens.join(' ')}\n`;
}

export function editConfigTxt(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => !/^\s*disable_splash\s*=/.test(l));
  const head = lines.indexOf(BLOCK_HEAD);
  if (head >= 0) lines.splice(head, lines[head + 1]?.trim() === '[all]' ? 2 : 1);
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  const warnings = [];
  if (!lines.some((l) => /^\s*dtoverlay\s*=\s*vc4-f?kms-v3d\b/.test(l))) {
    warnings.push('no active dtoverlay=vc4-kms-v3d line in config.txt: the video= mode on the kernel command line needs KMS');
  }
  const out = [...lines, ...(lines.length ? [''] : []), BLOCK_HEAD, '[all]', 'disable_splash=1'];
  return { text: `${out.join('\n')}\n`, warnings };
}

export function editLightdm(text, user) {
  checkUser(user);
  const lines = String(text).split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  const want = `autologin-user=${user}`;
  const start = lines.findIndex((l) => l.trim() === '[Seat:*]');
  if (start < 0) {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push('[Seat:*]', want);
    return `${lines.join('\n')}\n`;
  }
  let end = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l));
  if (end < 0) end = lines.length;
  const idx = (re) => lines.findIndex((l, i) => i > start && i < end && re.test(l));
  const active = idx(/^\s*autologin-user\s*=/);
  const at = active >= 0 ? active : idx(/^\s*#\s*autologin-user\s*=/);
  if (at >= 0) lines[at] = want;
  else lines.splice(start + 1, 0, want);
  return `${lines.join('\n')}\n`;
}

export function renderAutostart({ dir, output, transform }) {
  checkOutput(output);
  if (transform !== 90 && transform !== 270) throw new Error(`transform must be 90 or 270, got ${transform}`);
  if (typeof dir !== 'string' || /[\s'"\\$`;&|<>()*?!#~\u0000-\u001f]/.test(dir)) throw new Error(`dir has a character that is not safe in a shell line: ${JSON.stringify(dir)}`);
  return `#!/bin/sh
# labwc autostart, ${AUTOSTART_MARK}. Run by labwc with sh at session start.
# This file REPLACES the system /etc/xdg/labwc/autostart: no desktop, no panel, no icons, just the kiosk.
# Rotation is one of three things that must agree (docs/DESIGN.md): the console one is on the kernel command
# line, the touch one is /etc/udev/rules.d/71-revview-touch.rules. Not backgrounded: the kiosk starts on the
# rotated output.
wlr-randr --output ${output} --transform ${transform}
${dir}/pi/kiosk.sh &
`;
}

export function renderTouchRule(rotate) {
  checkRotate(rotate);
  const matrix = rotate === 90 ? '0 -1 1 1 0 0' : '0 1 0 -1 0 1';
  return `# Touch rotation for the 7.9" panel (USB 0712:000a), written by pi/install.sh. UNTESTED on a Pi.
# labwc rotates the picture (wlr-randr) but not this panel's touch. Rotation ${rotate}: matrix ${matrix}
# (90 = normal mount, 270 = mount flipped 180 degrees; docs/DESIGN.md "Known Pi settings").
ATTRS{idVendor}=="0712", ATTRS{idProduct}=="000a", ENV{LIBINPUT_CALIBRATION_MATRIX}="${matrix}"
`;
}

export function renderUnit(template, { dir, node, user }) {
  for (const [k, v] of [['dir', dir], ['node', node]]) {
    if (typeof v !== 'string' || v === '' || /[\s@|%"\\\u0000-\u001f\u007f]/.test(v)) throw new Error(`${k} has a character that is not allowed in the unit: ${JSON.stringify(v)}`);
  }
  checkUser(user);
  return String(template).replaceAll('@REVVIEW_DIR@', dir).replaceAll('@NODE@', node).replaceAll('@USER@', user);
}

export function renderServerEnv() {
  return `# Environment of the revview server (read by the user unit, one KEY=value per line, no quotes).
# Written by pi/install.sh when missing; never overwritten. Restart: systemctl --user restart revview

# Projects file for the menu (see config/projects.example.json).
#REVVIEW_PROJECTS=/path/to/projects.json

# A directory where the key-on Claude session starts. Empty or unset: none, the driver starts one from the menu.
#REVVIEW_START=

# host:port the network monitor connects to.
#REVVIEW_NETMON_HOST=api.anthropic.com:443
`;
}

// ---- CLI ----

function usage(msg) {
  process.stderr.write(`revview setup: ${msg}\nusage: node pi/setup.mjs --root R --user U --home H --dir D [--rotate 90|270] [--output HDMI-A-1] [--node PATH] [--owner UID:GID] [--dry-run]\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const o = { rotate: 90, output: 'HDMI-A-1', node: '/usr/bin/node', dry: false };
  const need = { '--root': 'root', '--user': 'user', '--home': 'home', '--dir': 'dir', '--rotate': 'rotate', '--output': 'output', '--node': 'node', '--owner': 'owner' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dry = true;
    else if (need[a]) {
      if (i + 1 >= argv.length) usage(`${a} needs a value`);
      o[need[a]] = argv[++i];
    } else usage(`unknown argument ${a}`);
  }
  for (const k of ['root', 'user', 'home', 'dir']) if (!o[k]) usage(`--${k} is required`);
  o.rotate = Number(o.rotate);
  if (o.owner !== undefined) {
    const m = /^(\d+):(\d+)$/.exec(o.owner);
    if (!m) usage('--owner must be UID:GID');
    o.owner = { uid: Number(m[1]), gid: Number(m[2]) };
  }
  for (const k of ['home', 'dir', 'node']) if (!path.isAbsolute(o[k])) usage(`--${k} must be an absolute path`);
  try {
    checkRotate(o.rotate);
    checkOutput(o.output);
    renderUnit('', { dir: o.dir, node: o.node, user: o.user });
    renderAutostart({ dir: o.dir, output: o.output, transform: o.rotate });
  } catch (e) {
    usage(e.message);
  }
  return o;
}

function main(argv) {
  const o = parseArgs(argv);
  const R = (p) => path.join(o.root, p);
  const homeAbs = R(o.home);
  const readOr = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
  const say = (s) => console.log(s);

  const chownIf = (p, owned) => {
    if (owned && o.owner) fs.chownSync(p, o.owner.uid, o.owner.gid);
  };
  const mkdirp = (d, owned) => {
    const todo = [];
    for (let p = d; !fs.existsSync(p); p = path.dirname(p)) todo.unshift(p);
    for (const p of todo) {
      fs.mkdirSync(p);
      chownIf(p, owned && (p === homeAbs || p.startsWith(`${homeAbs}${path.sep}`)));
    }
  };

  // write(p, content, { owned, backup: 'first' | 'foreign', createOnly, mode })
  const write = (p, content, opts = {}) => {
    const old = readOr(p);
    if (old !== null && opts.createOnly) return say(`unchanged ${p}`); // exists: never overwritten
    if (old === content) return say(`unchanged ${p}`);
    if (o.dry) return say(`would write ${p}`);
    mkdirp(path.dirname(p), opts.owned);
    const bak = `${p}.revview-backup`;
    const wantBackup = old !== null && !fs.existsSync(bak)
      && (opts.backup === 'first' || (opts.backup === 'foreign' && !old.includes(AUTOSTART_MARK)));
    if (wantBackup) {
      fs.copyFileSync(p, bak);
      chownIf(bak, opts.owned);
      say(`backup ${p} -> ${bak}`);
    }
    fs.writeFileSync(p, content, { mode: opts.mode ?? 0o644 });
    chownIf(p, opts.owned);
    say(`wrote ${p}`);
  };

  const piDir = path.dirname(fileURLToPath(import.meta.url));
  const edit = (rel, fn) => {
    const p = R(rel);
    const old = readOr(p);
    if (old === null) return say(`skipped ${p}: missing`);
    let res;
    try {
      res = fn(old);
    } catch (e) {
      return say(`skipped ${p}: ${e.message}`);
    }
    for (const w of res.warnings ?? []) say(`warning ${p}: ${w}`);
    write(p, typeof res === 'string' ? res : res.text, { backup: 'first' });
  };

  edit('/boot/firmware/cmdline.txt', (t) => editCmdline(t, { output: o.output, rotate: o.rotate }));
  edit('/boot/firmware/config.txt', editConfigTxt);
  const lightdm = R('/etc/lightdm/lightdm.conf');
  if (fs.existsSync(lightdm)) edit('/etc/lightdm/lightdm.conf', (t) => editLightdm(t, o.user));
  else say(`skipped ${lightdm}: no lightdm.conf; set Desktop Autologin with raspi-config`);

  write(R('/etc/udev/rules.d/70-revview-dongle.rules'), fs.readFileSync(path.join(piDir, '70-revview-dongle.rules'), 'utf8'));
  write(R('/etc/udev/rules.d/71-revview-touch.rules'), renderTouchRule(o.rotate));
  write(R('/etc/systemd/user/revview.service'), renderUnit(fs.readFileSync(path.join(piDir, 'revview.service'), 'utf8'), o));

  const link = R('/etc/systemd/user/default.target.wants/revview.service');
  const target = '/etc/systemd/user/revview.service';
  let cur = null;
  try {
    cur = fs.readlinkSync(link);
  } catch { /* missing or not a link */ }
  if (cur === target) say(`unchanged ${link}`);
  else if (o.dry) say(`would write ${link}`);
  else {
    mkdirp(path.dirname(link), false);
    fs.rmSync(link, { force: true });
    fs.symlinkSync(target, link);
    say(`wrote ${link}`);
  }

  write(R(`/var/lib/systemd/linger/${o.user}`), '');
  write(R('/etc/revview/server.env'), renderServerEnv(), { createOnly: true });
  write(path.join(homeAbs, '.config/labwc/autostart'), renderAutostart({ dir: o.dir, output: o.output, transform: o.rotate }),
    { owned: true, backup: 'foreign', mode: 0o755 });
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
