// What a wheel gesture does. See README.md ("Actions"). ONE controller for every gesture.
// Where a key or an answer goes is always the board's selection (selectedKey), re-verified against the runner's
// live windows right now; never anything a POSTed event could set. While a list or menu is open a gesture only
// navigates: it can never send a key or answer a permission request.
import { performance } from 'node:perf_hooks';
import { shownPrompt, selectedKey, boardView, sessionStarting, STARTING_PTT_NOTE } from '../state/index.js';

export const PROMPT_PTT_NOTE = 'Answer the prompt first';

export const CTRL_C_GAP_MS = 5000;
export const NAV_TIMEOUT_MS = 10000;

const NAV_BUTTONS = new Set(['up', 'down', 'left', 'right', 'menu', 'back']);

export function createActions({
  runner, registry, getBoard, apply, projects = [], log = () => {}, clock = () => performance.now(),
  ctrlCGapMs = CTRL_C_GAP_MS, timers = { setTimeout, clearTimeout }, navTimeoutMs = NAV_TIMEOUT_MS, onOwnedChanged, readAloud = null,
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

  // resolves when the refresh is done (the callback may return a promise); never rejects
  const refreshOwned = async () => {
    try { await onOwnedChanged?.(); } catch (e) { log(`owned refresh failed: ${String(e?.message ?? e)}`); }
  };
  // a fixed text only: an error message never reaches the screen
  // (kind: see NOTE_RULES in src/state/board.js; absent = plain, a note no rule but the next gesture clears)
  const note = (text, kind) => apply({ hook_event_name: 'RevviewNote', note: text, ...(kind ? { kind } : {}) });

  // Send one key to the selected session; `after(sent)` runs only when it was sent.
  async function send(action, key, after) {
    if (!runner) return out(action, false, 'no sessions');
    const id = selectedKey(getBoard());
    if (id === null) return out(action, false, 'no session selected');
    const r = await runner.send(key, id);
    if (!r?.sent) {
      if (r?.reason === 'selected session gone') await refreshOwned();
      return out(action, false, r?.reason ?? 'not sent');
    }
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
    // only the too-early refusal says so on the bar (QA r4-07); every other refusal stays silent
    if (res?.ok !== true && res?.reason === 'too-early') note('Too early: press again', 'too-early');
    return out(kind, res?.ok === true, res?.ok === true ? undefined : res?.reason ?? 'refused');
  }

  async function newSession(b) {
    if (!runner) return out('new-session', false, 'no sessions');
    const nav = boardView(b).nav;
    const path = projects[nav.row];
    if (typeof path !== 'string' || nav.rows[nav.row]?.label !== path) {
      note('New session not started: no such project');
      return out('new-session', false, 'no such project');
    }
    apply({ hook_event_name: 'RevviewNav', button: 'press', gesture: 'tap' }); // closes the list
    let s;
    try {
      s = await runner.start({ cwd: path });
    } catch (e) {
      const msg = String(e?.message ?? e);
      note(msg.startsWith('cwd is not an existing directory')
        ? 'New session not started: project folder missing'
        : msg.startsWith('data is locked') ? 'New session not started: data locked, insert the key stick'
          : 'New session not started: see the server log');
      return out('new-session', false, msg);
    }
    // the owned refresh puts it on the board (quiet, until its first hook event) and the want selects it
    apply({ hook_event_name: 'RevviewSelect', session_id: s.id });
    await refreshOwned();
    return out('new-session', true);
  }

  // speech stops first, and is awaited: the mic must not hear it. Never throws.
  async function stopSpeech() {
    try { await readAloud.stop(); } catch (e) { log(`read aloud stop failed: ${String(e?.message ?? e)}`); }
  }

  // read aloud never sends a key and never answers a permission request
  async function speakSelected() {
    const board = getBoard();
    const id = selectedKey(board);
    if (id === null) return out('read-aloud', false, 'no session selected');
    const r = await readAloud.speakFor(board, id);
    if (r?.reason === 'no engine') note('Read aloud: no speech engine installed');
    return out('read-aloud', r?.spoken === true, r?.spoken === true ? undefined : r?.reason ?? 'not spoken');
  }

  async function dispatch(button, gesture) {
    if (readAloud && button === 'push-to-talk') await stopSpeech();
    if (button === 'read-aloud' && (gesture === 'hold' || gesture === 'long-hold')) {
      if (!readAloud) return out('read-aloud-stop', false, 'no speech');
      await stopSpeech();
      return out('read-aloud-stop', true);
    }
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
    if (button === 'read-aloud' && gesture === 'tap' && readAloud) return speakSelected();
    if (button === 'push-to-talk' && gesture === 'tap') {
      // Claude is still loading (the boot STARTING, or a session revview just started with no hook yet): drop it
      if (!b.locked && sessionStarting(b, selectedKey(b))) {
        note(STARTING_PTT_NOTE, 'starting-ptt');
        return out('push-to-talk', false, 'session starting');
      }
      // a permission prompt is waiting on the selected session (any agent): Space would land in the terminal dialog
      // as a keypress, not as push-to-talk. The dialog stays answerable by keys while the hook waits (fixtures/buttons).
      // (without a runner nothing could be sent anyway: that stays "no sessions")
      if (runner && b.sessions[selectedKey(b)]?.pending?.length > 0) {
        note(PROMPT_PTT_NOTE, 'answer-prompt');
        return out('push-to-talk', false, 'permission prompt shown');
      }
      // no session selected: the tap goes nowhere, and an "... ended" note must not hide the line that says so
      if (runner && selectedKey(b) === null) apply({ hook_event_name: 'RevviewNoSessionPress' });
      return send('push-to-talk', 'Space');
    }
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
