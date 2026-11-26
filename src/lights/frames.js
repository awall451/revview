// What the LEDs show. Pure: no clock, no I/O (the time comes in as `now`, in ms).
export const MAX_BRIGHTNESS = 64;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// the day bar colours (src/view/view.css); a failed turn shows in the waiting band, its pattern tells it apart
export const COLOURS = {
  working: hex('#5eb1ff'),
  waiting: hex('#c8a2ff'),
  permission: hex('#ffb020'),
  asking: hex('#e6f25a'),
  done: hex('#4fdc7a'),
  starting: hex('#e0e0e0'),
  unknown: hex('#5ce1e6'),
  failed: hex('#c8a2ff'),
};

// half = ms on (and ms off); null = steady. 250 ms is 2 Hz, the fastest allowed.
export const PATTERNS = {
  working: { half: null },
  done: { half: null },
  starting: { half: null },
  unknown: { half: null },
  permission: { half: 1000 },
  asking: { half: 1000 },
  waiting: { half: 1000 },
  failed: { half: 250 },
};

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export function needsFlash(states) {
  return Array.isArray(states) && states.some((s) => typeof s === 'string' && has(PATTERNS, s) && PATTERNS[s].half !== null);
}

// -> array of exactly `leds` [r, g, b]; LED i shows states[i]
export function lightsFrame({ on, night, states, now, leds, brightness }) {
  const frame = Array.from({ length: leds }, () => [0, 0, 0]);
  if (!on || !Array.isArray(states)) return frame;
  const cap = night ? brightness.night : brightness.day;
  for (let i = 0; i < leds && i < states.length; i++) {
    const s = states[i];
    if (typeof s !== 'string' || !has(COLOURS, s)) continue;
    const { half } = PATTERNS[s];
    if (half !== null && Math.floor(now / half) % 2 !== 0) continue;
    frame[i] = COLOURS[s].map((c) => Math.round((c * cap) / 255));
  }
  return frame;
}
