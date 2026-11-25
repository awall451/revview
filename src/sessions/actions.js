// What a wheel gesture does. See README.md ("Actions"). ONE controller for every gesture.
// Where a key or an answer goes is always the board's selection (selectedKey), re-verified against the runner's
// live windows right now; never anything a POSTed event could set. While a list or menu is open a gesture only
// navigates: it can never send a key or answer a permission request.
import { performance } from 'node:perf_hooks';
import { shownPrompt, shownAsk, selectedKey, boardView, sessionStarting, STARTING_PTT_NOTE } from '../state/index.js';

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

  // ---- CLAUDE ASKS (a question or a plan on the bar). Never a key for a question; only '2' for a plan.
  const askNote = (text) => note(text, 'ask');
  const TERMINAL_NOTE = 'Answer in the terminal when parked';
  const PLAN_TERMINAL_NOTE = 'Approve in the terminal when parked';
  const CHANGED_NOTE = 'Not sent: the question changed';
  const sameAsk = (a, b) => a !== null && b !== null && a.session === b.session && a.agent === b.agent
    && a.since === b.since && a.choice === b.choice;

  // the note for a registry refusal (too-early keeps its own kind)
  function refuseAsk(action, reason, terminalNote) {
    if (reason === 'too-early') note('Too early: press again', 'too-early');
    else if (reason === 'not-shown-long-enough' || reason === 'label-changed') askNote(CHANGED_NOTE);
    else if (reason === 'no-request') askNote('Not sent: the question is not waiting any more');
    else askNote(terminalNote);
    return out(action, false, reason ?? 'refused');
  }

  // the shared pre-checks of answerAsk and approvePlan; resolves { before, id, t } or { res } (the refusal)
  async function askTarget(action) {
    if (!runner) return { res: out(action, false, 'no sessions') };
    const before = shownAsk(getBoard());
    const id = selectedKey(getBoard());
    if (id === null || before === null) return { res: out(action, false, 'no session selected') };
    const t = await runner.target(id);
    if (!t) {
      askNote('Not sent: not a session revview started');
      return { res: out(action, false, 'no session selected') };
    }
    return { before, id, t };
  }
  // after an await: still the same question, the same choice, the same selection, no list open
  function stillAsked(action, before, id) {
    const board = getBoard();
    if (board.nav !== null || selectedKey(board) !== id) {
      askNote(CHANGED_NOTE);
      return { res: out(action, false, 'selection changed') };
    }
    const now = shownAsk(board);
    if (!sameAsk(before, now)) {
      askNote(CHANGED_NOTE);
      return { res: out(action, false, 'question changed') };
    }
    return { now };
  }
  const answeredAs = (now, decision) => apply({
    hook_event_name: 'RevviewAnswered', session_id: now.session, agent: now.agent, since: now.since, decision,
  });

  async function answerAsk(kind, opts = {}) {
    const g = await askTarget(kind);
    if (g.res) return g.res;
    const s = stillAsked(kind, g.before, g.id);
    if (s.res) return s.res;
    const { now } = s;
    const res = registry.answer(kind, now, g.t.id,
      kind === 'allow' ? { choice: now.choice, label: now.ask.options[now.choice] } : opts);
    if (res?.ok !== true) return refuseAsk(kind, res?.reason, TERMINAL_NOTE);
    answeredAs(now, kind);
    return out(kind, true);
  }

  const PLAN_LINES = [/Would you like to proceed\?/, /^\s*(?:❯\s*)?2\.\s+Yes, manually approve edits$/, /^\s*(?:❯\s*)?3\.\s+Tell Claude what to change$/];

  async function approvePlan() {
    const g = await askTarget('allow');
    if (g.res) return g.res;
    let s = stillAsked('allow', g.before, g.id);
    if (s.res) return s.res;
    const chk = registry.check(s.now, g.t.id);
    if (chk?.ok !== true) return refuseAsk('allow', chk?.reason, PLAN_TERMINAL_NOTE);
    let cap;
    try { cap = await runner.capture(g.id); } catch { cap = null; }
    if (cap?.ok !== true || !Array.isArray(cap.lines)) {
      askNote('Not sent: the terminal does not show the plan');
      return out('allow', false, cap?.reason ?? 'capture failed');
    }
    const lines = cap.lines.map((l) => String(l).trimEnd());
    if (!PLAN_LINES.every((re) => lines.some((l) => re.test(l)))) {
      askNote('Not sent: the terminal does not show the plan');
      return out('allow', false, 'plan not on screen');
    }
    s = stillAsked('allow', g.before, g.id);
    if (s.res) return s.res;
    const r = await runner.send('2', g.id);
    if (!r?.sent) {
      if (r?.reason === 'selected session gone') await refreshOwned();
      return out('allow', false, r?.reason ?? 'not sent');
    }
    answeredAs(s.now, 'allow');
    return out('allow', true);
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
      // a question or a plan on the bar (the "asks me" state): the buttons cannot answer it yet, and a press must not
      // open the list over it or allow the call without an answer; it is answered in the terminal
      if (boardView(b).view === 'asking') {
        const a = shownAsk(b);
        if (a === null) return out('allow', false, 'question shown');
        if (a.answer === 'terminal') {
          askNote(TERMINAL_NOTE);
          return out('allow', false, 'answer in terminal');
        }
        return a.answer === 'plan' ? approvePlan() : answerAsk('allow');
      }
      if (shownPrompt(b) !== null) return answer('allow');
      return navigate(button, gesture);
    }
    if (button === 'deny' && gesture === 'tap') {
      if (boardView(b).view === 'asking') {
        const a = shownAsk(b);
        if (a === null) return out('deny', false, 'question shown');
        return a.answer === 'plan' ? answerAsk('deny', { plan: true }) : answerAsk('deny');
      }
      return answer('deny');
    }
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
