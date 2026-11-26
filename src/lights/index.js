// LEDs, one per session. See README.md.
import { lightStates, nightOf, lightsOn } from './classify.js';
import { lightsFrame, needsFlash } from './frames.js';

export { lightStates, nightOf, lightsOn } from './classify.js';
export { lightsFrame, needsFlash, COLOURS, PATTERNS, MAX_BRIGHTNESS } from './frames.js';
export { loadLightsConfig, LightsConfigError, DEFAULT_LIGHTS_CONFIG_PATH } from './config.js';
export { encodeWs2812, createSpiDriver, createNullDriver, helperArgv, SPI_HZ, RESET_BYTES } from './ws2812.js';

export const TICK_MS = 250;

const same = (a, b) => a !== null && a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1] && p[2] === b[i][2]);

export function createLights({ driver, leds, brightness, clock = Date.now, timers = { setTimeout, clearTimeout }, log = () => {} }) {
  const setT = timers.setTimeout ?? setTimeout;
  const clearT = timers.clearTimeout ?? clearTimeout;
  let last = null;
  let board = null;
  let timer = null;
  let closed = false;
  let wasOn = null;
  let everOn = false; // nothing goes to the driver (so no helper starts) until the lights are first on
  let warned = false;
  const warn = (e) => { if (!warned) { warned = true; log(`lights: ${String(e?.message ?? e)}`); } };
  const dark = () => Array.from({ length: leds }, () => [0, 0, 0]);

  const push = (frame) => {
    if (same(last, frame)) return;
    last = frame;
    try { driver.show(frame.map((p) => [...p])); } catch (e) { warn(e); }
  };

  function update() {
    if (timer !== null) { clearT(timer); timer = null; }
    let on = false;
    let states = [];
    try {
      on = lightsOn(board);
      if (on) everOn = true;
      states = on ? lightStates(board) : [];
      if (everOn) push(lightsFrame({ on, night: nightOf(board), states, now: clock(), leds, brightness }));
    } catch (e) { warn(e); }
    if (on && needsFlash(states.slice(0, leds))) timer = setT(() => { timer = null; if (!closed) update(); }, TICK_MS);
  }

  return {
    observe(prev, next) {
      if (closed) return;
      board = next;
      const on = lightsOn(next);
      if (on !== wasOn) {
        if (wasOn !== null || on) log(`lights: ${on ? 'on' : 'off'}`);
        wasOn = on;
      }
      update();
    },
    current: () => (last === null ? dark() : last.map((p) => [...p])),
    async close() {
      if (closed) return;
      closed = true;
      if (timer !== null) { clearT(timer); timer = null; }
      if (everOn) { try { driver.show(dark()); } catch (e) { warn(e); } }
      last = dark();
      try { await driver.close(); } catch (e) { warn(e); }
    },
  };
}
