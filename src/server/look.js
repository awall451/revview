import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// The look of the bar (day / night / auto). See README.md ("Look"). The clock monitor only says whether it is night
// now by the wall clock; the board (RevviewLook, RevviewLookClock) decides what the bar shows.
export const DEFAULT_LOOK_CONFIG_PATH = fileURLToPath(new URL('../../config/look.json', import.meta.url));
export const LOOK_MODES = ['day', 'night', 'auto'];
const CLOCK_SET_YEAR = 2026; // the Pi has no RTC: an earlier year means the clock is not set yet

export class LookConfigError extends Error {
  constructor(message) {
    super(`look config: ${message}`);
    this.name = 'LookConfigError';
  }
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutesOf = (s) => { const m = HHMM.exec(s); return Number(m[1]) * 60 + Number(m[2]); };
const isObj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);

// -> { mode, night: { from, to } } (from / to as 'HH:MM'); throws LookConfigError
export function loadLookConfig(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new LookConfigError(`cannot read ${file}: ${e?.code ?? e?.message ?? e}`);
  }
  let c;
  try {
    c = JSON.parse(raw);
  } catch (e) {
    throw new LookConfigError(`${file} is not valid JSON: ${e.message}`);
  }
  if (!isObj(c)) throw new LookConfigError(`${file} must hold a JSON object`);
  if (!LOOK_MODES.includes(c.look)) throw new LookConfigError(`"look" must be one of ${LOOK_MODES.join(', ')}, got ${JSON.stringify(c.look)}`);
  if (!isObj(c.night)) throw new LookConfigError('"night" must be an object like { "from": "21:00", "to": "07:00" }');
  for (const k of ['from', 'to']) {
    if (typeof c.night[k] !== 'string' || !HHMM.test(c.night[k])) throw new LookConfigError(`"night.${k}" must be a time like "21:00" (HH:MM, 24 hours), got ${JSON.stringify(c.night[k])}`);
  }
  return { mode: c.look, night: { from: c.night.from, to: c.night.to } };
}

// True when the local time of `date` is in [from, to); from > to wraps over midnight; from == to is never night.
export function isNightAt(date, { from, to }) {
  const f = minutesOf(from);
  const t = minutesOf(to);
  if (f === t) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  return f < t ? now >= f && now < t : now >= f || now < t;
}

export const clockSet = (date) => date.getFullYear() >= CLOCK_SET_YEAR;

// systemd-timesyncd creates this file when it has synced the clock (from memory, not checked: the package is not in
// pi/tree; docs/PI-FACTS.md section 10). Without an RTC, systemd starts the clock at its build time, so the year alone
// is not proof. On the Pi the service passes --clock-sync, which uses this probe; a laptop (macOS, chrony) has no such
// file, so without the switch no probe is used and only the year check applies.
export const SYNCED_FILE = '/run/systemd/timesync/synchronized';
export const timesyncProbe = (file = SYNCED_FILE) => () => fs.existsSync(file);

// Computes "night now" at start and every intervalMs; apply({hook_event_name:'RevviewLookClock', night}) once at start and
// then only when the value changes. Until the clock counts as set (clockSynced(), when given, says so AND the year is 2026
// or later) it says day (night: false) and logs once; the 30 s check follows the sync once it comes.
export function startLookClock({ night, now = () => new Date(), clockSynced = null, timers = { setTimeout, clearTimeout }, intervalMs = 30000, apply, log = () => {} }) {
  let stopped = false;
  let timer = null;
  let last = null;
  let warned = false;
  const tick = () => {
    timer = null;
    if (stopped) return;
    const d = now();
    const synced = clockSynced ? clockSynced() : true;
    const set = synced && clockSet(d);
    if (!set && !warned) {
      warned = true;
      log(`look: the clock is not set yet (${synced ? 'year before 2026' : 'no time sync yet'}): auto shows day until it is`);
    }
    const isNight = set && isNightAt(d, night);
    if (isNight !== last) {
      last = isNight;
      apply({ hook_event_name: 'RevviewLookClock', night: isNight });
    }
    timer = timers.setTimeout(tick, intervalMs);
    timer?.unref?.();
  };
  tick();
  return {
    stop() {
      stopped = true;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
  };
}
