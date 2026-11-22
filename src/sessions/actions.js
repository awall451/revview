// What a wheel gesture does to the chosen Claude session. See README.md ("Actions").
// Gestures run strictly one at a time. The target always comes from the runner (re-verified now),
// never from the board or from anything a POSTed event could set.
import { performance } from 'node:perf_hooks';
import { shownPrompt } from '../state/index.js';

export const CTRL_C_GAP_MS = 5000;

export function createActions({
  runner, registry, getBoard, apply, log = () => {}, clock = () => performance.now(), ctrlCGapMs = CTRL_C_GAP_MS,
}) {
  let lastCtrlC = null;
  let chain = Promise.resolve();

  const out = (action, done, reason) => {
    log(`action ${action}: ${done ? 'done' : `not done (${reason})`}`);
    return reason === undefined ? { action, done } : { action, done, reason };
  };

  // Send one key to the chosen session; `after(sent)` runs only when it was sent.
  async function send(action, key, after) {
    const r = await runner.send(key);
    if (!r?.sent) return out(action, false, r?.reason ?? 'not sent');
    after?.(r);
    return out(action, true);
  }

  const interrupted = (r) => apply({ hook_event_name: 'RevviewInterrupted', session_id: r.id });

  async function run(entry) {
    if (!entry || entry.dropped) return out('ignored', false, 'dropped');
    if (entry.source !== 'device' && entry.source !== 'bridge') return out('ignored', false, 'source');
    const { button, gesture } = entry;
    if (button === 'cancel' && gesture === 'tap') return send('cancel-escape', 'Escape', interrupted);
    if (button === 'cancel' && gesture === 'long-hold') {
      const now = clock();
      if (lastCtrlC !== null && now - lastCtrlC < ctrlCGapMs) return out('cancel-ctrl-c', false, 'ctrl-c too soon');
      return send('cancel-ctrl-c', 'C-c', (r) => {
        lastCtrlC = now;
        interrupted(r);
      });
    }
    if (button === 'push-to-talk' && gesture === 'tap') return send('push-to-talk', 'Space');
    if (gesture === 'tap' && (button === 'press' || button === 'deny')) {
      const kind = button === 'press' ? 'allow' : 'deny';
      const t = await runner.target();
      if (!t) return out(kind, false, 'no session chosen');
      // after the await: the board as it is at this instant
      const res = registry.answer(kind, shownPrompt(getBoard()), t.id);
      return out(kind, res?.ok === true, res?.ok === true ? undefined : res?.reason ?? 'refused');
    }
    return out('none', false, 'no action');
  }

  return {
    handle(entry) {
      const p = chain.then(() => run(entry)).catch((e) => out('error', false, String(e?.message ?? e)));
      chain = p;
      return p;
    },
  };
}
