// Gesture detector: key press/release events in, button gestures (tap, hold, long-hold) out.
// Time comes only from the injected clock.
import { MODIFIER_KIND } from './keys.js';

export function createGestureDetector({ bindings, timing, clock, emit }) {
  const { debounceMs, holdMs, longHoldMs } = timing;
  const table = new Map();
  for (const b of bindings) table.set(`${[...b.mods].sort().join('+')}|${b.key}`, b);

  const downMods = new Set(); // modifier key codes currently held
  const downKeys = new Map(); // key code -> { binding|null, at, holdTimer, longTimer, holdDone, longDone }
  const lastRelease = new Map(); // key code -> time

  const fire = (button, gesture) => emit({ button, gesture, at: clock.now() });

  function heldKinds() {
    const kinds = new Set();
    for (const c of downMods) kinds.add(MODIFIER_KIND[c]);
    return [...kinds].sort();
  }

  function clearTimers(s) {
    if (s.holdTimer !== null) clock.clearTimeout(s.holdTimer);
    if (s.longTimer !== null) clock.clearTimeout(s.longTimer);
    if (s.relTimer !== null) clock.clearTimeout(s.relTimer);
    s.relTimer = null;
    s.holdTimer = null;
    s.longTimer = null;
  }

  function press(code) {
    const cur = downKeys.get(code);
    if (cur && cur.relTimer !== null) { // bounce: the release was provisional, the press continues
      clock.clearTimeout(cur.relTimer);
      cur.relTimer = null;
      return;
    }
    if (cur || downMods.has(code)) return;
    if (code in MODIFIER_KIND) { downMods.add(code); return; }
    const now = clock.now();
    const last = lastRelease.get(code);
    if (last !== undefined && now - last < debounceMs) {
      downKeys.set(code, { binding: null });
      return;
    }
    const binding = table.get(`${heldKinds().join('+')}|${code}`) ?? null;
    const s = { binding, at: now, holdTimer: null, longTimer: null, relTimer: null, holdDone: false, longDone: false };
    downKeys.set(code, s);
    if (!binding) return;
    if (!binding.hold && !binding.longHold) { fire(binding.button, 'tap'); return; }
    if (binding.hold) {
      s.holdTimer = clock.setTimeout(() => {
        s.holdTimer = null;
        s.holdDone = true;
        fire(binding.button, 'hold');
      }, holdMs);
    }
    if (binding.longHold) {
      s.longTimer = clock.setTimeout(() => {
        s.longTimer = null;
        s.longDone = true;
        fire(binding.button, 'long-hold');
      }, longHoldMs);
    }
  }

  function release(code) {
    if (code in MODIFIER_KIND) { downMods.delete(code); return; }
    const s = downKeys.get(code);
    if (!s) return;
    if (!s.binding) { downKeys.delete(code); return; } // ignored press (bounce or unbound)
    if (s.relTimer !== null) return; // already provisional
    const now = clock.now();
    // Contact bounce: a release this soon after the press is provisional. If the key is pressed again
    // within debounceMs of the press it was bounce and the press continues (hold timers keep running);
    // otherwise it resolves as the real release when the window ends. A tap-on-press button already fired.
    if ((s.binding.hold || s.binding.longHold) && now - s.at < debounceMs) {
      s.relTimer = clock.setTimeout(() => {
        s.relTimer = null;
        if (downKeys.get(code) === s) release(code);
      }, s.at + debounceMs - now);
      return;
    }
    downKeys.delete(code);
    lastRelease.set(code, now);
    const b = s.binding;
    if (!b.hold && !b.longHold) return;
    clearTimers(s);
    const elapsed = now - s.at;
    if (elapsed < holdMs) { fire(b.button, 'tap'); return; }
    if (b.hold && !s.holdDone) fire(b.button, 'hold');
    if (b.longHold && elapsed >= longHoldMs && !s.longDone) fire(b.button, 'long-hold');
  }

  return {
    key(code, value) {
      if (!Number.isInteger(code)) return;
      if (value === 1) press(code);
      else if (value === 0) release(code);
    },
    reset() {
      for (const s of downKeys.values()) if (s.binding) clearTimers(s);
      downKeys.clear();
      downMods.clear();
      lastRelease.clear();
    },
  };
}
