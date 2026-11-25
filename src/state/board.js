// Pure board layer: many sessions + overlays -> the flat state the page renders.
// No clock, I/O or timers; never throws; returns the SAME reference when nothing changes.
import { initialState, isDriverPrompt, reduce } from './reducer.js';
import { ASK_TOOLS, askOf, isAsk, answerOf } from './ask.js';

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
    hot: false, // the box is hot (RevviewThermal): board-level, not per session
    lowPower: false, // weak supply / under-voltage (RevviewThermal)
    selected: null, // the session the driver chose (live id or null); null = the old heuristics decide
    want: null, // a session revview started that is not on the board yet: selected when it first appears
    owned: null, // ids of sessions revview owns (its tmux windows); null = the server runs without sessions
    nav: null, // null (normal view) or {kind, row[, id]}: a list/menu the driver has open; a list also holds the highlighted session id
    note: null, // the bottom note row: null or { kind, text } (see NOTE_RULES); cleared by the driver's next gesture
    projects: [], // project paths from the config file (display only)
    sounds: null, // null = the server has no sound feature; else 'off' | 'cues' | 'speech' (cues and speech), RevviewSounds
  };
}

// b.booting (absent = false): set only by the server's own boot (RevviewBootBegin), ended by RevviewBootDone; while
// it is true a quiet placeholder shows STARTING and presses are dropped. A POSTed RevviewStarting never sets it.
// b.launching (absent until the first RevviewLaunching): ids of sessions revview itself just started, at most 8,
// oldest dropped; a quiet one shows STARTING
const MAX_LAUNCHING = 8;
const NAV_KINDS = ['list', 'menu', 'new', 'projects', 'settings'];
const MENU_ROWS = ['New session', 'Projects', 'Settings'];
const SETTINGS_ROWS = 4; // the fixed rows; a 5th (Sounds) is there while b.sounds is not null
const SOUNDS_MODES = ['off', 'cues', 'speech'];
const SOUNDS_NEXT = { cues: 'speech', speech: 'off', off: 'cues' };
const SOUNDS_LABELS = { off: 'Sounds: off', cues: 'Sounds: cues', speech: 'Sounds: cues and speech' };
const soundsOn = (b) => SOUNDS_MODES.includes(b.sounds);

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
    && (b.sounds === undefined || b.sounds === null || SOUNDS_MODES.includes(b.sounds))
    && (b.hot === undefined || typeof b.hot === 'boolean') && (b.lowPower === undefined || typeof b.lowPower === 'boolean')
    && (b.selected === null || typeof b.selected === 'string') && (b.want === null || typeof b.want === 'string')
    && (b.owned === null || (Array.isArray(b.owned) && b.owned.every((x) => typeof x === 'string')))
    && (b.nav === null || (isObj(b.nav) && NAV_KINDS.includes(b.nav.kind) && Number.isInteger(b.nav.row) && b.nav.row >= 0
      && (b.nav.id === undefined || typeof b.nav.id === 'string')))
    && (b.launching === undefined || (Array.isArray(b.launching) && b.launching.every((x) => typeof x === 'string')))
    && (b.endReasons === undefined || isObj(b.endReasons))
    && (b.endNoteFor === undefined || typeof b.endNoteFor === 'string')
    && (b.keyon === undefined || typeof b.keyon === 'string')
    && (b.booting === undefined || typeof b.booting === 'boolean')
    && (b.note === undefined || b.note === null || (isObj(b.note) && Object.hasOwn(NOTE_RULES, b.note.kind) && typeof b.note.text === 'string'))
    && Array.isArray(b.projects) && b.projects.every((x) => typeof x === 'string')
    && (b.projectsMissing === undefined || (Array.isArray(b.projectsMissing) && b.projectsMissing.every((x) => typeof x === 'string')))
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

// The bar's note is { kind, text }. Every rule goes by kind, never by the text (the text is display only):
//   kind          made by                                    rule besides "a button gesture clears it"
//   plain         any other note (RevviewNote, BootDone,     none
//                 "Highlighted session ended: list closed")
//   too-early     actions.js: an answer refused too early    goes when the prompt the bar shows changes
//   ask           the server: an answer to the shown question   goes when the prompt the bar shows changes
//                 refused ("Not sent: the question changed")
//   starting-ptt  actions.js: push-to-talk during STARTING   goes when the selected session no longer shows STARTING
//   answer-prompt actions.js: push-to-talk refused, the      goes when the selected session has no pending prompt left
//                 selected session has a pending prompt
//   ended         a session's end (here); the key-on Claude  a push-to-talk tap with no session clears it
//                 that exited at once (BootDone)             (RevviewNoSessionPress); RevviewEndReason replaces it
//   ended-last    the last session ended: "<name> ended:     as ended; hidden while the data is locked
//                 open the menu for New session"
//   no-session    the server's boot (BootDone): "No session    hidden while the data is locked; not an ended note
//                 yet: open the menu for New session"         (a push-to-talk tap does not clear it)
const NOTE_RULES = {
  plain: {}, 'too-early': {}, ask: {}, 'starting-ptt': {}, 'answer-prompt': {}, 'no-session': { hiddenLocked: true },
  ended: { ended: true }, 'ended-last': { ended: true, hiddenLocked: true },
};
export const NOTE_KINDS = Object.freeze(Object.keys(NOTE_RULES));
// the kinds a RevviewNote may carry (absent = plain); the ended kinds are made by the board and BootDone only
const POSTED_NOTE_KINDS = ['plain', 'too-early', 'ask', 'starting-ptt', 'answer-prompt'];
const noteOf = (kind, text) => ({ kind, text });
const isNoteText = (t) => typeof t === 'string' && t.length >= 1 && t.length <= 120;
const isEndedNote = (n) => isObj(n) && NOTE_RULES[n.kind]?.ended === true;
const noteKind = (n) => (isObj(n) ? n.kind : null);

// the note actions.js sets when push-to-talk is refused during STARTING (one text, two files)
export const STARTING_PTT_NOTE = 'Claude is still starting: push-to-talk not sent';
// the key-on session whose window vanished while STARTING (the server uses the same text for a start that failed at once)
export const KEYON_ENDED_NOTE = 'Key-on session ended at once: see the server log';
const ENDED_NEXT = ': open the menu for New session';
// the notes a session's end leaves; a push-to-talk tap with no session replaces them (RevviewNoSessionPress)
// What a session's end leaves on the bar when its last screen line is known (RevviewEndReason): the line is
// display text from an untrusted screen, cleaned and cut here (the server cleans it too).
export const ENDED_PREFIX = 'Session ended: ';
const REASON_MAX = 80;
const endReasonText = (t) => {
  const c = typeof t === 'string' ? t.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (c === '') return null;
  return c.length > REASON_MAX ? `${c.slice(0, REASON_MAX - 1)}\u2026` : c;
};

export function reduceBoard(board, event) {
  const b = isValidBoard(board) ? board : initialBoard();
  if (!isObj(event) || typeof event.hook_event_name !== 'string') return b;
  let next = reduceInner(b, event);
  // a button gesture clears the board note; so does the answer that a "Too early: press again" note asked for
  if ((event.hook_event_name === 'RevviewNav' || event.hook_event_name === 'RevviewAnswered') && next.note !== null) next = { ...next, note: null };
  // the "Too early" note belongs to the prompt it was set for: when what the bar shows changes, it goes
  // the push-to-talk refusal belongs to STARTING: when the selected session no longer shows STARTING (first hook,
  // launch limit) it goes, so UNKNOWN can say "No events from this session yet" (QA r6b-01); no other note is touched
  if (noteKind(b.note) === 'starting-ptt' && noteKind(next.note) === 'starting-ptt' && !sessionStarting(next, selectedKey(next))) next = { ...next, note: null };
  // the push-to-talk refusal for a pending prompt goes when the selected session has none left (answered in the terminal)
  if (noteKind(b.note) === 'answer-prompt' && noteKind(next.note) === 'answer-prompt') {
    const sel = selectedKey(next);
    if (sel === null || !has(next.sessions, sel) || next.sessions[sel].pending.length === 0) next = { ...next, note: null };
  }
  if (noteKind(b.note) === 'too-early' && noteKind(next.note) === 'too-early') {
    const id = (x) => { const p = shownPrompt(x) ?? shownAsk(x); return p === null ? null : `${p.session}\u0000${p.agent}\u0000${p.since}`; };
    if (id(b) !== id(next)) next = { ...next, note: null };
  }
  // the server's refusal under CLAUDE ASKS belongs to the question it was set for
  if (noteKind(b.note) === 'ask' && noteKind(next.note) === 'ask') {
    const id = (x) => { const p = shownAsk(x); return p === null ? null : `${p.session}\u0000${p.agent}\u0000${p.since}`; };
    if (id(b) !== id(next)) next = { ...next, note: null };
  }
  // the selected session ended and others remain: the selection falls to another one, and the bar says so
  const wasSel = selectedOf(b);
  // (the last session ending says so too, quiet or not: the key-on Claude that exited at once, QA r6b-02; the normal
  // end of a drive, QA r7b-02, only where revview runs sessions, so that the menu's New session exists)
  if (wasSel !== null && next !== b && !has(next.sessions, wasSel)
    && (Object.keys(next.sessions).length > 0 || b.sessions[wasSel].quiet === true || b.owned !== null)
    && (event.hook_event_name === 'SessionEnd' || event.hook_event_name === 'RevviewOwned')) {
    const label = b.sessions[wasSel].state.repo;
    const last = Object.keys(next.sessions).length === 0;
    // (cut so that the longer last-session note stays within 120 characters too)
    const name = typeof label === 'string' && label !== '' ? label.slice(0, last ? 80 : 100) : 'Selected session';
    // the key-on session that vanished while still STARTING: "ended at once" (its reason is in the server log)
    const atOnce = b.keyon === wasSel && (b.launching ?? []).includes(wasSel) && b.sessions[wasSel].quiet === true;
    const reason = b.endReasons?.[wasSel];
    const note = typeof reason === 'string' ? noteOf('ended', `${ENDED_PREFIX}${reason}`) : atOnce ? noteOf('ended', KEYON_ENDED_NOTE)
      : last ? noteOf('ended-last', `${name} ended${ENDED_NEXT}`) : noteOf('ended', `${name} ended`);
    next = { ...next, endNoteFor: wasSel, note };
  }
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
    if (at < 0) cur = { ...cur, nav: null, note: noteOf('plain', 'Highlighted session ended: list closed') };
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
  if (kind === 'settings') return SETTINGS_ROWS + (soundsOn(b) ? 1 : 0);
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
    if (tap && (button === 'up' || button === 'down')) {
      // a question the buttons can answer: up / down move its highlighted choice (no wrap), not the list
      const e = shownPickEntry(b);
      if (e !== null) {
        const last = e.ask.options.length - 1;
        const cur = choiceOf(e, e.ask);
        const to = Math.min(last, Math.max(0, cur + (button === 'up' ? -1 : 1)));
        if (to === cur) return b;
        const key = shownKeyOf(b);
        const s = b.sessions[key];
        return { ...b, sessions: withSession(b.sessions, key, { ...s, pending: s.pending.map((p, i) => (i === 0 ? { ...p, choice: to } : p)) }) };
      }
    }
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
    if (kind === 'settings' && row === SETTINGS_ROWS && soundsOn(b)) return { ...b, sounds: SOUNDS_NEXT[b.sounds], nav: { kind, row } };
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
    case 'RevviewSounds':
      return SOUNDS_MODES.includes(event.mode) && b.sounds !== event.mode ? { ...b, sounds: event.mode } : b;
    case 'RevviewThermal': { // the box's heat / supply, board-level; a non-boolean field keeps its old value
      const hot = typeof event.hot === 'boolean' ? event.hot : b.hot === true;
      const lowPower = typeof event.lowPower === 'boolean' ? event.lowPower : b.lowPower === true;
      return hot === (b.hot === true) && lowPower === (b.lowPower === true) ? b : { ...b, hot, lowPower };
    }
    case 'RevviewInterrupted': { // revview sent Esc / Ctrl+C itself; Claude Code fires no hook for it
      if (!isStr(event.session_id) || live === null) return b;
      if (act(live) !== 'working' && act(live) !== 'permission') return b;
      // like an interrupt: waiting for the driver, last tool/command/file/diff kept, dialogs rejected by the Esc
      const st = live.state;
      const state = { ...st, activity: 'waiting', compacting: false, view: st.locked ? 'insert-key' : st.offline ? 'offline' : 'waiting' };
      const tick = b.tick + 1;
      return { ...b, tick, sessions: withSession(b.sessions, id, { ...live, state, open: [], pending: [], pre: [], touched: tick }) };
    }
    case 'RevviewCompactExpired': { // the server's limit for a compaction whose end event never came
      if (!isStr(event.session_id) || live === null || live.state.compacting !== true) return b;
      const tick = b.tick + 1;
      return { ...b, tick, sessions: withSession(b.sessions, id, { ...live, state: { ...live.state, compacting: false }, touched: tick }) };
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
    case 'RevviewBootBegin': // the server's own boot: what RevviewStarting does, and the boot STARTING rule is on
    case 'RevviewStarting': {
      // the sessions are forgotten, the driver's choice is not: it becomes `want`, so the same session is selected
      // again when its events come back (a posted RevviewStarting can blank the bar, never redirect a button)
      const want = b.want ?? b.selected;
      const booting = event.hook_event_name === 'RevviewBootBegin' ? true : b.booting === true;
      if (b.phase === 'starting' && b.ended.length === 0 && Object.keys(b.sessions).length === 0
        && b.selected === null && b.want === want && b.nav === null && (b.booting === true) === booting) return b;
      return { ...b, phase: 'starting', sessions: {}, ended: [], selected: null, want, nav: null, ...(booting ? { booting } : {}) };
    }
    case 'RevviewBootDone': {
      // the key-on boot is over (a session came, or none will: nothing to start, or the start failed): the bar
      // leaves STARTING for the initial phase so its buttons work. Outside the boot STARTING it changes nothing.
      if (b.booting !== true) return b;
      // the note's kind: plain (absent), ended (the key-on Claude exited at once) or no-session; another kind drops the note
      const kind = event.kind === undefined ? 'plain' : event.kind;
      const ok = isNoteText(event.note) && (kind === 'plain' || kind === 'ended' || kind === 'no-session');
      return { ...b, booting: false, phase: b.phase === 'starting' ? 'unknown' : b.phase, note: ok ? noteOf(kind, event.note) : b.note };
    }
    case 'RevviewLaunching': {
      // revview just started this session's window: until its first hook it shows STARTING (see boardView)
      const id = event.session_id;
      if (typeof id !== 'string' || !UUID.test(id)) return b;
      const cur = b.launching ?? [];
      if (cur.includes(id)) return event.keyon === true && b.keyon !== id ? { ...b, keyon: id } : b;
      return { ...b, launching: [...cur, id].slice(-MAX_LAUNCHING), ...(event.keyon === true ? { keyon: id } : {}) };
    }
    case 'RevviewNoSessionPress':
      // a push-to-talk tap with no session selected: the "... ended" note goes, so the view's "does nothing" line shows
      return isEndedNote(b.note) ? { ...b, note: null } : b;
    case 'RevviewLaunchExpired': {
      const cur = b.launching ?? [];
      if (typeof event.session_id !== 'string' || !cur.includes(event.session_id)) return b;
      return { ...b, launching: cur.filter((x) => x !== event.session_id) };
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
      // a window gone from TWO consecutive successful listings ends its session (a Claude that died without a
      // SessionEnd). One empty or short listing proves nothing (a tmux hiccup): the id is only marked missing.
      // The id is not put in `ended`: a dead Claude sends no hooks, a live one comes back with its next poll or hook.
      // No timer: a listed window stays however silent. b.owned === null (first list) ends nothing.
      let gone = b;
      const missing = [];
      if (b.owned !== null) {
        const before = b.missing ?? [];
        for (const id of new Set([...b.owned, ...before])) {
          if (owned.includes(id)) continue;
          const s = gone.sessions[id];
          if (s === undefined || s.quiet === true) continue;
          if (before.includes(id)) gone = endSession(gone, s, id, gone.ended);
          else missing.push(id);
        }
      }
      // one tick per placeholder, in owned order, so the list order (born) follows the order revview started them
      let tick = b.tick;
      let sessions = gone.sessions;
      for (const id of Object.keys(gone.sessions)) {
        if (gone.sessions[id].quiet === true && !owned.includes(id)) sessions = withoutSession(sessions, id);
      }
      for (const id of owned) {
        if (!UUID.test(id) || has(sessions, id) || gone.ended.includes(id)) continue;
        tick += 1;
        sessions = withSession(sessions, id, {
          state: { ...initialState(), repo: nameOf.get(id) ?? null }, open: [], pending: [], pre: [], touched: tick, born: tick, dropped: false, quiet: true,
        });
      }
      const same = b.owned !== null && owned.length === b.owned.length && owned.every((x) => b.owned.includes(x))
        && missing.length === (b.missing ?? []).length && missing.every((x) => (b.missing ?? []).includes(x));
      if (same && sessions === b.sessions && gone === b) return b;
      sessions = capSessions(sessions, null, b.selected ?? b.focus, b.selected, b.want, [...owned, ...missing]);
      return { ...gone, owned, missing, sessions, tick };
    }
    case 'RevviewProjects': {
      const paths = event.paths;
      if (!Array.isArray(paths) || paths.length > 32 || !paths.every((x) => typeof x === 'string' && x.length <= 4096)) return b;
      const missing = event.missing === undefined ? [] : event.missing;
      if (!Array.isArray(missing) || missing.length > 32 || !missing.every((x) => typeof x === 'string' && paths.includes(x))) return b;
      const samePaths = sameList(paths, b.projects);
      if (samePaths && sameList(missing, b.projectsMissing ?? [])) return b;
      const rowsChanged = !samePaths && b.nav !== null && (b.nav.kind === 'new' || b.nav.kind === 'projects');
      return { ...b, projects: [...paths], projectsMissing: [...missing], nav: rowsChanged ? null : b.nav };
    }
    case 'RevviewEndReason': {
      // why a session revview started ended (the server read its last screen line). Kept by id (at most 8, newest
      // last) for the end note; when that note was already made (a SessionEnd came first), it is made again with the reason.
      const id = event.session_id;
      const text = endReasonText(event.text) ?? 'no output';
      if (!isStr(id) || id.length > 200) return b;
      const kept = Object.entries(b.endReasons ?? {}).filter(([k]) => k !== id).slice(-7);
      const endReasons = Object.fromEntries([...kept, [id, text]]);
      const base = { ...b, endReasons };
      return !has(b.sessions, id) && b.endNoteFor === id && isEndedNote(b.note) ? { ...base, note: noteOf('ended', `${ENDED_PREFIX}${text}`) } : base;
    }
    case 'RevviewNote': {
      const kind = event.kind === undefined ? 'plain' : event.kind;
      if (!isNoteText(event.note) || !POSTED_NOTE_KINDS.includes(kind)) return b;
      return isObj(b.note) && b.note.kind === kind && b.note.text === event.note ? b : { ...b, note: noteOf(kind, event.note) };
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
  // a PreCompact of a session the board does not know makes no session (a mark alone is nothing to show)
  if (name === 'PreCompact' && tlive === null) return b;
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
    // a call that asks the driver (AskUserQuestion, ExitPlanMode) keeps its ask, for a prompt that arrives as a bare Notification
    const ask = ASK_TOOLS.includes(event.tool_name) ? askOf(event.tool_name, event.tool_input) : null;
    pre = [...pre.filter((p) => p.tuid !== toolUseId), { agent, tuid: toolUseId, tool: event.tool_name, input: sig(event.tool_input), ...(ask === null ? {} : { ask }) }].slice(-MAX_PRE);
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
    const sessions = capSessions(withSession(b.sessions, id, { state, open, touched: tick, born: live === null ? tick : live.born, dropped, pending, pre, ...(closed.length === 0 ? {} : { closed }), ...(stopped ? { stopped } : {}), ...(answer === undefined ? {} : { answer }) }), id, b.selected ?? b.focus, b.selected, b.want, b.owned === null ? null : [...b.owned, ...(b.missing ?? [])]);
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
    // an AskUserQuestion / ExitPlanMode request is the "asks me" state: the entry carries what is asked
    const ask = askOf(event.tool_name, event.tool_input);
    pending = [...pending, { agent, tuid, tool: shown.tool, file: shown.file, command: shown.command, output: shown.output, outputLines: shown.outputLines, since: b.tick + 1, ...(ask === null ? {} : { ask }) }];
    // the state stays as it was (only a repo the session still lacks is taken from the event)
    const state = prev.repo === null && shown.repo !== null ? { ...prev, repo: shown.repo } : prev;
    return commit(state, prevOpen, prevDropped);
  }
  if (name === 'Notification' && PERMISSION_TYPES.has(event.notification_type)) {
    if (pending.length > 0 || finished) return b;
    // the notification carries no tool: describe the open call (if any) only, never the last finished one
    const open1 = prevOpen.length > 0;
    // the last open main-thread call that asks the driver: the notification is its question or plan
    const asking = pre.findLast((p) => p.agent === '' && prevOpen.includes(p.tuid) && p.ask !== undefined);
    pending = [{
      agent: null, tuid: null, tool: open1 ? prev.tool : null, file: open1 ? prev.file : null,
      command: open1 && prev.tool === 'Bash' ? prev.command : null, output: null, outputLines: [], since: b.tick + 1,
      ...(asking === undefined ? {} : { ask: asking.ask }),
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

// `ask`: null for a permission prompt, else what AskUserQuestion / ExitPlanMode asks (src/state/ask.js)
const askIn = (p) => (isAsk(p.ask) ? p.ask : null);
const promptOf = (session, p) => ({ session, agent: p.agent, since: p.since, tool: p.tool, file: p.file, command: p.command, ask: askIn(p) });

// the highlighted choice of a pending entry: an integer inside its options, else 0
const choiceOf = (p, ask) => (Number.isInteger(p.choice) ? Math.min(Math.max(0, p.choice), Math.max(0, ask.options.length - 1)) : 0);

// the shown session's first pending entry (with its valid ask) when the bar shows 'asking' and the buttons pick, else null
function shownPickEntry(b) {
  const k = shownKeyOf(b);
  if (k === null || b.sessions[k].pending.length === 0 || boardView(b).view !== 'asking') return null;
  const p = b.sessions[k].pending[0];
  const ask = askIn(p);
  return ask !== null && answerOf(ask) === 'pick' ? { ...p, ask } : null;
}

// the view's form of an ask: who answers it and, for a pick, the highlighted choice
const askViewOf = (p) => {
  const ask = askIn(p);
  if (ask === null) return null;
  const answer = answerOf(ask);
  return { ...ask, answer, choice: answer === 'pick' ? choiceOf(p, ask) : null };
};

// Every pending permission prompt of every session.
export function pendingPrompts(board) {
  const b = isValidBoard(board) ? board : initialBoard();
  return Object.keys(b.sessions).flatMap((k) => b.sessions[k].pending.map((p) => promptOf(k, p)));
}

// The ask the bar shows (view 'asking', nothing open over it): the shown session's first pending entry, with
// who answers it (`answer`) and the highlighted `choice` (null unless 'pick'); else null.
export function shownAsk(board) {
  const b = isValidBoard(board) ? board : initialBoard();
  if (b.nav !== null || boardView(b).view !== 'asking') return null;
  const k = shownKeyOf(b);
  if (k === null || b.sessions[k].pending.length === 0) return null;
  const p = b.sessions[k].pending[0];
  const ask = askViewOf(p);
  return ask === null ? null : { ...promptOf(k, p), answer: ask.answer, choice: ask.choice };
}

// The prompt the bar shows (the shown session's first pending one), or null when the view is not 'permission'.
export function shownPrompt(board) {
  const b = isValidBoard(board) ? board : initialBoard();
  if (b.nav !== null || boardView(b).view !== 'permission') return null;
  const k = shownKeyOf(b);
  return k === null || b.sessions[k].pending.length === 0 ? null : promptOf(k, b.sessions[k].pending[0]);
}

const WORDS = { permission: 'PERMISSION', asking: 'ASKS', waiting: 'WAITING', working: 'WORKING', done: 'DONE' };

function navView(b) {
  if (b.nav === null) return null;
  const { kind } = b.nav;
  const order = orderOf(b);
  let rows;
  if (kind === 'list') {
    rows = order.map((id) => {
      const s = b.sessions[id];
      const a = s.pending.length > 0 && askIn(s.pending[0]) !== null ? 'asking' : act(s);
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
    if (soundsOn(b)) rows.push({ label: SOUNDS_LABELS[b.sounds], change: true });
  } else {
    const gone = kind === 'new' ? b.projectsMissing ?? [] : [];
    rows = b.projects.map((label) => (gone.includes(label) ? { label, missing: true } : { label }));
  }
  return { kind, row: clampRow(b.nav.row, rows.length), rows };
}

// 'allow' | 'deny' while the shown session has an answer of revview's and nothing pending (the answer is tied to the
// answered request, see boardView; it lasts until the session's next call, request, start or driver prompt).
function answeredOf(shown) {
  const a = shown === null ? undefined : shown.answer;
  return a === undefined || shown.pending.length > 0 ? null : a.decision;
}

// A quiet placeholder is STARTING while the boot lasts, or while revview's own start of it is recent (launching).
const startingOf = (b, s, key) => s.quiet === true && (b.booting === true || (b.launching ?? []).includes(key));

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
    note: isObj(b.note) ? (b.locked && NOTE_RULES[b.note.kind]?.hiddenLocked === true ? null : b.note.text) : voice !== 'none' && shownKey !== null && b.sessions[shownKey].quiet === true && !startingOf(b, b.sessions[shownKey], shownKey) ? 'No events from this session yet' : null,
    answered: answeredOf(shownKey === null ? null : b.sessions[shownKey]),
  };
}

export function boardView(board) {
  const b = isValidBoard(board) ? board : initialBoard();
  const buttons = buttonsView(b);
  const shownKey = shownKeyOf(b);
  const shown = shownKey === null ? null : b.sessions[shownKey];
  // needing the driver outranks OFFLINE; `offline` stays true in the flat state as a secondary mark
  const overlay = (activity) => (b.locked ? 'insert-key' : b.offline && activity !== 'permission' && activity !== 'asking' ? 'offline' : activity);
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
      failed: null,
      compacting: false,
      ask: null,
      others: 0,
      diffIncomplete: false,
      buttons,
      hot: b.hot === true,
      lowPower: b.lowPower === true,
      ...extrasOf(b, shownKey),
    };
  }
  const s = shown.state;
  const ask = shown.pending.length > 0 ? shown.pending[0] : null;
  // the first pending prompt is a question or a plan: the "asks me" state (it pre-empts like a permission prompt)
  const asks = ask === null ? null : askIn(ask);
  // the call revview answered (nothing pending): the bar shows that call, not the state's last tool/command
  const ans = ask === null && shown.answer !== undefined ? shown.answer : null;
  const ownOutput = ans === null || (ans.tool === 'Bash' && ans.command !== null && s.command === ans.command);
  // a quiet placeholder (no hook yet) is STARTING while the boot lasts or revview just started it, not UNKNOWN
  const activity = startingOf(b, shown, shownKey) ? 'starting' : asks !== null ? 'asking' : act(shown);
  // a failed turn (StopFailure, QA r3-05): the old call's tool, command and output do not sit under the message
  const failed = ask === null && ans === null && s.failed ? s.failed : null;
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
    tool: ask !== null ? ask.tool : ans !== null ? ans.tool : failed !== null ? null : s.tool,
    file: ask !== null ? ask.file : ans !== null ? ans.file : failed !== null ? null : s.file,
    diff: { added: s.diff.added, removed: s.diff.removed },
    command: ask !== null ? ask.command : ans !== null ? ans.command : failed !== null ? null : s.command,
    output: failed !== null ? failed.message : ask !== null ? ask.output : ownOutput ? s.output : null,
    outputLines: failed !== null ? (failed.message === null ? [] : [failed.message]) : ask !== null ? ask.outputLines : ownOutput ? s.outputLines : [],
    failed: failed === null ? null : { error: failed.error, message: failed.message },
    // compaction is under way: the view says so beside what it shows (it needs no prompt, no failure, a settled activity)
    compacting: s.compacting === true && ask === null && failed === null && (activity === 'working' || activity === 'waiting' || activity === 'done'),
    ask: asks === null ? null : askViewOf(ask),
    others: Object.keys(b.sessions).filter((k) => k !== '').length - (shownKey === '' ? 0 : 1),
    diffIncomplete: shown.dropped,
    buttons,
    hot: b.hot === true,
    lowPower: b.lowPower === true,
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

// True when the session `id` would show STARTING (the boot, or revview's own recent start of it)
export function sessionStarting(board, id) {
  const b = isValidBoard(board) ? board : initialBoard();
  const s = typeof id === 'string' ? b.sessions[id] : undefined;
  return s !== undefined && startingOf(b, s, id);
}
