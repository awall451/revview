// Thermal monitor for --thermal: HOT (temperature or the Pi firmware's throttle flags) and LOW POWER (under-voltage).
// Sources (from memory, not yet proven on hardware):
//   temperature: /sys/class/thermal/thermal_zone0/temp (millidegrees C), env REVVIEW_THERMAL_TEMP = another file
//   throttled flags: `vcgencmd get_throttled` ("throttled=0x50005"); env REVVIEW_THERMAL_VCGENCMD = the command path,
//     REVVIEW_THERMAL_THROTTLED = a file holding the value (replaces the command)
// A source that cannot be read (no vcgencmd on a laptop) is logged once and gives no mark. Node built-ins only.
import { execFile } from 'node:child_process';
import fs from 'node:fs';

export const DEFAULT_TEMP_PATH = '/sys/class/thermal/thermal_zone0/temp';
export const DEFAULT_VCGENCMD = 'vcgencmd';
export const RUN_TIMEOUT_MS = 3000;
const MAX_TEXT = 256;

// "throttled=0x50005", "0x50005" or "327685" -> integer; anything else -> null. Never throws.
export function parseThrottled(text) {
  if (typeof text !== 'string' || text.length > MAX_TEXT) return null;
  const m = /^\s*(?:throttled\s*=\s*)?(0x[0-9a-f]{1,8}|\d{1,10})\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n <= 0xffffffff ? n : null;
}

// sysfs millidegrees ("47774\n") -> degrees C; only 0..150 C is believed.
export function parseTempMilli(text) {
  if (typeof text !== 'string' || text.length > MAX_TEXT) return null;
  const m = /^\s*(-?\d{1,9})\s*$/.exec(text);
  if (!m) return null;
  const c = Number(m[1]) / 1000;
  return c >= 0 && c <= 150 ? c : null;
}

const BIT_UNDERVOLT = 0x1;
const BIT_HOT = 0x2 | 0x4 | 0x8; // freq capped now, throttled now, soft temperature limit now

// Pure. `prev` is the state this returned last time (or undefined); opts.now is the clock in ms.
// Returns { hot, lowPower, hotByTemp, hotLast, lowLast }: the marks shown (hold included) and what to pass back.
export function deriveMarks({ throttled = null, tempC = null } = {}, prev, opts = {}) {
  const { now = 0, hotOnC = 80, hotOffC = 75, holdMs = 10000 } = opts;
  const p = prev ?? { hotByTemp: false, hotLast: null, lowLast: null };
  const flags = Number.isInteger(throttled) ? throttled : 0;
  const hotByTemp = typeof tempC === 'number' && Number.isFinite(tempC)
    && (tempC >= hotOnC || (p.hotByTemp && tempC >= hotOffC));
  const hotNow = (flags & BIT_HOT) !== 0 || hotByTemp;
  const lowNow = (flags & BIT_UNDERVOLT) !== 0;
  const hotLast = hotNow ? now : p.hotLast;
  const lowLast = lowNow ? now : p.lowLast;
  const held = (last) => last !== null && last !== undefined && now - last < holdMs;
  return { hot: hotNow || held(hotLast), lowPower: lowNow || held(lowLast), hotByTemp, hotLast, lowLast };
}

const SINCE_BOOT = ['under-voltage occurred', 'frequency capping occurred', 'throttling occurred', 'soft temperature limit occurred'];

export function createThermalMonitor({
  readThrottled, readTemp, onChange, timers = { setTimeout, clearTimeout }, now = Date.now, intervalMs = 5000,
  log = () => {}, hotOnC, hotOffC, holdMs,
} = {}) {
  let stopped = false;
  let timer = null;
  let state;
  let shown = { hot: false, lowPower: false };
  const logged = new Set();
  let sinceLogged = 0;

  const once = (key, line) => {
    if (logged.has(key)) return;
    logged.add(key);
    log(line);
  };
  const read = async (source, reader, parse) => {
    let text;
    try {
      text = await reader();
    } catch (e) {
      once(`${source}:unreadable`, `thermal: ${source} not readable (${e instanceof Error ? e.message : e}); no mark from it`);
      return null;
    }
    if (text === null || text === undefined) {
      once(`${source}:unreadable`, `thermal: ${source} not readable (no value); no mark from it`);
      return null;
    }
    const v = parse(String(text));
    if (v === null) once(`${source}:garbage`, `thermal: ${source} gave an unreadable value (${JSON.stringify(String(text).slice(0, 40))}); no mark from it`);
    return v;
  };

  async function tick() {
    timer = null;
    const [throttled, tempC] = await Promise.all([
      read('throttled', readThrottled, parseThrottled),
      read('temperature', readTemp, parseTempMilli),
    ]);
    if (stopped) return;
    if (throttled !== null) {
      const since = (throttled >>> 16) & 0xf;
      if (since !== 0 && since !== sinceLogged) {
        sinceLogged = since;
        const what = SINCE_BOOT.filter((_, i) => since & (1 << i)).join(', ');
        log(`thermal: since boot: ${what}, throttled=0x${throttled.toString(16)}`);
      }
    }
    state = deriveMarks({ throttled, tempC }, state, { now: now(), hotOnC, hotOffC, holdMs });
    if (state.hot !== shown.hot || state.lowPower !== shown.lowPower) {
      shown = { hot: state.hot, lowPower: state.lowPower };
      try {
        onChange({ ...shown });
      } catch (e) {
        log(`thermal: onChange failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (!stopped) timer = timers.setTimeout(tick, intervalMs);
  }

  tick().catch((e) => log(`thermal: ${e instanceof Error ? e.message : e}`));
  return {
    stop() {
      stopped = true;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
  };
}

const execRun = (cmd, args, opts) => new Promise((resolve, reject) => {
  execFile(cmd, args, opts, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
});

// The two readers: each returns text or throws. Throttled: the file if one is configured, else `vcgencmd get_throttled`.
export function createDefaultReaders({
  throttledPath = null, tempPath = DEFAULT_TEMP_PATH, vcgencmd = DEFAULT_VCGENCMD,
  run = execRun, readFile = fs.promises.readFile,
} = {}) {
  return {
    readTemp: async () => String(await readFile(tempPath, 'utf8')),
    readThrottled: throttledPath
      ? async () => String(await readFile(throttledPath, 'utf8'))
      : () => run(vcgencmd, ['get_throttled'], { timeout: RUN_TIMEOUT_MS, maxBuffer: 4096 }),
  };
}

// Reader options from the environment (empty values are ignored).
export function thermalEnv(env = {}) {
  const o = {};
  if (env.REVVIEW_THERMAL_TEMP) o.tempPath = env.REVVIEW_THERMAL_TEMP;
  if (env.REVVIEW_THERMAL_THROTTLED) o.throttledPath = env.REVVIEW_THERMAL_THROTTLED;
  if (env.REVVIEW_THERMAL_VCGENCMD) o.vcgencmd = env.REVVIEW_THERMAL_VCGENCMD;
  return o;
}
