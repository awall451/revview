#!/usr/bin/env node
// Checks the devices and writes the configuration of the encrypted data partition. UNTESTED on a Pi: written
// without one and tested only against fixtures and a fake root (tests/unit/pi-data.test.js). Called by pi/data-setup.sh.
// The check/render functions are pure (data in, text out). Nothing here formats, mounts or opens anything, and
// no key material is ever seen by this file.
// Usage: node pi/data.mjs check --lsblk FILE --mounts FILE --device D --key-device K
//          exit 0 and one JSON line describing both devices; exit 1 and the reasons (one per line) on stderr; 2 bad args
//        node pi/data.mjs write --root R --user U --home H --dir D --data-uuid X --key-uuid Y [--owner UID:GID] [--dry-run]
//          One line per file: wrote | unchanged | backup A -> B | skipped P: why | would write (--dry-run).
//          Exit 1 when a file was refused, or (R is /) when D or D/pi/unlock.sh is not root-owned.
// lsblk is the parsed JSON of: lsblk -J -b -o NAME,PATH,TYPE,FSTYPE,UUID,LABEL,SIZE,MOUNTPOINTS,TRAN,RM  (FROM MEMORY)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriter } from './files.mjs';

const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
// Same rule as pi/setup.mjs: paths that end up in a systemd unit or a shell line.
const DIR_RE = /^\/[A-Za-z0-9._/-]+$/;
const DEV_RE = /^\/dev\/[A-Za-z0-9][A-Za-z0-9_/-]*$/;
const UUID36_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const KEY_UUID_RES = [/^[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}$/, /^[0-9A-Fa-f]{16}$/, UUID36_RE];
const KEY_FILE_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const KEY_FSTYPES = ['vfat', 'exfat', 'ext4'];
export const DATA_MOUNT = '/srv/revview-data';
export const MAPPER = 'revview-data';

const checkPath = (what, v) => {
  if (typeof v !== 'string' || !DIR_RE.test(v)) throw new Error(`${what} must match ^/[A-Za-z0-9._/-]+$ (absolute; letters, digits, . _ - and / only): ${JSON.stringify(v)}`);
};
const checkUser = (user) => {
  if (typeof user !== 'string' || !USER_RE.test(user)) throw new Error(`bad user name ${JSON.stringify(user)}`);
};
const checkDataUuid = (v) => {
  if (typeof v !== 'string' || !UUID36_RE.test(v)) throw new Error(`bad data UUID ${JSON.stringify(v)} (the LUKS UUID, 36 characters)`);
};
export const isKeyUuid = (v) => typeof v === 'string' && KEY_UUID_RES.some((re) => re.test(v));
const checkKeyUuid = (v) => {
  if (!isKeyUuid(v)) throw new Error(`bad key UUID ${JSON.stringify(v)} (the stick's file system UUID: XXXX-XXXX, 16 hex digits or 36 characters)`);
};
const checkKeyFile = (v) => {
  if (typeof v !== 'string' || !KEY_FILE_RE.test(v) || v.split('/').some((x) => x === '.' || x === '..')) {
    throw new Error(`bad key file path ${JSON.stringify(v)}`);
  }
};

// ---- device rules ----

function validDevPath(p) {
  return typeof p === 'string' && DEV_RE.test(p) && !p.split('/').includes('..') && !p.includes('//');
}

function indexLsblk(lsblk) {
  const byPath = new Map();
  const walk = (n, disk, parent) => {
    const here = { node: n, disk: disk ?? n, parent };
    if (typeof n.path === 'string') byPath.set(n.path, here);
    for (const c of n.children ?? []) walk(c, here.disk, n);
  };
  for (const n of lsblk?.blockdevices ?? []) walk(n, null, null);
  return byPath;
}

const mountedAt = (n) => (Array.isArray(n.mountpoints) ? n.mountpoints : [n.mountpoint]).filter((m) => m !== null && m !== undefined && m !== '');
const mountSources = (mounts) => new Set(String(mounts ?? '').split('\n').map((l) => l.split(/\s+/)[0]).filter(Boolean));

// -> { errors: [plain messages], data: {path,size,fstype,label}, key: {path,uuid,fstype} }. data and key are
// null while their device was not found. Nothing is guessed: a device that lsblk does not list is an error.
export function checkDevices({ lsblk, mounts, device, keyDevice }) {
  const errors = [];
  const idx = indexLsblk(lsblk);
  const sources = mountSources(mounts);
  let okPaths = true;
  for (const [what, p] of [['data device', device], ['key device', keyDevice]]) {
    if (!validDevPath(p)) {
      errors.push(`${what} ${JSON.stringify(p)} is not an acceptable device path (/dev/ and then letters, digits, _ - and / only; no ..)`);
      okPaths = false;
    }
  }
  if (okPaths && device === keyDevice) errors.push(`the data device and the key device are the same (${device})`);
  const find = (what, p) => {
    const hit = idx.get(p);
    if (!hit) errors.push(`${what} ${p} is not in the list of block devices (lsblk); check the name`);
    return hit;
  };
  const d = okPaths ? find('data device', device) : null;
  const k = okPaths ? find('key device', keyDevice) : null;
  let data = null;
  let key = null;

  if (d) {
    const n = d.node;
    data = { path: n.path, size: n.size ?? null, fstype: n.fstype ?? null, label: n.label ?? null };
    if (n.type !== 'part') errors.push(`data device ${device} is a ${n.type}, not a partition: give a partition (for example one made with a partitioning tool), never a whole disk`);
    if (mountedAt(n).length || sources.has(device)) errors.push(`data device ${device} is mounted (${mountedAt(n).join(', ') || 'see /proc/mounts'}): it is in use`);
    if ((n.children ?? []).length) errors.push(`data device ${device} is in use: it has ${n.children.map((c) => c.path ?? c.name).join(', ')} on it (an open encrypted mapping or a nested device)`);
    if (k && d.disk === k.disk) errors.push(`data device ${device} is on the same disk as the key device ${keyDevice}: they must be separate`);
  }
  if (k) {
    const n = k.node;
    key = { path: n.path, uuid: n.uuid ?? null, fstype: n.fstype ?? null };
    if (n.type !== 'part' && n.type !== 'disk') errors.push(`key device ${keyDevice} is a ${n.type}: give the stick's partition`);
    if (!KEY_FSTYPES.includes(n.fstype)) errors.push(`key device ${keyDevice} has file system ${n.fstype ?? 'none'}: it must be one of ${KEY_FSTYPES.join(', ')}`);
    if (!n.uuid) errors.push(`key device ${keyDevice} has no file system UUID`);
    else if (!isKeyUuid(n.uuid)) errors.push(`key device ${keyDevice} has a UUID that is not recognised: ${n.uuid}`);
    const tran = n.tran || k.disk.tran;
    if (tran !== 'usb') errors.push(`key device ${keyDevice} is not on USB (transport: ${tran ?? 'unknown'}): the key stick must be a USB stick`);
    if (mountedAt(n).length || sources.has(keyDevice)) errors.push(`key device ${keyDevice} is mounted (${mountedAt(n).join(', ') || 'see /proc/mounts'}): unmount it first`);
  }
  return { errors, data, key };
}

// ---- renders ----

export function renderDataConf({ dataUuid, keyUuid, keyFile = 'revview/data.key' }) {
  checkDataUuid(dataUuid);
  checkKeyUuid(keyUuid);
  checkKeyFile(keyFile);
  return `# The encrypted data partition and the key stick (written by pi/data-setup.sh; read by pi/unlock.sh as data,
# never sourced). No secrets here: the key itself is the file KEY_FILE on the stick.
# DATA_UUID  the LUKS UUID of the data partition
# KEY_UUID   the file system UUID of the key stick
# KEY_FILE   the key file's path on the stick
DATA_UUID=${dataUuid}
KEY_UUID=${keyUuid}
KEY_FILE=${keyFile}
`;
}

export function renderDataEnv({ home }) {
  checkPath('home', home);
  return `# Environment of the revview server when the data set-up is done (read by the user unit, KEY=value, no quotes).
# Written by pi/data-setup.sh. REVVIEW_DATA_MOUNT turns on the data lock (INSERT KEY while it is not mounted);
# CLAUDE_CONFIG_DIR keeps Claude Code's state (.claude.json too) inside ~/.claude, which is on the data partition.
REVVIEW_DATA_MOUNT=${DATA_MOUNT}
CLAUDE_CONFIG_DIR=${home}/.claude
`;
}

export function renderProfile({ user, home }) {
  checkUser(user);
  checkPath('home', home);
  return `# Claude Code keeps its state in ~/.claude (on the encrypted data partition), for ${user} only.
# Written by pi/data-setup.sh.
if [ "$(id -un 2> /dev/null)" = "${user}" ]; then
  export CLAUDE_CONFIG_DIR="$HOME/.claude"
fi
`;
}

export function renderUnlockUnit(template, { dir }) {
  checkPath('dir', dir);
  return String(template).replaceAll('@REVVIEW_DIR@', dir);
}

export function renderKeyRule(template, { keyUuid }) {
  checkKeyUuid(keyUuid);
  return String(template).replaceAll('@KEY_UUID@', keyUuid);
}

// The repo and pi/unlock.sh run as root (systemd): anything the user can write would let the user run code as root.
export function checkRootOwned({ uid, mode }) {
  if (uid !== 0) return `owned by uid ${uid}, not root`;
  if (mode & 0o022) return `writable by group or others (mode ${(mode & 0o7777).toString(8)})`;
  return null;
}

// ---- CLI ----

const USAGE = 'usage:\n  node pi/data.mjs check --lsblk FILE --mounts FILE --device D --key-device K\n'
  + '  node pi/data.mjs write --root R --user U --home H --dir D --data-uuid X --key-uuid Y [--owner UID:GID] [--dry-run]\n';
function usage(msg) {
  process.stderr.write(`revview data: ${msg}\n${USAGE}`);
  process.exit(2);
}

function parseArgs(argv, need, flags = []) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (flags.includes(a)) o[a] = true;
    else if (need[a]) {
      if (i + 1 >= argv.length) usage(`${a} needs a value`);
      o[need[a]] = argv[++i];
    } else usage(`unknown argument ${a}`);
  }
  return o;
}

function cmdCheck(argv) {
  const o = parseArgs(argv, { '--lsblk': 'lsblk', '--mounts': 'mounts', '--device': 'device', '--key-device': 'keyDevice' });
  for (const k of ['lsblk', 'mounts', 'device', 'keyDevice']) if (!o[k]) usage(`--${k === 'keyDevice' ? 'key-device' : k} is required`);
  let lsblk;
  let mounts;
  try {
    lsblk = JSON.parse(fs.readFileSync(o.lsblk, 'utf8'));
    mounts = fs.existsSync(o.mounts) ? fs.readFileSync(o.mounts, 'utf8') : '';
  } catch (e) {
    usage(`cannot read the lsblk or mounts file: ${e.message}`);
  }
  const res = checkDevices({ lsblk, mounts, device: o.device, keyDevice: o.keyDevice });
  if (res.errors.length) {
    for (const e of res.errors) process.stderr.write(`revview data: ${e}\n`);
    process.exit(1);
  }
  console.log(JSON.stringify({ data: res.data, key: res.key }));
}

function cmdWrite(argv) {
  const o = parseArgs(argv, { '--root': 'root', '--user': 'user', '--home': 'home', '--dir': 'dir', '--data-uuid': 'dataUuid', '--key-uuid': 'keyUuid', '--owner': 'owner' }, ['--dry-run']);
  for (const k of ['root', 'user', 'home', 'dir', 'dataUuid', 'keyUuid']) if (!o[k]) usage(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
  if (o.owner !== undefined) {
    const m = /^(\d+):(\d+)$/.exec(o.owner);
    if (!m) usage('--owner must be UID:GID');
    o.owner = { uid: Number(m[1]), gid: Number(m[2]) };
  }
  for (const k of ['home', 'dir']) if (!path.isAbsolute(o[k])) usage(`--${k} must be an absolute path`);
  const piDir = path.dirname(fileURLToPath(import.meta.url));
  let files;
  try {
    checkUser(o.user);
    files = {
      conf: renderDataConf({ dataUuid: o.dataUuid, keyUuid: o.keyUuid }),
      env: renderDataEnv({ home: o.home }),
      profile: renderProfile({ user: o.user, home: o.home }),
      rule: renderKeyRule(fs.readFileSync(path.join(piDir, '72-revview-key.rules'), 'utf8'), { keyUuid: o.keyUuid }),
      unit: renderUnlockUnit(fs.readFileSync(path.join(piDir, 'revview-unlock.service'), 'utf8'), { dir: o.dir }),
    };
  } catch (e) {
    usage(e.message);
  }

  const realRoot = path.resolve(o.root) === '/';
  if (realRoot) {
    // The unit runs <dir>/pi/unlock.sh as root: nothing the user can write may be on that path's last two steps.
    for (const p of [o.dir, path.join(o.dir, 'pi/unlock.sh')]) {
      let st;
      try {
        st = fs.statSync(p);
      } catch (e) {
        process.stderr.write(`revview data: cannot check ${p}: ${e.message}\n`);
        process.exit(1);
      }
      const bad = checkRootOwned({ uid: st.uid, mode: st.mode });
      if (bad) {
        process.stderr.write(`revview data: ${p} is ${bad}: it is run as root at boot, so the user must not be able to change it; install the repository root-owned (for example in /opt/revview) and run this again\n`);
        process.exit(1);
      }
    }
  }

  const R = (p) => path.join(o.root, p);
  const w = createWriter({ dry: !!o['--dry-run'], owner: o.owner, homeAbs: R(o.home), tag: 'revview data' });
  w.write(R('/etc/revview/data.conf'), files.conf);
  w.write(R('/etc/revview/data.env'), files.env);
  w.write(R('/etc/profile.d/revview-claude.sh'), files.profile);
  w.write(R('/etc/udev/rules.d/72-revview-key.rules'), files.rule);
  w.write(R('/etc/systemd/system/revview-unlock.service'), files.unit);
  w.link(R('/etc/systemd/system/multi-user.target.wants/revview-unlock.service'), '/etc/systemd/system/revview-unlock.service');
  const mnt = R(DATA_MOUNT);
  if (w.isLink(mnt)) w.refuse(mnt, 'is a symlink; not used as the mount point');
  else if (fs.existsSync(mnt)) console.log(`unchanged ${mnt}`);
  else if (o['--dry-run']) console.log(`would write ${mnt}`);
  else {
    w.mkdirp(mnt, false, 0o755);
    console.log(`wrote ${mnt}`);
  }
  if (w.failed()) process.exitCode = 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'check') cmdCheck(rest);
  else if (cmd === 'write') cmdWrite(rest);
  else usage(`unknown command ${JSON.stringify(cmd)}`);
}
