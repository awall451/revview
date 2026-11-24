#!/usr/bin/env node
// Edits and writes the Pi's boot, display, login and service files. UNTESTED on a Pi: written without one and
// tested only against a fake root in a temp dir (tests/unit/pi-setup.test.js). Called by pi/install.sh.
// The edit/render functions are pure (text in, text out). The CLI writes files at <root><path as seen on the Pi>.
// Usage: node pi/setup.mjs --root R --user U --home H --dir D [--rotate 90|270] [--output HDMI-A-1]
//                          [--node /usr/bin/node] [--owner UID:GID] [--dry-run]
//                          [--adopt-buttons-base]
// Exit: 0 done; 4 a file was refused or skipped so that the appliance is half set up (a symlink anywhere in its path,
//   cmdline.txt or config.txt missing or malformed, no root=): left as it was, everything else done; 2 bad arguments;
//   3 an unexpected error inside main (the files after that point were not written). Refusal is 4, not 1, because
//   node itself exits 1 for an error outside main (an import failure, a syntax error): install.sh must tell them apart.
// One line per file: wrote | unchanged | backup A -> B | skipped P: why | would write (--dry-run, nothing written).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriter } from './files.mjs';

const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const OUTPUT_RE = /^[A-Za-z0-9-]+$/;
// Paths that end up in a shell line (autostart) and in a systemd unit: letters, digits, . _ - and /. Nothing else.
const DIR_RE = /^\/[A-Za-z0-9._/-]+$/;
const BLOCK_HEAD = '# revview: quiet boot (pi/install.sh)';
const AUTOSTART_MARK = 'written by pi/install.sh';

function checkRotate(rotate) {
  if (rotate !== 90 && rotate !== 270) throw new Error(`rotate must be 90 or 270, got ${rotate}`);
}
function checkOutput(output) {
  if (typeof output !== 'string' || !OUTPUT_RE.test(output)) throw new Error(`bad output name ${JSON.stringify(output)}`);
}
function checkPath(what, v) {
  if (typeof v !== 'string' || !DIR_RE.test(v)) throw new Error(`${what} must match ^/[A-Za-z0-9._/-]+$ (absolute; letters, digits, . _ - and / only): ${JSON.stringify(v)}`);
}
function checkUser(user) {
  if (typeof user !== 'string' || !USER_RE.test(user)) throw new Error(`bad user name ${JSON.stringify(user)}`);
}

// Quiet boot tokens and the rotated console mode on the ONE line of cmdline.txt. Refuses (throws NoRootError) when
// no token starts with root=: an empty or truncated file must never become a line that cannot boot.
// Dropped before ours are added: our own earlier tokens, fbcon=rotate:N (it would fight video=...,rotate=), and any
// earlier video=<connector>:... token that carries rotate= (what this installer wrote, also for another --output
// in an earlier run). A video= token without rotate= (a user's own mode for some connector) is kept.
export class NoRootError extends Error {}

export function editCmdline(text, { output = 'HDMI-A-1', rotate = 90 } = {}) {
  checkRotate(rotate);
  checkOutput(output);
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length > 1) throw new Error('cmdline.txt must be one line, found several');
  const drop = (t) => t === 'splash' || t === 'quiet' || t === 'logo.nologo' || t.startsWith('loglevel=')
    || t.startsWith('vt.global_cursor_default=') || t.startsWith('fbcon=rotate:')
    || t.startsWith(`video=${output}:`) || (t.startsWith('video=') && /[:,]rotate=/.test(t));
  const all = (lines[0] ?? '').split(/\s+/).filter(Boolean);
  if (!all.some((t) => t.startsWith('root='))) throw new NoRootError('no root= token in cmdline.txt (empty or damaged?); left untouched');
  const tokens = all.filter((t) => !drop(t));
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
  const starts = [];
  lines.forEach((l, i) => { if (l.trim() === '[Seat:*]') starts.push(i); });
  if (!starts.length) {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push('[Seat:*]', want);
    return `${lines.join('\n')}\n`;
  }
  // Every [Seat:*] section is edited (a later one would otherwise override). Last first: inserting a line does
  // not move the earlier sections.
  for (const start of starts.reverse()) {
    let end = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l));
    if (end < 0) end = lines.length;
    const all = (re) => lines.map((l, i) => (i > start && i < end && re.test(l) ? i : -1)).filter((i) => i >= 0);
    const active = all(/^\s*autologin-user\s*=/);
    const commented = all(/^\s*#\s*autologin-user\s*=/);
    if (active.length) for (const i of active) lines[i] = want;
    else if (commented.length) lines[commented[0]] = want;
    else lines.splice(start + 1, 0, want);
  }
  return `${lines.join('\n')}\n`;
}

export function renderAutostart({ dir, output, transform }) {
  checkOutput(output);
  if (transform !== 90 && transform !== 270) throw new Error(`transform must be 90 or 270, got ${transform}`);
  checkPath('dir', dir);
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
    checkPath(k, v);
  }
  checkUser(user);
  return String(template).replaceAll('@REVVIEW_DIR@', dir).replaceAll('@NODE@', node).replaceAll('@USER@', user);
}

const HEX4 = /^[0-9a-fA-F]{4}$/;

// The dongle rule: the template with the ids of the owner's buttons.json filled in. Throws (with the file named
// by the caller) when the ids are missing or not exactly 4 hex digits.
export function renderDongleRule(template, { vendor, product }) {
  for (const [k, v] of [['vendor', vendor], ['product', product]]) {
    if (typeof v !== 'string' || !HEX4.test(v)) throw new Error(`device.${k} must be exactly 4 hex digits, e.g. "1d50" (got ${JSON.stringify(v)})`);
  }
  return String(template).replaceAll('@VENDOR@', vendor.toLowerCase()).replaceAll('@PRODUCT@', product.toLowerCase());
}

// ---- three-way merge of the key map (buttons.json) ----
// Leaves are scalars and arrays (an array is ONE value); objects are merged key by key.
const ABSENT = Symbol('absent');
const has = (o, k) => Object.hasOwn(o, k);
// own keys only, and '__proto__' / 'constructor' are ordinary keys: results are built with defineProperty, never `o[k] =`
const setOwn = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export function jsonEqual(a, b) {
  if (a === ABSENT || b === ABSENT) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => has(b, k) && jsonEqual(a[k], b[k]));
  }
  return a === b;
}
// base = the shipped file the owner's copy came from, theirs = the new shipped file, mine = the owner's file.
// Returns { value, conflicts: [dotted paths] }. A key the owner did not change follows the update (added, changed,
// removed); a key the owner changed is kept; both changed to the same value is no conflict; both changed to
// different values, or removed on one side and edited on the other, is a conflict (value then keeps the owner's).
export function mergeJson(base, theirs, mine) {
  const conflicts = [];
  const node = (b, n, m, at) => {
    if (jsonEqual(m, n)) return m;
    if (jsonEqual(m, b)) return n;
    if (jsonEqual(n, b)) return m;
    if (isObj(n) && isObj(m) && (isObj(b) || b === ABSENT)) {
      const out = {};
      for (const k of [...Object.keys(m), ...Object.keys(n).filter((x) => !has(m, x))]) {
        const r = node(isObj(b) && has(b, k) ? b[k] : ABSENT, has(n, k) ? n[k] : ABSENT, has(m, k) ? m[k] : ABSENT, at ? `${at}.${k}` : k);
        if (r !== ABSENT) setOwn(out, k, r);
      }
      return out;
    }
    conflicts.push(at || '(whole file)');
    return m;
  };
  return { value: node(base, theirs, mine, ''), conflicts };
}
// The leaf paths where a and b differ (for the "what the merge does" line).
export function diffPaths(a, b, at = '') {
  if (isObj(a) && isObj(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => diffPaths(has(a, k) ? a[k] : ABSENT, has(b, k) ? b[k] : ABSENT, at ? `${at}.${k}` : k));
  }
  return jsonEqual(a, b) ? [] : [at || '(whole file)'];
}
// The shipped file's layout: 2 spaces, a final newline; an object whose values are all scalars (not the top one) and an
// array of scalars sit on one line, `{ "key": "F13", "button": "push-to-talk" }`. serializeButtons(JSON.parse(shipped)) === shipped.
export function serializeButtons(v) {
  const scalar = (y) => y === null || typeof y !== 'object';
  const ser = (x, ind, top) => {
    const pad = ' '.repeat(ind + 2);
    if (Array.isArray(x)) {
      if (x.length === 0) return '[]';
      if (x.every(scalar)) return `[${x.map((y) => JSON.stringify(y)).join(', ')}]`;
      return `[\n${x.map((y) => pad + ser(y, ind + 2, false)).join(',\n')}\n${' '.repeat(ind)}]`;
    }
    if (isObj(x)) {
      const ks = Object.keys(x);
      if (ks.length === 0) return '{}';
      if (!top && ks.every((k) => scalar(x[k]))) return `{ ${ks.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(x[k])}`).join(', ')} }`;
      return `{\n${ks.map((k) => `${pad}${JSON.stringify(k)}: ${ser(x[k], ind + 2, false)}`).join(',\n')}\n${' '.repeat(ind)}}`;
    }
    return JSON.stringify(x);
  };
  return `${ser(v, 0, true)}\n`;
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
  process.stderr.write(`revview setup: ${msg}\nusage: node pi/setup.mjs --root R --user U --home H --dir D [--rotate 90|270] [--output HDMI-A-1] [--node PATH] [--owner UID:GID] [--dry-run] [--adopt-buttons-base]\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const o = { rotate: 90, output: 'HDMI-A-1', node: '/usr/bin/node', dry: false };
  const need = { '--root': 'root', '--user': 'user', '--home': 'home', '--dir': 'dir', '--rotate': 'rotate', '--output': 'output', '--node': 'node', '--owner': 'owner' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dry = true;
    else if (a === '--adopt-buttons-base') o.adopt = true;
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
  const say = (s) => console.log(s);

  const w = createWriter({ dry: o.dry, owner: o.owner, homeAbs, root: o.root, say, ownMark: AUTOSTART_MARK });
  const { write, refuse, isLink, linkedComponent, readOr } = w;

  const piDir = path.dirname(fileURLToPath(import.meta.url));
  const edit = (rel, fn) => {
    const p = R(rel);
    if (isLink(p)) return refuse(p, 'is a symlink; not edited through it');
    const old = readOr(p);
    if (old === null) return refuse(p, 'missing');
    let res;
    try {
      res = fn(old);
    } catch (e) {
      return refuse(p, e.message); // NoRootError, several lines, malformed: the file stays byte-identical, exit 1
    }
    for (const w of res.warnings ?? []) say(`warning ${p}: ${w}`);
    write(p, typeof res === 'string' ? res : res.text, { backup: 'first' });
  };

  edit('/boot/firmware/cmdline.txt', (t) => editCmdline(t, { output: o.output, rotate: o.rotate }));
  edit('/boot/firmware/config.txt', editConfigTxt);
  const lightdm = R('/etc/lightdm/lightdm.conf');
  if (fs.existsSync(lightdm) || isLink(lightdm)) edit('/etc/lightdm/lightdm.conf', (t) => editLightdm(t, o.user));
  // a missing lightdm.conf stays a plain note (no exit code change): the desktop autologin is another way to get it
  else say(`skipped ${lightdm}: no lightdm.conf; set Desktop Autologin with raspi-config`);

  // The owner's key map and dongle ids: created once from the repo's default; on an update a three-way merge of
  // the shipped version recorded at the last run (BASE_PATH), the new shipped file and the owner's file.
  const ETC_BUTTONS = '/etc/revview/buttons.json';
  const BASE_PATH = '/var/lib/revview/buttons.shipped.json';
  const etcButtons = R(ETC_BUTTONS);
  const baseP = R(BASE_PATH);
  const repoButtons = path.join(o.dir, 'config/buttons.json');
  const repoButtonsText = fs.readFileSync(path.join(path.dirname(piDir), 'config/buttons.json'), 'utf8');
  const diffCmd = `diff ${ETC_BUTTONS} ${repoButtons}`;
  const recordBase = () => write(baseP, repoButtonsText, { mode: 0o644 });
  let mergedText = null; // what the owner's file is (dry run: will be) after a merge rewrite
  if (linkedComponent(etcButtons)) { /* refused below, where the rule is derived */ }
  else if (readOr(etcButtons) === null) {
    write(etcButtons, repoButtonsText, { createOnly: true });
    recordBase();
  } else {
    let mine = null;
    try {
      mine = JSON.parse(readOr(etcButtons));
      if (!isObj(mine)) throw new Error('not a JSON object');
    } catch (e) {
      refuse(etcButtons, `not valid JSON (${e.message}); fix it, nothing was merged or written`);
      mine = null;
    }
    if (mine) {
      const newV = JSON.parse(repoButtonsText);
      let baseV = null;
      const baseLink = linkedComponent(baseP);
      if (baseLink) refuse(baseP, `${baseLink === baseP ? 'it is' : `${baseLink} is`} a symlink; the shipped version is not recorded or read, ${ETC_BUTTONS} was kept as it is`);
      else if (o.adopt && readOr(baseP) !== null && (() => { try { return isObj(JSON.parse(readOr(baseP))); } catch { return false; } })()) {
        refuse(baseP, `--adopt-buttons-base: ${BASE_PATH} already holds a valid record of the shipped version; adopting would make the update's own changes look like yours. Nothing was changed. To start over, remove ${BASE_PATH} yourself first`);
      } else if (o.adopt) {
        recordBase();
        say(`note: ${ETC_BUTTONS} kept as it is; the current ${repoButtons} is now recorded as the version it is based on, later updates are merged`);
      } else {
        const bt = readOr(baseP);
        if (bt !== null) {
          try {
            baseV = JSON.parse(bt);
            if (!isObj(baseV)) throw new Error('not a JSON object');
          } catch (e) {
            baseV = null;
            say(`note: ${BASE_PATH} is damaged (${e.message}); treated as missing`);
          }
        }
        if (baseV === null) {
          if (jsonEqual(mine, newV)) recordBase();
          else say(`note: ${ETC_BUTTONS} (yours, kept) differs from ${repoButtons} (the default) and the installer has no record of the shipped version it came from, so it cannot merge; compare: ${diffCmd}. To keep your file as it is and merge from the next update on: run install.sh again with --adopt-buttons-base; or to take the new default (losing your edits): cp ${repoButtons} ${ETC_BUTTONS} and run install.sh again`);
        } else {
          const { value, conflicts } = mergeJson(baseV, newV, mine);
          if (conflicts.length) {
            refuse(etcButtons, `both you and the update changed ${conflicts.join(', ')}; nothing was merged or written; compare: ${diffCmd}, then edit ${ETC_BUTTONS} (take over or drop the update's value for those keys) and run install.sh again`);
          } else {
            if (!jsonEqual(value, mine)) {
              const text = serializeButtons(value);
              say(`${o.dry ? 'would merge' : 'merging'} the update into ${ETC_BUTTONS}: changed by the update: ${diffPaths(mine, value).join(', ')}; your other keys kept (the file is rewritten in the shipped layout, the old one is saved first)`);
              write(etcButtons, text, { backup: 'rotate', keep: 3, mode: 0o644 });
              mergedText = text;
            }
            recordBase();
          }
        }
      }
    }
  }
  // The rule follows the ids in that file (the repo copy when a dry run has not created it yet).
  let ids = null;
  const RULE_PATH = R('/etc/udev/rules.d/70-revview-dongle.rules');
  // a symlink anywhere on the way (the file or /etc/revview itself) is neither written nor read through
  const linked = linkedComponent(etcButtons);
  if (linked) refuse(RULE_PATH, `${ETC_BUTTONS}: ${linked === etcButtons ? 'it is' : `${linked} is`} a symlink; not read through it, so the dongle ids are unknown`);
  else {
    const text = mergedText ?? readOr(etcButtons) ?? repoButtonsText;
    try {
      const dev = JSON.parse(text)?.device;
      ids = { vendor: dev?.vendor, product: dev?.product };
    } catch (e) {
      refuse(RULE_PATH, `${ETC_BUTTONS} is not valid JSON (${e.message}); fix it, the rule was left as it was`);
    }
  }
  if (ids && ids.vendor == null && ids.product == null) {
    // a device given by name or path only is valid for the key reader (src/input/keymap.js); no USB ids, no rule
    say(`note: ${ETC_BUTTONS} has no device.vendor and device.product: the dongle udev rule was not written (or left as it was); the device is found by name or path, and the input group must be able to read it`);
  } else if (ids) {
    let rule = null;
    try {
      rule = renderDongleRule(fs.readFileSync(path.join(piDir, '70-revview-dongle.rules'), 'utf8'), ids);
    } catch (e) {
      refuse(RULE_PATH, `${ETC_BUTTONS}: ${e.message}; fix it, the rule was left as it was`);
    }
    if (rule !== null) write(RULE_PATH, rule);
  }
  write(R('/etc/udev/rules.d/71-revview-touch.rules'), renderTouchRule(o.rotate));
  write(R('/etc/systemd/user/revview.service'), renderUnit(fs.readFileSync(path.join(piDir, 'revview.service'), 'utf8'), o));

  w.link(R('/etc/systemd/user/default.target.wants/revview.service'), '/etc/systemd/user/revview.service');

  write(R(`/var/lib/systemd/linger/${o.user}`), '');
  write(R('/etc/revview/server.env'), renderServerEnv(), { createOnly: true });
  write(path.join(homeAbs, '.config/labwc/autostart'), renderAutostart({ dir: o.dir, output: o.output, transform: o.rotate }),
    { owned: true, backup: 'foreign', mode: 0o755 });
  if (w.failed()) process.exitCode = 4;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`setup.mjs: failed part way: ${e?.message ?? e}\nfiles after this point were not written; fix the cause and run it again\n`);
    process.exit(3);
  }
}
