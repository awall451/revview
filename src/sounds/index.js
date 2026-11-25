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

// Watches board changes: observe(prev, next) plays the cue a change deserves, while the mode is 'cues' or 'speech'.
export function createSounds({ player, log = () => {} }) {
  return {
    observe(prev, next) {
      if (next.sounds !== prev?.sounds) log(`sounds: ${next.sounds}`);
      if (next.sounds !== 'cues' && next.sounds !== 'speech') return null;
      const hit = cueFor(prev, next);
      if (hit) player.play(hit.cue);
      return hit;
    },
    idle: () => player.idle(),
    close: () => player.close(),
  };
}
