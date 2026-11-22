// What a wheel gesture does. See README.md ("Actions"). ONE controller for every gesture.
// Where a key or an answer goes is always the board's selection (selectedKey), re-verified against the runner's
// live windows right now; never anything a POSTed event could set. While a list or menu is open a gesture only
// navigates: it can never send a key or answer a permission request.
import { performance } from 'node:perf_hooks';
import { shownPrompt, selectedKey, boardView } from '../state/index.js';

export const CTRL_C_GAP_MS = 5000;
export const NAV_TIMEOUT_MS = 10000;

const NAV_BUTTONS = new Set(['up', 'down', 'left', 'right', 'menu', 'back']);

export function createActions({
  runner, registry, getBoard, apply, projects = [], log = () => {}, clock = () => performance.now(),
  ctrlCGapMs = CTRL_C_GAP_MS, timers = { setTimeout, clearTimeout }, navTimeoutMs = NAV_TIMEOUT_MS, onOwnedChanged,
}) {
  let lastCtrlC = null;
  let chain = Promise.resolve();
  let navTimer = null;

  const out = (action, done, reason) => {
    log(`action ${action}: ${done ? 'done' : `not done (${reason})`}`);
    return reason === undefined ? { action, done } : { action, done, reason };
  };

  const clearNavTimer = () => {
    if (navTimer !== null) timers.clearTimeout(navTimer);
    navTimer = null;
  };
  // an open list or menu closes by itself when nobody touches the wheel for navTimeoutMs
  const armNavTimer = () => {
    clearNavTimer();
    if (getBoard().nav === null) return;
    navTimer = timers.setTimeout(() => {
      navTimer = null;
      apply({ hook_event_name: 'RevviewNav', button: 'timeout' });
    }, navTimeoutMs);
    navTimer?.unref?.();
  };

  const navigate = (button, gesture) => {
    apply({ hook_event_name: 'RevviewNav', button, gesture });
    return out('nav', true);
  };

  // Send one key to the selected session; `after(sent)` runs only when it was sent.
  async function send(action, key, after) {
    if (!runner) return out(action, false, 'no sessions');
    const id = selectedKey(getBoard());
    if (id === null) return out(action, false, 'no session selected');
    const r = await runner.send(key, id);
    if (!r?.sent) return out(action, false, r?.reason ?? 'not sent');
    after?.(r);
    return out(action, true);
  }

  const interrupted = (r) => apply({ hook_event_name: 'RevviewInterrupted', session_id: r.id });

  async function answer(kind) {
    if (!runner) return out(kind, false, 'no sessions');
    const id = selectedKey(getBoard());
    if (id === null) return out(kind, false, 'no session selected');
    const t = await runner.target(id);
    if (!t) return out(kind, false, 'no session selected');
    // after the await: the board as it is at this instant. A selection change or an open list refuses.
    const board = getBoard();
    if (board.nav !== null || selectedKey(board) !== id) return out(kind, false, 'selection changed');
    const shown = shownPrompt(board);
    const res = registry.answer(kind, shown, t.id);
    // the answered prompt leaves the bar at once (exactly that one), not only at PostToolUse
    if (res?.ok === true) {
      apply({ hook_event_name: 'RevviewAnswered', session_id: shown.session, agent: shown.agent, since: shown.since, decision: kind });
    }
    return out(kind, res?.ok === true, res?.ok === true ? undefined : res?.reason ?? 'refused');
  }

  async function newSession(b) {
    if (!runner) return out('new-session', false, 'no sessions');
    const nav = boardView(b).nav;
    const path = projects[nav.row];
    if (typeof path !== 'string' || nav.rows[nav.row]?.label !== path) return out('new-session', false, 'no such project');
    apply({ hook_event_name: 'RevviewNav', button: 'press', gesture: 'tap' }); // closes the list
    let s;
    try {
      s = await runner.start({ cwd: path });
    } catch (e) {
      return out('new-session', false, String(e?.message ?? e));
    }
    // the board selects it when its first hook event arrives
    apply({ hook_event_name: 'RevviewSelect', session_id: s.id });
    try { onOwnedChanged?.(); } catch (e) { log(`owned refresh failed: ${String(e?.message ?? e)}`); }
    return out('new-session', true);
  }

  async function dispatch(button, gesture) {
    const b = getBoard();
    if (b.nav !== null) {
      if (button === 'press' && gesture === 'tap' && b.nav.kind === 'new') return newSession(b);
      return navigate(button, gesture);
    }
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
    if (button === 'press' && gesture === 'tap') {
      // a prompt on the bar: allow attempt only (a refusal never falls through to the list)
      if (shownPrompt(b) !== null) return answer('allow');
      return navigate(button, gesture);
    }
    if (button === 'deny' && gesture === 'tap') return answer('deny');
    if (NAV_BUTTONS.has(button)) return navigate(button, gesture);
    return out('none', false, 'no action');
  }

  async function run(entry) {
    if (!entry || entry.dropped) return out('ignored', false, 'dropped');
    if (entry.source !== 'device' && entry.source !== 'bridge') return out('ignored', false, 'source');
    try {
      return await dispatch(entry.button, entry.gesture);
    } finally {
      armNavTimer();
    }
  }

  return {
    handle(entry) {
      const p = chain.then(() => run(entry)).catch((e) => out('error', false, String(e?.message ?? e)));
      chain = p;
      return p;
    },
    close() {
      clearNavTimer();
    },
  };
}
