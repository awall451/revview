// Preloaded into the server of a long drive (node --import tests/long/clock-skew.js src/server/index.js PORT ...).
//
// 1. Date.now() is shifted by LONG_DRIVE_SKEW_MS at start, and on SIGUSR2 by the number of ms in the file
//    LONG_DRIVE_SKEW_FILE (an absolute offset, may be negative): the way a Pi's wall clock jumps when it gets the time
//    from the network after boot. Only Date.now() moves (what the server's code reads); setTimeout, setInterval and
//    performance.now() stay monotonic, as they do on a real system whose clock is stepped.
// 2. With LONG_DRIVE_SCALE=X (X > 1) the server lives in simulated time (cycle 81): setTimeout/setInterval delays are
//    divided by X, performance.now() and `new Date()` / Date.now() run X times faster, from the simulated wall clock
//    LONG_DRIVE_SIM_START (epoch ms) at the real instant LONG_DRIVE_WALL_ANCHOR (epoch ms, the same for every restart,
//    so the simulated time goes on over a restart). So the server's own 15 s ping, 30 s look clock, 300 s quiet timers,
//    the lights' 250 ms flash tick and so on tick at the pace of the replay. `new Date()` without arguments does not
//    carry the clock-jump skew (as before, only Date.now() does), so the night look follows the plain simulated time.
// 3. With LONG_DRIVE_DIAG=<file> a snapshot is written there every 2 real seconds: live timers (counted by wrapping
//    the timer functions), what Node says is active, memory, open file descriptors.
import fs from 'node:fs';
import { performance as perf } from 'node:perf_hooks';

let skew = Number(process.env.LONG_DRIVE_SKEW_MS ?? 0) || 0;
const scale = Number(process.env.LONG_DRIVE_SCALE ?? 1) || 1;
const RealDate = Date;
const realNow = RealDate.now.bind(RealDate);
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
const realClearTimeout = globalThis.clearTimeout;
const realClearInterval = globalThis.clearInterval;
const realPerfNow = perf.now.bind(perf);

const simPlain = scale === 1 ? realNow : (() => {
  const anchor = Number(process.env.LONG_DRIVE_WALL_ANCHOR);
  const start = Number(process.env.LONG_DRIVE_SIM_START);
  return () => start + (realNow() - anchor) * scale;
})();
RealDate.now = () => simPlain() + skew;
if (scale !== 1) {
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length === 0) super(simPlain()); else super(...a); }
    static now() { return simPlain() + skew; }
  };
  perf.now = () => realPerfNow() * scale;
}

// every live timer, so the diagnostics can count them (unref'd ones too)
const live = new Set();
globalThis.setTimeout = (fn, ms, ...a) => {
  const h = realSetTimeout(() => { live.delete(h); fn(...a); }, (Number(ms) || 1) / scale);
  live.add(h);
  return h;
};
globalThis.setInterval = (fn, ms, ...a) => {
  const h = realSetInterval(fn, Math.max(1, (Number(ms) || 1) / scale), ...a);
  live.add(h);
  return h;
};
globalThis.clearTimeout = (h) => { live.delete(h); realClearTimeout(h); };
globalThis.clearInterval = (h) => { live.delete(h); realClearInterval(h); };

process.on('SIGUSR2', () => {
  const file = process.env.LONG_DRIVE_SKEW_FILE;
  if (file) skew = Number(fs.readFileSync(file, 'utf8')) || 0;
});

if (process.env.LONG_DRIVE_DIAG) {
  const file = process.env.LONG_DRIVE_DIAG;
  const snap = () => {
    const types = {};
    for (const t of process.getActiveResourcesInfo()) types[t] = (types[t] ?? 0) + 1;
    let fds = null;
    try { fds = fs.readdirSync('/proc/self/fd').length; } catch { /* no /proc */ }
    const m = process.memoryUsage();
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ timers: live.size, active: types, fds, heapUsed: m.heapUsed, external: m.external, rss: m.rss, simNow: simPlain() }));
      fs.renameSync(`${file}.tmp`, file);
    } catch { /* the drive removed the directory */ }
  };
  realSetInterval(snap, 2000).unref();
}

// The drive keeps this process's stdin open. When the drive is gone (even killed with SIGKILL) the pipe closes and the
// server ends, so a dead drive leaves no server behind.
process.stdin.on('end', () => process.exit(0));
process.stdin.on('close', () => process.exit(0));
process.stdin.resume();
