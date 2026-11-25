// Plays the cue files through an external player program (config: cuePlayers). Never throws, never overlaps.
// The player is started from an argument list with shell:false in its own process group; the cue file path is
// the last argument. Queue of one: one cue plays, one may wait; a newer cue replaces the waiting one, except that
// a waiting cue of the selected session (needs, done, failed) is never replaced by 'other'.
import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import { CUE_NAMES } from './wav.js';

export const WAIT_BEFORE_MS = 30000;

export function createCuePlayer({ argv, dir, spawn = nodeSpawn, timers, log = () => {}, maxMs = 3000, waitBefore }) {
  const setT = timers?.setTimeout ?? setTimeout;
  const clearT = timers?.clearTimeout ?? clearTimeout;
  const live = new Set(); // timers still pending
  const after = (fn, ms) => {
    const t = setT(() => { live.delete(t); fn(); }, ms);
    live.add(t);
    return t;
  };
  const cancel = (t) => { live.delete(t); clearT(t); };

  let busy = false; // a cue is waiting for speech, or playing
  let waiting = null; // the cue name in the single waiting slot
  let child = null;
  let disabled = false;
  let closed = false;
  let idleWaiters = [];
  let runDone = Promise.resolve();
  let wake = () => {}; // ends whatever the current cue is waiting for (close)
  const logged = new Set();
  const logOnce = (key, msg) => { if (!logged.has(key)) { logged.add(key); log(msg); } };

  const settleIdle = () => {
    if (busy || waiting !== null) return;
    const w = idleWaiters;
    idleWaiters = [];
    for (const r of w) r();
  };

  function kill(c) {
    if (c.pid !== undefined) {
      try { process.kill(-c.pid, 'SIGKILL'); return; } catch { /* group gone: try the child itself */ }
    }
    try { c.kill?.('SIGKILL'); } catch { /* already gone */ }
  }

  // resolves true when the cue may start, false when it is dropped (bound reached, closed)
  async function mayStart() {
    if (typeof waitBefore !== 'function') return !closed;
    let t;
    const bound = new Promise((r) => { t = after(() => r(false), WAIT_BEFORE_MS); });
    const closing = new Promise((r) => { wake = () => r(false); });
    let ready;
    try {
      ready = Promise.resolve(waitBefore()).then(() => true, () => true);
    } catch {
      ready = Promise.resolve(true);
    }
    const ok = await Promise.race([ready, bound, closing]);
    cancel(t);
    wake = () => {};
    return ok && !closed;
  }

  function playFile(cue) {
    return new Promise((resolve) => {
      const file = path.join(dir, `${cue}.wav`);
      let c;
      let ended = false;
      let killTimer = null;
      let killed = false;
      const end = () => {
        if (ended) return;
        ended = true;
        if (killTimer !== null) cancel(killTimer);
        wake = () => {};
        child = null;
        resolve();
      };
      try {
        c = spawn(argv[0], [...argv.slice(1), file], { shell: false, detached: true, stdio: 'ignore' });
      } catch (e) {
        failStart(e);
        return resolve();
      }
      child = c;
      wake = () => { killed = true; kill(c); end(); };
      c.on('error', (e) => {
        failStart(e);
        killed = true;
        end();
      });
      c.on('exit', (code, signal) => {
        if (!killed && (code !== 0 || signal)) logOnce(`exit ${code ?? signal}`, `sounds: cue player ${argv[0]} exited with ${code ?? signal}`);
        end();
      });
      killTimer = after(() => { killed = true; kill(c); end(); }, maxMs);
    });
  }

  function failStart(e) {
    disabled = true;
    logOnce('start', `sounds: cue player ${argv[0]} could not start (${e?.code ?? e?.message ?? 'error'}); cues are off`);
  }

  async function run(cue) {
    try {
      if (await mayStart() && !disabled) await playFile(cue);
    } catch (e) {
      log(`sounds: cue failed: ${String(e?.message ?? e)}`);
    }
    busy = false;
    if (waiting !== null && !closed && !disabled) {
      const next = waiting;
      waiting = null;
      busy = true;
      runDone = run(next);
      return;
    }
    waiting = null;
    settleIdle();
  }

  function play(cue) {
    if (closed) return { played: false, reason: 'closed' };
    if (!Array.isArray(argv) || argv.length === 0) return { played: false, reason: 'no player' };
    if (disabled) return { played: false, reason: 'disabled' };
    if (!CUE_NAMES.includes(cue)) return { played: false, reason: 'unknown cue' };
    if (busy) {
      if (cue === 'other' && waiting !== null && waiting !== 'other') return { played: false, reason: 'queue full' };
      waiting = cue;
      return { played: true, queued: true };
    }
    busy = true;
    runDone = run(cue);
    return { played: true };
  }

  return {
    play,
    idle: () => (busy || waiting !== null ? new Promise((r) => idleWaiters.push(r)) : Promise.resolve()),
    async close() {
      closed = true;
      waiting = null;
      wake();
      if (child) kill(child);
      for (const t of [...live]) cancel(t);
      await runDone;
      busy = false;
      settleIdle();
    },
  };
}
