// Input layer entry: a gesture pipeline (key events in, gestures out) and the device reader that feeds it.
import { createGestureDetector } from './gestures.js';
import { createDeviceReader } from './reader.js';
import { performance } from 'node:perf_hooks';
import { MODIFIER_KIND } from './keys.js';

// Monotonic arrival time. The kernel's event timestamps are NOT used: presses and hold timers must share
// one clock, and a timer can only be measured against the clock of the process that sets it.
export const realClock = Object.freeze({
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
});

export function createInputPipeline({ config, clock = realClock, onGesture }) {
  const det = createGestureDetector({
    bindings: config.bindings,
    timing: config.timing,
    clock,
    emit: (g) => onGesture?.(g),
  });
  return { feed: (code, value) => det.key(code, value), reset: () => det.reset() };
}

// onKey: optional observer called with every device key event before it is fed (lets a caller tell the
// device apart from another source feeding the same pipeline).
export function startInput({ config, onGesture, onPresence, onKey, log, clock, deps, retryMs }) {
  const pipeline = createInputPipeline({ config, clock, onGesture });
  const keys = [...new Set(config.bindings.map((b) => b.key).filter((k) => !(k in MODIFIER_KIND)))];
  const reader = createDeviceReader({
    device: config.device,
    keys,
    onKey: (code, value) => { onKey?.(code, value); pipeline.feed(code, value); },
    onSync: pipeline.reset,
    onLost: pipeline.reset,
    onPresence,
    deps,
    retryMs,
    log,
  });
  reader.start();
  return {
    stop() { reader.stop(); pipeline.reset(); },
    feed: pipeline.feed,
    reset: pipeline.reset,
  };
}
