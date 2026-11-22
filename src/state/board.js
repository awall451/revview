// Pure board layer: many sessions + overlays -> the flat state the page renders.
// No clock, I/O or timers; never throws; returns the SAME reference when nothing changes.
import { initialState, reduce } from './reducer.js';

export const MAX_SESSIONS = 8; // the band hint "+N" has room for one digit
const MAX_ENDED = 16;

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
  };
}

function isValidSession(s) {
  return isObj(s) && isObj(s.state) && typeof s.state.activity === 'string' && isObj(s.state.diff)
    && Array.isArray(s.open) && Number.isInteger(s.touched) && typeof s.dropped === 'boolean';
}

// Only boards this module built are used; anything else is replaced, so nothing below can throw on it.
function isValidBoard(b) {
  return isObj(b) && typeof b.phase === 'string' && isObj(b.context) && isObj(b.sessions)
    && Array.isArray(b.ended) && Number.isInteger(b.tick)
    && Object.keys(b.sessions).every((k) => isValidSession(b.sessions[k]));
}

const keyOf = (event) => (isStr(event.session_id) ? event.session_id : '');

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

function capSessions(sessions, keepId) {
  let out = sessions;
  while (Object.keys(out).length > MAX_SESSIONS) {
    let oldest = null;
    for (const k of Object.keys(out)) {
      if (k !== keepId && (oldest === null || out[k].touched < out[oldest].touched)) oldest = k;
    }
    if (oldest === null) break;
    out = withoutSession(out, oldest);
  }
  return out;
}

function withContext(board, patch) {
  const context = { ...board.context, ...patch };
  return context.repo === board.context.repo && context.branch === board.context.branch ? board : { ...board, context };
}

export function reduceBoard(board, event) {
  const b = isValidBoard(board) ? board : initialBoard();
  if (!isObj(event) || typeof event.hook_event_name !== 'string') return b;
  const name = event.hook_event_name;
  const id = keyOf(event);
  const live = has(b.sessions, id) ? b.sessions[id] : null;

  switch (name) {
    case 'RevviewNetwork':
      return typeof event.online === 'boolean' && b.offline === event.online ? { ...b, offline: !event.online } : b;
    case 'RevviewDataLock':
      return typeof event.locked === 'boolean' && b.locked !== event.locked ? { ...b, locked: event.locked } : b;
    case 'RevviewStarting':
      if (b.phase === 'starting' && b.ended.length === 0 && Object.keys(b.sessions).length === 0) return b;
      return { ...b, phase: 'starting', sessions: {}, ended: [] };
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
      const live1 = isStr(event.session_id) && live !== null;
      const sessions = mapSessions(b.sessions, (s) => (s.dropped || (live1 && s !== live) ? s : { ...s, dropped: true }));
      return sessions === b.sessions ? b : { ...b, sessions };
    }
    case 'SessionEnd': {
      if (live === null && b.ended.includes(id)) return b;
      const sessions = withoutSession(b.sessions, id);
      // the anonymous session ('') is never remembered as ended, so later id-less events still count
      const ended = id === '' ? b.ended : pushEnded(b.ended, id);
      if (Object.keys(sessions).length > 0) return { ...b, sessions, ended };
      const repo = live !== null && live.state.repo !== null ? live.state.repo : b.context.repo;
      const branch = live !== null && live.state.branch !== null ? live.state.branch : b.context.branch;
      return { ...b, sessions, ended, phase: 'ended', context: { repo, branch } };
    }
    default:
      break;
  }

  if (name !== 'SessionStart' && b.ended.includes(id)) return b;
  return applyToSession(b, live, id, event);
}

const POST = new Set(['PostToolUse', 'PostToolUseFailure']);
const PERMISSION_TYPES = new Set(['permission_prompt', 'worker_permission_prompt']);

function applyToSession(b, live, id, event) {
  const name = event.hook_event_name;
  const prev = live === null ? initialState() : live.state;
  const prevOpen = live === null ? [] : live.open;
  const toolUseId = isStr(event.tool_use_id) ? event.tool_use_id : null;

  let state = reduce(prev, event);
  let open = prevOpen;
  let dropped = live !== null && live.dropped;

  // Late events of a turn that already ended must not flip the activity back (QA issue 10). A turn has ended
  // after Stop (done), or when Claude waits with no tool open; an idle_prompt while a tool is still open (an
  // unanswered permission prompt) has not ended it, so that tool's Post still means working.
  const finished = live !== null
    && (prev.activity === 'done' || (prev.activity === 'waiting' && prevOpen.length === 0));
  // a permission request needs a running turn: after the turn ended it is a late hook
  if (finished && (name === 'PermissionRequest'
    || (name === 'Notification' && PERMISSION_TYPES.has(event.notification_type)))) return b;
  if (finished && (POST.has(name) || name === 'PermissionDenied')) {
    if (!POST.has(name) || toolUseId === null || !prevOpen.includes(toolUseId)) return b;
    state = state === prev ? prev : { ...state, activity: prev.activity, view: prev.view };
  }

  if (name === 'PreToolUse' && toolUseId !== null && typeof event.tool_name === 'string' && event.tool_name !== ''
    && !open.includes(toolUseId)) {
    open = [...open, toolUseId];
  } else if (POST.has(name) && toolUseId !== null && open.includes(toolUseId)) {
    open = open.filter((x) => x !== toolUseId);
  } else if (name === 'UserPromptSubmit') {
    open = [];
    dropped = false;
  }

  if (state === prev && sameList(open, prevOpen) && (live === null || dropped === live.dropped)) return b;

  const tick = b.tick + 1;
  const sessions = capSessions(withSession(b.sessions, id, { state, open, touched: tick, dropped }), id);
  const ended = b.ended.includes(id) ? b.ended.filter((x) => x !== id) : b.ended;
  return { ...b, sessions, ended, tick };
}

const PRIORITY = { permission: 4, waiting: 3, working: 2, done: 1 };

function pickShown(board) {
  let best = null;
  for (const k of Object.keys(board.sessions)) {
    const s = board.sessions[k];
    const rank = PRIORITY[s.state.activity] ?? 0;
    if (best === null || rank > best.rank || (rank === best.rank && s.touched > best.session.touched)) {
      best = { rank, session: s };
    }
  }
  return best === null ? null : best.session;
}

export function boardView(board) {
  const b = isValidBoard(board) ? board : initialBoard();
  const shown = pickShown(b);
  const overlay = (activity) => (b.locked ? 'insert-key' : b.offline ? 'offline' : activity);
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
      others: 0,
      diffIncomplete: false,
    };
  }
  const s = shown.state;
  return {
    view: overlay(s.activity),
    activity: s.activity,
    offline: b.offline,
    locked: b.locked,
    repo: s.repo ?? b.context.repo,
    branch: s.branch ?? b.context.branch,
    tool: s.tool,
    file: s.file,
    diff: { added: s.diff.added, removed: s.diff.removed },
    command: s.command,
    output: s.output,
    others: Object.keys(b.sessions).length - 1,
    diffIncomplete: shown.dropped,
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
