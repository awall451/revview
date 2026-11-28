// Audio cues for the bar. See README.md.
import { fileURLToPath } from 'node:url';
import { cueFor } from './classify.js';
import { hasProgram } from '../speech/config.js';

export { cueFor, cueClass } from './classify.js';
export { createCuePlayer } from './player.js';
export { CUE_NAMES, cueWav } from './wav.js';

export const CUE_DIR = fileURLToPath(new URL('./cues', import.meta.url));

// the first player command (argv) whose program is found on PATH (or is an absolute executable path), else null
export function pickPlayer(players, { exists } = {}) {
  for (const argv of players ?? []) {
    if (Array.isArray(argv) && argv.length > 0 && hasProgram(argv[0], exists)) return [...argv];
  }
  return null;
}

// Watches board changes: observe(prev, next) notes a change; a burst of changes (each within settleMs of the last,
// the whole burst at most maxMs long) gives at most one cue, cueFor(first prev, last next), played when the burst
// settles and the mode of the last board is 'cues' or 'speech'. idle() also waits for a burst that has not settled.
export function createSounds({ player, log = () => {}, timers, settleMs = 250, maxMs = 2000 }) {
  const setT = timers?.setTimeout ?? setTimeout;
  const clearT = timers?.clearTimeout ?? clearTimeout;
  let start = null; // the board before the burst's first change
  let last = null; // the board after its latest change; null: no burst is open
  let settleTimer = null;
  let maxTimer = null;
  let waiters = []; // idle() calls waiting for the burst
  let closed = false;

  const clearTimers = () => {
    if (settleTimer !== null) clearT(settleTimer);
    if (maxTimer !== null) clearT(maxTimer);
    settleTimer = null;
    maxTimer = null;
  };
  const release = () => {
    const w = waiters;
    waiters = [];
    for (const r of w) r();
  };
  const flush = () => {
    clearTimers();
    const [from, to] = [start, last];
    start = null;
    last = null;
    try {
      if (to && (to.sounds === 'cues' || to.sounds === 'speech')) {
        const hit = cueFor(from, to);
        if (hit) player.play(hit.cue);
      }
    } finally {
      release();
    }
  };

  return {
    // null: the cue is decided when the burst settles (nothing uses the return value); with settleMs <= 0 the cue it played
    observe(prev, next) {
      if (next.sounds !== prev?.sounds) log(`sounds: ${next.sounds}`);
      if (closed) return null;
      if (!(settleMs > 0)) { // no burst: decide and play at once
        if (next.sounds !== 'cues' && next.sounds !== 'speech') return null;
        const hit = cueFor(prev, next);
        if (hit) player.play(hit.cue);
        return hit;
      }
      if (last === null) {
        if (next.sounds !== 'cues' && next.sounds !== 'speech') return null; // no burst can give a cue
        start = prev ?? null;
        maxTimer = setT(flush, maxMs);
      } else if (settleTimer !== null) clearT(settleTimer);
      last = next;
      settleTimer = setT(flush, settleMs);
      return null;
    },
    async idle() {
      if (last !== null) await new Promise((r) => { waiters.push(r); });
      return player.idle();
    },
    close() {
      closed = true;
      clearTimers();
      start = null;
      last = null;
      release();
      return player.close();
    },
  };
}
