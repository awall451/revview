// Settings kept over a restart: the Sounds, Look and Lights modes chosen in the Settings menu (or by the menu hold) are
// written to one small JSON file and read back at the next start. See docs/DECISIONS.md ("Settings kept over a restart").
// Node built-ins only. The file system is injectable; the functions of it that are used (and nothing else):
//   readFileSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync, renameSync
import nodeFs from 'node:fs';
import path from 'node:path';

export const MAX_SETTINGS_BYTES = 4096;
const ALLOWED = {
  sounds: ['off', 'cues', 'speech'],
  look: ['day', 'night', 'auto'],
  lights: ['off', 'on'],
};

export class SettingsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SettingsError';
  }
}

// text -> { sounds?, look?, lights? }; throws SettingsError (an unknown key, a wrong value, not an object, too large: the whole file is refused)
export function parseSettings(text) {
  if (Buffer.byteLength(String(text)) > MAX_SETTINGS_BYTES) throw new SettingsError(`the file is larger than ${MAX_SETTINGS_BYTES} bytes`);
  let c;
  try {
    c = JSON.parse(text);
  } catch (e) {
    throw new SettingsError(`not valid JSON: ${e.message}`);
  }
  if (typeof c !== 'object' || c === null || Array.isArray(c)) throw new SettingsError('must hold a JSON object');
  const out = {};
  for (const [k, v] of Object.entries(c)) {
    if (!Object.hasOwn(ALLOWED, k)) throw new SettingsError(`unknown key "${k}" (allowed: ${Object.keys(ALLOWED).join(', ')})`);
    if (!ALLOWED[k].includes(v)) throw new SettingsError(`"${k}" must be one of ${ALLOWED[k].join(', ')}, got ${JSON.stringify(v)}`);
    out[k] = v;
  }
  return out;
}

export function defaultSettingsPath(env = process.env) {
  const base = env.XDG_STATE_HOME ? env.XDG_STATE_HOME : path.join(env.HOME ?? '', '.local', 'state');
  return path.join(base, 'revview', 'settings.json');
}

const why = (e) => e?.code ?? (e instanceof Error ? e.message : String(e));

// load() -> { values, status: 'kept' | 'none' | 'refused' | 'unreadable', reason? }; never throws, never writes.
// save(partial) -> boolean: writes { ...what the last load saw, ...partial (undefined/null skipped) }; never throws.
export function createSettingsStore({ path: file, fs = nodeFs, log = () => {} }) {
  let carried = {}; // what the file held at the last load (and what we wrote since): keys of features this run lacks survive
  let failing = false;
  function load() {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (e) {
      carried = {};
      if (e?.code === 'ENOENT') return { values: {}, status: 'none' };
      return { values: {}, status: 'unreadable', reason: `cannot read: ${why(e)}` };
    }
    try {
      carried = parseSettings(String(text));
      return { values: { ...carried }, status: 'kept' };
    } catch (e) {
      carried = {};
      if (!(e instanceof SettingsError)) throw e;
      return { values: {}, status: 'refused', reason: e.message };
    }
  }
  function save(partial) {
    const next = { ...carried };
    for (const [k, v] of Object.entries(partial ?? {})) if (v !== undefined && v !== null) next[k] = v;
    const tmp = `${file}.tmp`;
    const dir = path.dirname(file);
    let fd = null;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fd = fs.openSync(tmp, 'w', 0o600);
      fs.writeSync(fd, `${JSON.stringify(next, null, 2)}\n`);
      fs.fsyncSync(fd);
      const done = fd;
      fd = null;
      fs.closeSync(done);
      fs.renameSync(tmp, file);
    } catch (e) {
      if (fd !== null) { try { fs.closeSync(fd); } catch { /* already failing */ } }
      carried = next;
      if (!failing) log(`settings: cannot write ${file} (${why(e)}); the choice stays until the restart`);
      failing = true;
      return false;
    }
    carried = next;
    failing = false;
    try { // best effort: make the rename itself durable
      const d = fs.openSync(dir, 'r');
      try { fs.fsyncSync(d); } finally { fs.closeSync(d); }
    } catch { /* a directory cannot always be opened or synced; the file is already in place */ }
    return true;
  }
  return { load, save };
}

const inside = (file, dir) => {
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

// The server side (one per server, set as ctx.settings). `has` says which features this run has ({ sounds, lights });
// look always exists. A setting that changed since the start is "touched": only touched settings are written (over what the
// file held), so a choice nobody made never pins a config default.
export function createSettingsKeeper(ctx, { path: file, fs, dataLock = null, has = {}, log = (m) => console.error(m) }) {
  const store = createSettingsStore({ path: file, fs, log });
  const features = { sounds: has.sounds === true, look: true, lights: has.lights === true };
  const touched = new Set();
  const lockable = Boolean(dataLock?.mountPoint) && inside(file, dataLock.mountPoint);
  let waiting = lockable;
  let applying = false;
  const current = (k) => ctx.board[k];
  const describe = (r) => {
    if (r.status === 'kept') return `settings: kept ${file}: ${Object.entries(r.values).map(([k, v]) => `${k}=${v}`).join(' ') || '(empty)'}`;
    if (r.status === 'none') return `settings: nothing kept yet (${file} does not exist)`;
    return `settings: ${file} ${r.status === 'refused' ? 'refused' : 'unreadable'} (${r.reason}); the config defaults are used`;
  };
  const write = () => {
    const part = {};
    for (const k of touched) part[k] = current(k);
    store.save(part);
  };
  const EVENT = { sounds: 'RevviewSounds', look: 'RevviewLook', lights: 'RevviewLights' };
  const usable = (values) => Object.fromEntries(Object.entries(values).filter(([k]) => features[k]));
  function unlock() {
    if (!waiting) return;
    waiting = false;
    const r = store.load();
    log(describe(r));
    if (touched.size > 0) { write(); return; } // the driver's latest choice wins
    applying = true;
    try {
      for (const [k, v] of Object.entries(usable(r.values))) ctx.apply({ hook_event_name: EVENT[k], mode: v }, true);
    } finally { applying = false; }
  }
  return {
    // at creation, before the board is built: the kept values to start with (none while the data is locked); logs the one start line
    start() {
      if (waiting) { log(`settings: waiting for the data unlock (${file})`); return {}; }
      const r = store.load();
      log(describe(r));
      return usable(r.values);
    },
    // the data monitor saw the lock change (monitors.js, after the RevviewDataLock event): read at the unlock; locked again, writes wait
    dataChanged(locked) {
      if (!lockable) return;
      if (locked) { waiting = true; return; }
      unlock();
    },
    observe(prev, next) {
      if (applying) return;
      let changed = false;
      for (const k of Object.keys(EVENT)) {
        if (features[k] && prev[k] !== next[k]) { touched.add(k); changed = true; }
      }
      if (changed && !waiting) write(); // while locked the choice stays on the board; the unlock writes it
    },
  };
}
