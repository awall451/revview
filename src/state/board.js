// Pure board layer: many sessions + overlays -> the flat state the page renders.
// No clock, I/O or timers; never throws; returns the SAME reference when nothing changes.
import { initialState, isDriverPrompt, reduce } from './reducer.js';

export const MAX_SESSIONS = 8; // the band hint "+N" has room for one digit
// Ids of ended sessions are remembered so that a late hook cannot resurrect one. The list is bounded; an id
// that fell off it (more than MAX_ENDED later SessionEnds) can be resurrected by a late event: see "not solved"
// in docs/DECISIONS.md. 256 ids of 36 bytes are a few KB.
const MAX_ENDED = 256;

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isStr = (x) => typeof x === 'string' && x !== '';
const has = (o, k) => Object.hasOwn(o, k);

export function initialBoard() {
  return {
    phase: 'unknown',
    offline: false,
    locked: false,
    context: { repo: null, branch: null },
    sessions: {},
    ended: [],
    tick: 0,
    focus: null,
    spokenTo: null,
    buttons: null, // wheel buttons present: null = not known yet, true, false (RevviewInput)
    selected: null, // the session the driver chose (live id or null); null = the old heuristics decide
    want: null, // a session revview started that is not on the board yet: selected when it first appears
    owned: null, // ids of sessions revview owns (its tmux windows); null = the server runs without sessions
    nav: null, // null (normal view) or {kind, row[, id]}: a list/menu the driver has open; a list also holds the highlighted session id
    note: null, // a one-line message for the bottom note row (null = none); cleared by the driver's next gesture
    projects: [], // project paths from the config file (display only)
  };
}

const NAV_KINDS = ['list', 'menu', 'new', 'projects', 'settings'];
const MENU_ROWS = ['New session', 'Projects', 'Settings'];
const SETTINGS_ROWS = 4;

function isValidSession(s) {
  return isObj(s) && isObj(s.state) && typeof s.state.activity === 'string' && isObj(s.state.diff)
    && Array.isArray(s.open) && Array.isArray(s.pending) && Array.isArray(s.pre) && Number.isInteger(s.touched) && Number.isInteger(s.born) && typeof s.dropped === 'boolean';
}

// Only boards this module built are used; anything else is replaced, so nothing below can throw on it.
function isValidBoard(b) {
  return isObj(b) && typeof b.phase === 'string' && isObj(b.context) && isObj(b.sessions)
    && Array.isArray(b.ended) && Number.isInteger(b.tick) && (b.focus === null || typeof b.focus === 'string')
    && (b.spokenTo === null || typeof b.spokenTo === 'string')
    && (b.buttons === null || typeof b.buttons === 'boolean')
    && (b.selected === null || typeof b.selected === 'string') && (b.want === null || typeof b.want === 'string')
    && (b.owned === null || (Array.isArray(b.owned) && b.owned.every((x) => typeof x === 'string')))
    && (b.nav === null || (isObj(b.nav) && NAV_KINDS.includes(b.nav.kind) && Number.isInteger(b.nav.row) && b.nav.row >= 0
      && (b.nav.id === undefined || typeof b.nav.id === 'string')))
    && (b.note === undefined || b.note === null || typeof b.note === 'string')
    && Array.isArray(b.projects) && b.projects.every((x) => typeof x === 'string')
    && Object.keys(b.sessions).every((k) => isValidSession(b.sessions[k]));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const keyOf = (event) => (isStr(event.session_id) ? event.session_id : '');

// An event without a usable session_id belongs to the one live session when there is exactly one (hand-posted
// or old-style hooks must not make a second session and a false "+1"); otherwise to the anonymous '' session.
// A quiet placeholder (known only from RevviewOwned, no hook seen yet) is never a target: a local process
// posting an id-less event must not be able to show a forged prompt on a session that has said nothing.
function targetOf(event, sessions) {
  if (isStr(event.session_id)) return event.session_id;
  const real = Object.keys(sessions).filter((k) => k !== '' && sessions[k].quiet !== true);
  return real.length === 1 ? real[0] : '';
}

// Session maps use own properties only, so ids like `__proto__` are plain keys.
function withSession(sessions, id, value) {
  const out = {};
  for (const k of Object.keys(sessions)) Object.defineProperty(out, k, { value: sessions[k], enumerable: true, writable: true, configurable: true });
  Object.defineProperty(out, id, { value, enumerable: true, writable: true, configurable: true });
  return out;
}

function withoutSession(sessions, id) {
  const out = {};
  for (const k of Object.keys(sessions)) {
    if (k !== id) Object.defineProperty(out, k, { value: sessions[k], enumerable: true, writable: true, configurable: true });
  }
  return out;
}

function mapSessions(sessions, fn) {
  let out = sessions;
  for (const k of Object.keys(sessions)) {
    const next = fn(sessions[k]);
    if (next !== sessions[k]) out = withSession(out, k, next);
  }
  return out;
}

function pushEnded(ended, id) {
  return [...ended.filter((x) => x !== id), id].slice(-MAX_ENDED);
}

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const PRIORITY = { permission: 4, waiting: 3, working: 2, done: 1 };
// Effective activity: an unanswered permission prompt (any agent of the session) wins over the turn's activity.
const act = (s) => (s.pending.length > 0 ? 'permission' : s.state.activity);
const need = (s) => PRIORITY[act(s)] ?? 0;

// Over the cap, drop the session that needs the driver least (unknown/starting, done, working, waiting), the
// least recently touched among equals; the focus session goes last. A session with a pending permission prompt
// is never dropped: a pending prompt must not vanish. If every other session needs permission the newcomer is
// still admitted and the cap is exceeded (the hint "+N" may then have two digits); showing every prompt beats
// a tidy count.
function capSessions(sessions, keepId, focus, selected, want, owned = null) {
  let out = sessions;
  while (Object.keys(out).length > MAX_SESSIONS) {
    let victim = null;
    const candidates = Object.keys(out).filter((k) => k !== keepId && k !== selected && k !== want && act(out[k]) !== 'permission');
    // sessions revview owns are dropped only when no other candidate is left
    const others = owned === null ? candidates : candidates.filter((k) => !owned.includes(k));
    for (const k of others.length > 0 ? others : candidates) {
      if (victim === null) { victim = k; continue; }
      const kFocus = k === focus;
      const vFocus = victim === focus;
      if (kFocus !== vFocus ? vFocus : (need(out[k]) < need(out[victim])
        || (need(out[k]) === need(out[victim]) && out[k].touched < out[victim].touched))) victim = k;
    }
    if (victim === null) break;
    out = withoutSession(out, victim);
  }
  return out;
}

// Which session the bar shows. Rules in order: none live -> null; a pending permission prompt pre-empts (keep
// the focus if it has one, else the one asked first); once the last prompt is answered (`restore`) the bar goes
// back to the session the driver last spoke to (`spokenTo`) if it is still live; the session the driver just
// spoke to; a dead focus falls
// back to the busiest (working > done > waiting > rest, most recently touched); a focus that is idle or
// unknown gives way to a working session; else keep it (sticky: other sessions' events never move it).
function pickFocus(b, spoke, restore = false) {
  const ids = Object.keys(b.sessions);
  if (ids.length === 0) return null;
  const sess = (k) => b.sessions[k];
  const asking = ids.filter((k) => sess(k).pending.length > 0);
  if (asking.length > 0) {
    if (b.focus !== null && asking.includes(b.focus)) return b.focus;
    return asking.reduce((best, k) => (sess(k).pending[0].since < sess(best).pending[0].since ? k : best));
  }
  if (spoke !== null && has(b.sessions, spoke)) return spoke;
  if (restore && b.spokenTo !== null && has(b.sessions, b.spokenTo)) return b.spokenTo;
  const touchedMax = (list) => list.reduce((best, k) => (sess(k).touched > sess(best).touched ? k : best));
  if (b.focus === null || !has(b.sessions, b.focus)) {
    const rank = (k) => ({ working: 3, done: 2, waiting: 1 })[act(sess(k))] ?? 0;
    const top = Math.max(...ids.map(rank));
    return touchedMax(ids.filter((k) => rank(k) === top));
  }
  const a = act(sess(b.focus));
  if (a !== 'working' && a !== 'done') {
    const working = ids.filter((k) => k !== b.focus && act(sess(k)) === 'working');
    if (working.length > 0) return touchedMax(working);
  }
  return b.focus;
}

function withContext(board, patch) {
  const context = { ...board.context, ...patch };
  return context.repo === board.context.repo && context.branch === board.context.branch ? board : { ...board, context };
}

export function reduceBoard(board, event) {
  const b = isValidBoard(board) ? board : initialBoard();
  if (!isObj(event) || typeof event.hook_event_name !== 'string') return b;
  let next = reduceInner(b, event);
  if (event.hook_event_name === 'RevviewNav' && typeof next.note === 'string') next = { ...next, note: null };
  const tid = targetOf(event, b.sessions);
  const spoke = isDriverPrompt(event) && has(next.sessions, tid) ? tid : null;
  // a driver prompt that changes nothing else (the session was already working) still moves the focus
  if (next === b && spoke === null) return b;
  // `spokenTo` is set by real driver prompts only (never the injected ones) and kept while that session is live
  const spokenTo = spoke !== null ? spoke : next.spokenTo !== null && has(next.sessions, next.spokenTo) ? next.spokenTo : null;
  const base = spokenTo === next.spokenTo ? next : { ...next, spokenTo };
  const asked = (x) => Object.keys(x.sessions).some((k) => x.sessions[k].pending.length > 0);
  let cur = base;
  // a session revview started appears on the board: the driver gets it
  if (cur.want !== null && has(cur.sessions, cur.want) && cur.want !== '') cur = { ...cur, selected: cur.want, want: null };
  // the selected session ended (or was dropped): fall to the neediest
  if (cur.selected !== null && !has(cur.sessions, cur.selected)) cur = { ...cur, selected: homeKey(cur) };
  // an open list highlights a session, not a row: the highlight follows it, and a list whose session ended closes
  if (cur.nav !== null && cur.nav.kind === 'list' && typeof cur.nav.id === 'string') {
    const at = orderOf(cur).indexOf(cur.nav.id);
    if (at < 0) cur = { ...cur, nav: null, note: 'Highlighted session ended: list closed' };
    else if (at !== cur.nav.row) cur = { ...cur, nav: { ...cur.nav, row: at } };
  }
  const focus = cur.selected !== null ? cur.selected : pickFocus(cur, spoke, asked(b) && !asked(cur));
  return focus === cur.focus ? cur : { ...cur, focus };
}

// Live sessions in the order the driver steps through them: not the anonymous '' one, oldest first.
function orderOf(b) {
  return Object.keys(b.sessions).filter((k) => k !== '').sort((x, y) => (b.sessions[x].born - b.sessions[y].born) || (x < y ? -1 : x > y ? 1 : 0));
}

export function sessionOrder(board) {
  return orderOf(isValidBoard(board) ? board : initialBoard());
}

const HOME_RANK = { permission: 4, waiting: 3, done: 2, working: 1 };

// The session that needs the driver most: permission, waiting, done, working; the oldest ask first among equals.
function homeOf(b) {
  let best = null;
  let bestRank = -1;
  let bestAge = 0;
  for (const k of orderOf(b)) {
    const s = b.sessions[k];
    const rank = HOME_RANK[act(s)] ?? 0;
    const age = s.pending.length > 0 ? s.pending[0].since : s.touched;
    if (rank > bestRank || (rank === bestRank && age < bestAge)) { best = k; bestRank = rank; bestAge = age; }
  }
  return best;
}

export function homeKey(board) {
  return homeOf(isValidBoard(board) ? board : initialBoard());
}

const selectedOf = (b) => (b.selected !== null && b.selected !== '' && has(b.sessions, b.selected) ? b.selected : null);

export function selectedKey(board) {
  return selectedOf(isValidBoard(board) ? board : initialBoard());
}

const NAV_BUTTONS = new Set(['push-to-talk', 'read-aloud', 'cancel', 'deny', 'up', 'down', 'left', 'right', 'press', 'back', 'menu', 'spare', 'timeout']);
const NAV_GESTURES = new Set(['tap', 'hold', 'long-hold']);

function navRows(b, kind) {
  if (kind === 'list') return orderOf(b).length;
  if (kind === 'menu') return MENU_ROWS.length;
  if (kind === 'settings') return SETTINGS_ROWS;
  return b.projects.length;
}
const clampRow = (row, rows) => (rows === 0 ? 0 : Math.min(row, rows - 1));

// Select `id` (or keep) and set nav; the same board when nothing changes. A driver's choice of a session drops a
// pending `want` (the driver chose something else); moving around a list or menu keeps it.
function withNav(b, selected, nav) {
  const same = nav === b.nav || (nav !== null && b.nav !== null && nav.kind === b.nav.kind && nav.row === b.nav.row && nav.id === b.nav.id);
  const want = selected === b.selected ? b.want : null;
  if (selected === b.selected && want === b.want && same) return b;
  return { ...b, selected, want, nav: same ? b.nav : nav };
}

function goHome(b) {
  const home = homeOf(b);
  return withNav(b, home === null ? b.selected : home, null);
}

function reduceNav(b, event) {
  const button = event.button;
  if (typeof button !== 'string' || !NAV_BUTTONS.has(button)) return b;
  if (button === 'timeout') return b.nav === null ? b : { ...b, nav: null };
  const gesture = event.gesture;
  if (!NAV_GESTURES.has(gesture)) return b;
  const tap = gesture === 'tap';
  const order = orderOf(b);
  const n = order.length;

  if (b.nav === null) {
    if (tap && (button === 'left' || button === 'right')) {
      if (n === 0) return b;
      const from = selectedOf(b) ?? shownKeyOf(b);
      const i = order.indexOf(from);
      const to = i < 0 ? (button === 'left' ? n - 1 : 0) : (i + (button === 'left' ? -1 : 1) + n) % n;
      return withNav(b, order[to], null);
    }
    if (button === 'back' && gesture === 'hold') return goHome(b);
    if (tap && (button === 'up' || button === 'down' || button === 'press')) {
      const row = Math.max(0, order.indexOf(shownKeyOf(b)));
      return { ...b, nav: n > 0 ? { kind: 'list', row, id: order[row] } : { kind: 'list', row } };
    }
    if (tap && button === 'menu') return { ...b, nav: { kind: 'menu', row: 0 } };
    return b;
  }

  const { kind } = b.nav;
  const rows = navRows(b, kind);
  const at = kind === 'list' && typeof b.nav.id === 'string' ? order.indexOf(b.nav.id) : -1; // the highlight follows its session
  const row = at >= 0 ? at : clampRow(b.nav.row, rows);
  const to = (r) => (kind === 'list' && order[r] !== undefined ? { kind, row: r, id: order[r] } : { kind, row: r });
  const go = (nav) => withNav(b, b.selected, nav);
  if (button === 'back' && gesture === 'hold') return goHome(b);
  if (tap && button === 'menu') return go(kind === 'list' ? { kind: 'menu', row: 0 } : null);
  if (tap && button === 'up') return go(to(Math.max(0, row - 1)));
  if (tap && button === 'down') return go(to(clampRow(row + 1, rows)));
  if (tap && button === 'back') {
    if (kind === 'new') return go({ kind: 'menu', row: 0 });
    if (kind === 'projects') return go({ kind: 'menu', row: 1 });
    if (kind === 'settings') return go({ kind: 'menu', row: 2 });
    return go(null);
  }
  if (tap && button === 'press') {
    if (kind === 'list') return n > 0 ? withNav(b, order[row], null) : go(null);
    if (kind === 'menu') return go({ kind: ['new', 'projects', 'settings'][row], row: 0 });
    if (kind === 'new') return go(null);
  }
  return b;
}

function reduceInner(b, event) {
  const name = event.hook_event_name;
  const id = keyOf(event);
  const live = has(b.sessions, id) ? b.sessions[id] : null;
  const tid = targetOf(event, b.sessions); // session an id-less event is routed to (SessionEnd and hooks)
  const tlive = has(b.sessions, tid) ? b.sessions[tid] : null;

  switch (name) {
    case 'RevviewNetwork':
      return typeof event.online === 'boolean' && b.offline === event.online ? { ...b, offline: !event.online } : b;
    case 'RevviewDataLock':
      return typeof event.locked === 'boolean' && b.locked !== event.locked ? { ...b, locked: event.locked } : b;
    case 'RevviewInput':
      return typeof event.present === 'boolean' && b.buttons !== event.present ? { ...b, buttons: event.present } : b;
    case 'RevviewInterrupted': { // revview sent Esc / Ctrl+C itself; Claude Code fires no hook for it
      if (!isStr(event.session_id) || live === null) return b;
      if (act(live) !== 'working' && act(live) !== 'permission') return b;
      // like an interrupt: waiting for the driver, last tool/command/file/diff kept, dialogs rejected by the Esc
      const st = live.state;
      const state = { ...st, activity: 'waiting', view: st.locked ? 'insert-key' : st.offline ? 'offline' : 'waiting' };
      const tick = b.tick + 1;
      return { ...b, tick, sessions: withSession(b.sessions, id, { ...live, state, open: [], pending: [], pre: [], touched: tick }) };
    }
    case 'RevviewAnswered': { // revview itself answered one permission request (allow or deny) through the hook
      // Clears exactly that prompt (session, agent, board tick `since`) so it leaves the bar now, not at
      // PostToolUse. Nothing else changes: the state is whatever it was (working in a turn), Stop ends it.
      if (!isStr(event.session_id) || live === null || (typeof event.agent !== 'string' && event.agent !== null)) return b;
      if (typeof event.since !== 'number' || (event.decision !== 'allow' && event.decision !== 'deny')) return b;
      const kept = live.pending.filter((p) => !(p.since === event.since && p.agent === event.agent));
      if (kept.length === live.pending.length) return b;
      const gone = live.pending.find((p) => p.since === event.since && p.agent === event.agent);
      const answer = { decision: event.decision, tool: gone.tool, file: gone.file, command: gone.command };
      const tick = b.tick + 1;
      return { ...b, tick, sessions: withSession(b.sessions, id, { ...live, pending: kept, answer, touched: tick }) };
    }
    case 'RevviewButton': // a gesture is for the server's actions, never for the screen
      return b;
    case 'RevviewStarting': {
      // the sessions are forgotten, the driver's choice is not: it becomes `want`, so the same session is selected
      // again when its events come back (a posted RevviewStarting can blank the bar, never redirect a button)
      const want = b.want ?? b.selected;
      if (b.phase === 'starting' && b.ended.length === 0 && Object.keys(b.sessions).length === 0
        && b.selected === null && b.want === want && b.nav === null) return b;
      return { ...b, phase: 'starting', sessions: {}, ended: [], selected: null, want, nav: null };
    }
    case 'RevviewSelect': {
      if (!isStr(event.session_id)) return b;
      const sid = event.session_id;
      if (orderOf(b).includes(sid)) return b.selected === sid && b.want === null && !b.note ? b : { ...b, selected: sid, want: null, note: null };
      return b.want === sid && !b.note ? b : { ...b, want: sid, note: null };
    }
    case 'RevviewOwned': {
      const ids = event.ids;
      if (!Array.isArray(ids) || ids.length > 64 || !ids.every((x) => isStr(x) && x.length <= 200)) return b;
      const names = Array.isArray(event.names) && event.names.length === ids.length ? event.names : null;
      const nameOf = new Map();
      ids.forEach((id, i) => {
        const n = names === null ? null : names[i];
        // display text only: a name with control characters or an absurd length is not shown at all
        const ok = typeof n === 'string' && n.length >= 1 && n.length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(n);
        if (!nameOf.has(id)) nameOf.set(id, ok ? n.trim().slice(0, 64) || null : null);
      });
      const owned = [...new Set(ids)];
      // one tick per placeholder, in owned order, so the list order (born) follows the order revview started them
      let tick = b.tick;
      let sessions = b.sessions;
      for (const id of Object.keys(b.sessions)) {
        if (b.sessions[id].quiet === true && !owned.includes(id)) sessions = withoutSession(sessions, id);
      }
      for (const id of owned) {
        if (!UUID.test(id) || has(sessions, id) || b.ended.includes(id)) continue;
        tick += 1;
        sessions = withSession(sessions, id, {
          state: { ...initialState(), repo: nameOf.get(id) ?? null }, open: [], pending: [], pre: [], touched: tick, born: tick, dropped: false, quiet: true,
        });
      }
      const same = b.owned !== null && owned.length === b.owned.length && owned.every((x) => b.owned.includes(x));
      if (same && sessions === b.sessions) return b;
      sessions = capSessions(sessions, null, b.selected ?? b.focus, b.selected, b.want, owned);
      return { ...b, owned, sessions, tick };
    }
    case 'RevviewProjects': {
      const paths = event.paths;
      if (!Array.isArray(paths) || paths.length > 32 || !paths.every((x) => typeof x === 'string' && x.length <= 4096)) return b;
      if (sameList(paths, b.projects)) return b;
      const rowsChanged = b.nav !== null && (b.nav.kind === 'new' || b.nav.kind === 'projects');
      return { ...b, projects: [...paths], nav: rowsChanged ? null : b.nav };
    }
    case 'RevviewNote': {
      const note = event.note;
      return typeof note === 'string' && note.length >= 1 && note.length <= 120 && note !== b.note ? { ...b, note } : b;
    }
    case 'RevviewNav':
      return reduceNav(b, event); // a button gesture clears the note (see reduceBoard)
    case 'RevviewContext': {
      if (live !== null && isStr(event.session_id)) {
        const state = reduce(live.state, event);
        return state === live.state ? b : { ...b, sessions: withSession(b.sessions, id, { ...live, state }) };
      }
      const next = reduce(initialState(), event);
      const patch = {};
      if (next.repo !== null) patch.repo = next.repo;
      if (typeof event.branch === 'string' || event.branch === null) patch.branch = event.branch;
      return withContext(b, patch);
    }
    case 'RevviewDropped': {
      // an id the board does not know marks nothing (it is none of the sessions on the board)
      if (isStr(event.session_id) && live === null) return b;
      // without an id the lost Edit/Write came from a session that is in a turn (working, asking, a tool open);
      // if none is, from the shown one (a late result after Stop). Never from every session on the board.
      const live1 = isStr(event.session_id) && live !== null;
      let hit = (s) => s === live;
      if (!live1) {
        const inTurn = (s) => act(s) === 'working' || act(s) === 'permission' || s.open.length > 0;
        const some = Object.keys(b.sessions).some((k) => inTurn(b.sessions[k]));
        const shownKey = shownKeyOf(b);
        hit = some ? inTurn : (s) => shownKey !== null && s === b.sessions[shownKey];
      }
      const sessions = mapSessions(b.sessions, (s) => (s.dropped || !hit(s) ? s : { ...s, dropped: true }));
      return sessions === b.sessions ? b : { ...b, sessions };
    }
    case 'SessionEnd': {
      // revview's own tmux window for this id still exists (RevviewOwned): a placeholder ignores the end, and a
      // live session that ends is not remembered as ended, so the window's next hook or placeholder still shows
      const stillOwned = tid !== '' && b.owned !== null && b.owned.includes(tid);
      if (tlive !== null && tlive.quiet === true && stillOwned) return b;
      if (stillOwned) return tlive === null ? b : endSession(b, tlive, tid, b.ended);
      if (tlive === null) {
        // a session the board never saw ended: it proves nothing about the phase (the others may still run)
        return tid === '' || b.ended.includes(tid) ? b : { ...b, ended: pushEnded(b.ended, tid) };
      }
      // the anonymous session ('') is never remembered as ended, so later id-less events still count
      return endSession(b, tlive, tid, tid === '' ? b.ended : pushEnded(b.ended, tid));
    }
    default:
      break;
  }

  if (name !== 'SessionStart' && b.ended.includes(tid)) return b;
  return applyToSession(b, tlive, tid, event);
}

function endSession(b, tlive, tid, ended) {
  const sessions = withoutSession(b.sessions, tid);
  if (Object.keys(sessions).length > 0) return { ...b, sessions, ended };
  const repo = tlive.state.repo !== null ? tlive.state.repo : b.context.repo;
  const branch = tlive.state.branch !== null ? tlive.state.branch : b.context.branch;
  return { ...b, sessions, ended, phase: 'ended', context: { repo, branch } };
}

const DIFF_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const POST = new Set(['PostToolUse', 'PostToolUseFailure']);
const PERMISSION_TYPES = new Set(['permission_prompt', 'worker_permission_prompt']);

const MAX_PRE = 32;
const MAX_CLOSED = 64; // tool_use_ids closed by a Post, kept to recognise a duplicate Post
// A comparable signature of a tool input ('' when there is none).
const sig = (x) => {
  try {
    const j = isObj(x) ? JSON.stringify(x) : '';
    return j.length > 4096 ? `${j.slice(0, 4096)}#${j.length}` : j;
  } catch { return ''; }
};

const withoutPending = (pending, drop) => {
  const kept = pending.filter((p) => !drop(p));
  return kept.length === pending.length ? pending : kept;
};

// a missing list counts as "no subagents running", as in reducer.js
const runningAgent = (event, agent) => Array.isArray(event.background_tasks) && event.background_tasks.some((t) => isObj(t) && t.id === agent && t.status === 'running');

// Pending permission prompts after `event` (arrays keep their reference when nothing changes).
function pendingAfter(pending, event, agent, toolUseId) {
  const name = event.hook_event_name;
  // An entry not tied to a call is cleared by any later tool event of the same agent (generic entries: of the
  // main thread): an agent with an open dialog neither starts nor finishes other calls. A tied entry may be one
  // of several parallel calls, so only its own Post/Denied clears it.
  const sameAgent = (p) => p.tuid === null && (p.agent === agent || (p.agent === null && agent === ''));
  if (POST.has(name) || name === 'PermissionDenied') {
    return withoutPending(pending, (p) => (toolUseId !== null && p.tuid === toolUseId) || sameAgent(p));
  }
  if (name === 'PreToolUse' && toolUseId !== null && isStr(event.tool_name)) {
    return withoutPending(pending, (p) => sameAgent(p));
  }
  if (name === 'SubagentStop') return isStr(event.agent_id) ? withoutPending(pending, (p) => p.agent === event.agent_id) : pending;
  if (name === 'Stop') {
    return withoutPending(pending, (p) => p.agent === '' || p.agent === null
      || !runningAgent(event, p.agent));
  }
  // idle_prompt is only sent when Claude Code is not loading and no dialog is open (2.1.330 binary), so a
  // main-thread prompt still pending was dismissed (Esc); a subagent's may still be open
  if (name === 'Notification' && event.notification_type === 'idle_prompt') {
    return withoutPending(pending, (p) => p.agent === '' || p.agent === null);
  }
  if (isDriverPrompt(event)) return withoutPending(pending, (p) => p.agent === '' || p.agent === null);
  return pending;
}

function applyToSession(b, live, id, event) {
  const name = event.hook_event_name;
  const prev = live === null ? initialState() : live.state;
  const prevOpen = live === null ? [] : live.open;
  const prevPending = live === null ? [] : live.pending;
  const prevPre = live === null ? [] : live.pre;
  const toolUseId = isStr(event.tool_use_id) ? event.tool_use_id : null;
  const agent = isStr(event.agent_id) ? event.agent_id : '';
  // a Post whose call an earlier Post already closed is a duplicate delivery (hook configured twice, a retry):
  // it adds nothing, so the diff is not counted twice (QA r3-07). A new Pre of the same id forgets the closing.
  const prevClosed = live === null || live.closed === undefined ? [] : live.closed;
  if (POST.has(name) && toolUseId !== null && prevClosed.includes(toolUseId) && !prevOpen.includes(toolUseId)) return b;
  let closed = prevClosed;
  // `stopped`: the turn got its Stop and no new work since; an idle_prompt after it does not reopen the turn (QA r3-08)
  const prevStopped = live !== null && live.stopped === true;

  let pending = pendingAfter(prevPending, event, agent, toolUseId);
  let pre = prevPre;
  if (name === 'SubagentStop' && isStr(event.agent_id)) pre = withoutPending(prevPre, (p) => p.agent === event.agent_id);
  if ((POST.has(name) || name === 'PermissionDenied') && toolUseId !== null) pre = withoutPending(pre, (p) => p.tuid === toolUseId);
  if (name === 'Stop') pre = withoutPending(pre, (p) => p.agent === '');
  if (isDriverPrompt(event)) pre = prevPre.length === 0 ? prevPre : [];
  if (name === 'PreToolUse' && toolUseId !== null && isStr(event.tool_name)) {
    // every open call is kept (bounded), so a prompt can be tied to the right one
    pre = [...pre.filter((p) => p.tuid !== toolUseId), { agent, tuid: toolUseId, tool: event.tool_name, input: sig(event.tool_input) }].slice(-MAX_PRE);
  }

  // Commits the result; the board is returned as is when nothing changed (an ignored event makes no session).
  // revview's answer to a prompt (RevviewAnswered) stays until the session's next call, request, start or driver prompt
  const clears = name === 'PreToolUse' || name === 'PermissionRequest' || name === 'SessionStart' || isDriverPrompt(event)
    || (name === 'Notification' && PERMISSION_TYPES.has(event.notification_type));
  const answer = live !== null && live.answer !== undefined && !clears ? live.answer : undefined;
  const commit = (state, open, dropped) => {
    const stopped = name === 'Stop' ? true : (state.activity === 'done' || state.activity === 'waiting') && prevStopped;
    if (stopped === prevStopped && closed === prevClosed && state === prev && sameList(open, prevOpen) && (live === null || dropped === live.dropped)
      && pending === prevPending && pre === prevPre && answer === (live === null ? undefined : live.answer)) return b;
    const tick = b.tick + 1;
    const sessions = capSessions(withSession(b.sessions, id, { state, open, touched: tick, born: live === null ? tick : live.born, dropped, pending, pre, ...(closed.length === 0 ? {} : { closed }), ...(stopped ? { stopped } : {}), ...(answer === undefined ? {} : { answer }) }), id, b.selected ?? b.focus, b.selected, b.want, b.owned);
    const ended = b.ended.includes(id) ? b.ended.filter((x) => x !== id) : b.ended;
    return { ...b, sessions, ended, tick };
  };
  const prevDropped = live !== null && live.dropped;

  // The turn's `finished` flag decides what a late hook is. Pending prompts are kept beside the state: the
  // state's activity never becomes `permission` here, `act()` derives it from `pending`.
  const finished = live !== null
    && (prev.activity === 'done' || (prev.activity === 'waiting' && (prevOpen.length === 0 || prevStopped)));

  if (name === 'PermissionRequest' && isStr(event.tool_name)) {
    if (agent === '' && finished) return b; // a main-thread request needs a running turn
    // tie the prompt to a call only when exactly one open call of this agent fits (tool name, and the input when
    // the request carries one); otherwise leave the id empty so only the other end conditions clear it
    const want = sig(event.tool_input);
    const fits = pre.filter((p) => p.agent === agent && p.tool === event.tool_name && (want === '' || p.input === want));
    const tuid = fits.length === 1 ? fits[0].tuid : null;
    if (tuid !== null && pending.some((p) => p.agent === agent && p.tuid === tuid)) return b;
    const shown = reduce(prev, event);
    pending = [...pending, { agent, tuid, tool: shown.tool, file: shown.file, command: shown.command, output: shown.output, outputLines: shown.outputLines, since: b.tick + 1 }];
    // the state stays as it was (only a repo the session still lacks is taken from the event)
    const state = prev.repo === null && shown.repo !== null ? { ...prev, repo: shown.repo } : prev;
    return commit(state, prevOpen, prevDropped);
  }
  if (name === 'Notification' && PERMISSION_TYPES.has(event.notification_type)) {
    if (pending.length > 0 || finished) return b;
    // the notification carries no tool: describe the open call (if any) only, never the last finished one
    const open1 = prevOpen.length > 0;
    pending = [{
      agent: null, tuid: null, tool: open1 ? prev.tool : null, file: open1 ? prev.file : null,
      command: open1 && prev.tool === 'Bash' ? prev.command : null, output: null, outputLines: [], since: b.tick + 1,
    }];
    return commit(prev, prevOpen, prevDropped);
  }

  let state = reduce(prev, event);
  let open = prevOpen;
  let dropped = prevDropped;

  // Late events of a turn that already ended must not flip the activity back (QA issue 10). A turn has ended
  // after Stop (done), or when Claude waits with no tool open; an idle_prompt while a tool is still open (an
  // unanswered permission prompt) has not ended it, so that tool's Post still means working.
  if (finished && (POST.has(name) || name === 'PermissionDenied')) {
    if (!POST.has(name) || toolUseId === null || !prevOpen.includes(toolUseId)) {
      // a late diff-tool result we cannot place: its lines are lost, so the diff is only a lower bound
      if (name === 'PostToolUse' && DIFF_TOOLS.has(event.tool_name) && !live.dropped) return commit(prev, prevOpen, true);
      return commit(prev, prevOpen, prevDropped);
    }
    state = state === prev ? prev : { ...state, activity: prev.activity, view: prev.view };
  }

  if (name === 'PreToolUse' && toolUseId !== null && typeof event.tool_name === 'string' && event.tool_name !== ''
    && !open.includes(toolUseId)) {
    open = [...open, toolUseId];
    if (closed.includes(toolUseId)) closed = closed.filter((x) => x !== toolUseId);
  } else if (POST.has(name) && toolUseId !== null && open.includes(toolUseId)) {
    open = open.filter((x) => x !== toolUseId);
    closed = [...closed, toolUseId].slice(-MAX_CLOSED);
  } else if (isDriverPrompt(event)) {
    open = [];
    dropped = false;
  }

  return commit(state, open, dropped);
}

const buttonsView = (b) => (b.buttons === null ? 'unknown' : b.buttons ? 'present' : 'missing');

// The session the bar shows: the focus when it is live, else what pickFocus would choose.
const shownKeyOf = (b) => selectedOf(b) ?? (b.focus !== null && has(b.sessions, b.focus) ? b.focus : pickFocus(b, null));

const promptOf = (session, p) => ({ session, agent: p.agent, since: p.since, tool: p.tool, file: p.file, command: p.command });

// Every pending permission prompt of every session.
export function pendingPrompts(board) {
  const b = isValidBoard(board) ? board : initialBoard();
  return Object.keys(b.sessions).flatMap((k) => b.sessions[k].pending.map((p) => promptOf(k, p)));
}

// The prompt the bar shows (the shown session's first pending one), or null when the view is not 'permission'.
export function shownPrompt(board) {
  const b = isValidBoard(board) ? board : initialBoard();
  if (b.nav !== null || boardView(b).view !== 'permission') return null;
  const k = shownKeyOf(b);
  return k === null || b.sessions[k].pending.length === 0 ? null : promptOf(k, b.sessions[k].pending[0]);
}

const WORDS = { permission: 'PERMISSION', waiting: 'WAITING', working: 'WORKING', done: 'DONE' };

function navView(b) {
  if (b.nav === null) return null;
  const { kind } = b.nav;
  const order = orderOf(b);
  let rows;
  if (kind === 'list') {
    rows = order.map((id) => {
      const s = b.sessions[id];
      const a = act(s);
      const state = has(WORDS, a) ? a : 'unknown';
      return {
        label: typeof s.state.repo === 'string' ? s.state.repo : '',
        word: WORDS[state] ?? 'UNKNOWN',
        state,
        target: id === b.selected,
        voice: b.owned === null ? null : b.owned.includes(id),
      };
    });
  } else if (kind === 'menu') {
    rows = MENU_ROWS.map((label) => ({ label }));
  } else if (kind === 'settings') {
    const found = b.buttons === null ? 'not known' : b.buttons ? 'found' : 'not found';
    rows = [
      'Voice: needs tap mode (/voice tap in Claude Code)',
      `Wheel buttons: ${found}`,
      `Sessions: ${order.length} on the bar, ${b.owned?.length ?? 0} started by revview`,
      `Projects: ${b.projects.length} in the config file`,
    ].map((label) => ({ label }));
  } else {
    rows = b.projects.map((label) => ({ label }));
  }
  return { kind, row: clampRow(b.nav.row, rows.length), rows };
}

// 'allow' | 'deny' while the shown session still shows the call revview answered (nothing pending, same tool, file, command).
function answeredOf(shown) {
  const a = shown === null ? undefined : shown.answer;
  if (a === undefined || shown.pending.length > 0) return null;
  const s = shown.state;
  return s.tool === a.tool && s.file === a.file && s.command === a.command ? a.decision : null;
}

// The keys every view state carries besides the shown session's own fields.
function extrasOf(b, shownKey) {
  const order = orderOf(b);
  const sel = selectedOf(b);
  const i = shownKey === null ? -1 : order.indexOf(shownKey);
  let voice = null;
  if (b.owned !== null) voice = b.owned.length === 0 ? 'no-session' : sel === null ? 'none' : b.owned.includes(sel) ? 'here' : 'not-owned';
  return {
    voice,
    position: b.owned === null || i < 0 ? null : { index: i + 1, count: order.length },
    elsewhere: order.filter((k) => k !== shownKey && b.sessions[k].pending.length > 0).length,
    nav: navView(b),
    note: typeof b.note === 'string' ? b.note : shownKey !== null && b.sessions[shownKey].quiet === true ? 'No events from this session yet' : null,
    answered: answeredOf(shownKey === null ? null : b.sessions[shownKey]),
  };
}

export function boardView(board) {
  const b = isValidBoard(board) ? board : initialBoard();
  const buttons = buttonsView(b);
  const shownKey = shownKeyOf(b);
  const shown = shownKey === null ? null : b.sessions[shownKey];
  // needing the driver outranks OFFLINE; `offline` stays true in the flat state as a secondary mark
  const overlay = (activity) => (b.locked ? 'insert-key' : b.offline && activity !== 'permission' ? 'offline' : activity);
  if (shown === null) {
    return {
      view: overlay(b.phase),
      activity: b.phase,
      offline: b.offline,
      locked: b.locked,
      repo: b.context.repo,
      branch: b.context.branch,
      tool: null,
      file: null,
      diff: { added: 0, removed: 0 },
      command: null,
      output: null,
      outputLines: [],
      others: 0,
      diffIncomplete: false,
      buttons,
      ...extrasOf(b, shownKey),
    };
  }
  const s = shown.state;
  const ask = shown.pending.length > 0 ? shown.pending[0] : null;
  const activity = act(shown);
  const repo = s.repo ?? b.context.repo;
  // the board's branch belongs to the board's repo only
  const branch = s.branch ?? (b.context.repo !== null && b.context.repo === repo ? b.context.branch : null);
  return {
    view: overlay(activity),
    activity,
    offline: b.offline,
    locked: b.locked,
    repo,
    branch,
    tool: ask === null ? s.tool : ask.tool,
    file: ask === null ? s.file : ask.file,
    diff: { added: s.diff.added, removed: s.diff.removed },
    command: ask === null ? s.command : ask.command,
    output: ask === null ? s.output : ask.output,
    outputLines: ask === null ? s.outputLines : ask.outputLines,
    others: Object.keys(b.sessions).filter((k) => k !== '').length - (shownKey === '' ? 0 : 1),
    diffIncomplete: shown.dropped,
    buttons,
    ...extrasOf(b, shownKey),
  };
}

// Folds events from `board`; returns boardView(board) after each event.
export function replayView(events, board = initialBoard()) {
  const out = [];
  let b = board;
  for (const ev of events) {
    b = reduceBoard(b, ev);
    out.push(boardView(b));
  }
  return out;
}
