import { boardView } from '../state/index.js';
import { startInput, createInputPipeline } from '../input/index.js';
import { loadConfig, DEFAULT_CONFIG_PATH } from '../input/keymap.js';

export const GESTURE_LOG_MAX = 32;

// Gestures: an in-memory log, never part of the board. Presses while the boot STARTING lasts are dropped, not
// queued. The booting flag matters (a POSTed RevviewStarting never sets it, nothing would end it): a placeholder session that shows 'starting' after the boot must not drop presses.
export function acceptGesture(ctx, { button, gesture, source }) {
  const entry = { button, gesture, source, at: Date.now(), dropped: ctx.board.booting === true && boardView(ctx.board).view === 'starting' };
  ctx.gestureLog.push(entry);
  if (ctx.gestureLog.length > GESTURE_LOG_MAX) ctx.gestureLog.shift();
  try {
    ctx.onGesture?.({ ...entry });
  } catch (e) {
    console.error('onGesture failed:', e);
  }
  // the actions never throw into the reader (handle() catches), the extra catch is a belt
  try {
    ctx.actions.handle({ ...entry }).catch((e) => console.error('action failed:', e));
  } catch (e) {
    console.error('action failed:', e);
  }
}

// The input reader and the dev bridge (sets ctx.lastSource, ctx.inputHandle, ctx.bridge).
export function setupInput(ctx, { inputDeps, inputRetryMs }) {
  // Source of the key event that is feeding the one detector (hold timers inherit the last one).
  ctx.lastSource = 'device';
  const gestureFromDetector = (g) => acceptGesture(ctx, { button: g.button, gesture: g.gesture, source: ctx.lastSource });
  ctx.inputHandle = null;
  if (ctx.input) {
    ctx.inputHandle = startInput({
      config: ctx.input,
      onGesture: gestureFromDetector,
      onPresence: (present) => ctx.apply({ hook_event_name: 'RevviewInput', present }, true),
      onKey: () => { ctx.lastSource = 'device'; },
      log: (m) => console.error(m),
      deps: inputDeps,
      retryMs: inputRetryMs,
    });
  }
  ctx.bridge = null;
  if (ctx.devBridge) {
    ctx.bridge = ctx.devKeys
      ? createInputPipeline({ config: ctx.devKeys, onGesture: gestureFromDetector })
      : ctx.inputHandle ?? createInputPipeline({ config: loadConfig(DEFAULT_CONFIG_PATH), onGesture: gestureFromDetector });
  }
}

export const buttonsHandler = (ctx, req, res) =>
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ buttons: boardView(ctx.board).buttons, gestures: ctx.gestureLog }));
