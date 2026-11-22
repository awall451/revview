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
  };
}

function isValidSession(s) {
  return isObj(s) && isObj(s.state) && typeof s.state.activity === 'string' && isObj(s.state.diff)
    && Array.isArray(s.open) && Array.isArray(s.pending) && Array.isArray(s.pre) && Number.isInteger(s.touched) && typeof s.dropped === 'boolean';
}

// Only boards this module built are used; anything else is replaced, so nothing below can throw on it.
function isValidBoard(b) {
  return isObj(b) && typeof b.phase === 'string' && isObj(b.context) && isObj(b.sessions)
    && Array.isArray(b.ended) && Number.isInteger(b.tick) && (b.focus === null || typeof b.focus === 'string')
    && Object.keys(b.sessions).every((k) => isValidSession(b.sessions[k]));
}

const keyOf = (event) => (isStr(event.session_id) ? event.session_id : '');

// An event without a usable session_id belongs to the one live session when there is exactly one (hand-posted
// or old-style hooks must not make a second session and a false "+1"); otherwise to the anonymous '' session.
function targetOf(event, sessions) {
  if (isStr(event.session_id)) return event.session_id;
  const real = Object.keys(sessions).filter((k) => k !== '');
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
function capSessions(sessions, keepId, focus) {
  let out = sessions;
  while (Object.keys(out).length > MAX_SESSIONS) {
    let victim = null;
    for (const k of Object.keys(out)) {
      if (k === keepId || act(out[k]) === 'permission') continue;
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
// the focus if it has one, else the one asked first); the session the driver just spoke to; a dead focus falls
// back to the busiest (working > done > waiting > rest, most recently touched); a focus that is idle or
// unknown gives way to a working session; else keep it (sticky: other sessions' events never move it).
function pickFocus(b, spoke) {
  const ids = Object.keys(b.sessions);
  if (ids.length === 0) return null;
  const sess = (k) => b.sessions[k];
  const asking = ids.filter((k) => sess(k).pending.length > 0);
  if (asking.length > 0) {
    if (b.focus !== null && asking.includes(b.focus)) return b.focus;
    return asking.reduce((best, k) => (sess(k).pending[0].since < sess(best).pending[0].since ? k : best));
  }
  if (spoke !== null && has(b.sessions, spoke)) return spoke;
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
  const next = reduceInner(b, event);
  const tid = targetOf(event, b.sessions);
  const spoke = isDriverPrompt(event) && has(next.sessions, tid) ? tid : null;
  // a driver prompt that changes nothing else (the session was already working) still moves the focus
  if (next === b && spoke === null) return b;
  const focus = pickFocus(next, spoke);
  return focus === next.focus ? next : { ...next, focus };
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
      // without an id the lost Edit/Write came from a session that is in a turn (working, asking, a tool open);
      // if none is, from the shown one (a late result after Stop). Never from every session on the board.
      const live1 = isStr(event.session_id) && live !== null;
      let hit = (s) => s === live;
      if (!live1) {
        const inTurn = (s) => act(s) === 'working' || act(s) === 'permission' || s.open.length > 0;
        const some = Object.keys(b.sessions).some((k) => inTurn(b.sessions[k]));
        const shownKey = b.focus !== null && has(b.sessions, b.focus) ? b.focus : pickFocus(b, null);
        hit = some ? inTurn : (s) => shownKey !== null && s === b.sessions[shownKey];
      }
      const sessions = mapSessions(b.sessions, (s) => (s.dropped || !hit(s) ? s : { ...s, dropped: true }));
      return sessions === b.sessions ? b : { ...b, sessions };
    }
    case 'SessionEnd': {
      if (tlive === null) {
        // a session the board never saw ended: it proves nothing about the phase (the others may still run)
        return tid === '' || b.ended.includes(tid) ? b : { ...b, ended: pushEnded(b.ended, tid) };
      }
      const sessions = withoutSession(b.sessions, tid);
      // the anonymous session ('') is never remembered as ended, so later id-less events still count
      const ended = tid === '' ? b.ended : pushEnded(b.ended, tid);
      if (Object.keys(sessions).length > 0) return { ...b, sessions, ended };
      const repo = tlive.state.repo !== null ? tlive.state.repo : b.context.repo;
      const branch = tlive.state.branch !== null ? tlive.state.branch : b.context.branch;
      return { ...b, sessions, ended, phase: 'ended', context: { repo, branch } };
    }
    default:
      break;
  }

  if (name !== 'SessionStart' && b.ended.includes(tid)) return b;
  return applyToSession(b, tlive, tid, event);
}

const DIFF_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const POST = new Set(['PostToolUse', 'PostToolUseFailure']);
const PERMISSION_TYPES = new Set(['permission_prompt', 'worker_permission_prompt']);

const withoutPending = (pending, drop) => {
  const kept = pending.filter((p) => !drop(p));
  return kept.length === pending.length ? pending : kept;
};

const runningAgent = (event, agent) => event.background_tasks.some((t) => isObj(t) && t.id === agent && t.status === 'running');

// Pending permission prompts after `event` (arrays keep their reference when nothing changes).
function pendingAfter(pending, event, agent, toolUseId) {
  const name = event.hook_event_name;
  if (POST.has(name) || name === 'PermissionDenied') {
    return withoutPending(pending, (p) => (toolUseId !== null && p.tuid === toolUseId)
      || (p.tuid === null && p.agent === agent && p.tool === event.tool_name)
      || (p.agent === null && agent === ''));
  }
  if (name === 'SubagentStop') return isStr(event.agent_id) ? withoutPending(pending, (p) => p.agent === event.agent_id) : pending;
  if (name === 'Stop') {
    return withoutPending(pending, (p) => p.agent === '' || p.agent === null
      || (Array.isArray(event.background_tasks) && !runningAgent(event, p.agent)));
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

  let pending = pendingAfter(prevPending, event, agent, toolUseId);
  let pre = prevPre;
  if (name === 'SubagentStop' && isStr(event.agent_id)) pre = withoutPending(prevPre, (p) => p.agent === event.agent_id);
  if (name === 'PreToolUse' && toolUseId !== null && isStr(event.tool_name)) {
    pre = [...prevPre.filter((p) => p.agent !== agent), { agent, tuid: toolUseId, tool: event.tool_name }];
  }

  // Commits the result; the board is returned as is when nothing changed (an ignored event makes no session).
  const commit = (state, open, dropped) => {
    if (state === prev && sameList(open, prevOpen) && (live === null || dropped === live.dropped)
      && pending === prevPending && pre === prevPre) return b;
    const tick = b.tick + 1;
    const sessions = capSessions(withSession(b.sessions, id, { state, open, touched: tick, dropped, pending, pre }), id, b.focus);
    const ended = b.ended.includes(id) ? b.ended.filter((x) => x !== id) : b.ended;
    return { ...b, sessions, ended, tick };
  };
  const prevDropped = live !== null && live.dropped;

  // The turn's `finished` flag decides what a late hook is. Pending prompts are kept beside the state: the
  // state's activity never becomes `permission` here, `act()` derives it from `pending`.
  const finished = live !== null
    && (prev.activity === 'done' || (prev.activity === 'waiting' && prevOpen.length === 0));

  if (name === 'PermissionRequest' && isStr(event.tool_name)) {
    if (agent === '' && finished) return b; // a main-thread request needs a running turn
    const entry = pre.find((p) => p.agent === agent);
    const tuid = entry !== undefined && entry.tool === event.tool_name ? entry.tuid : null;
    if (tuid !== null && pending.some((p) => p.agent === agent && p.tuid === tuid)) return b;
    const shown = reduce(prev, event);
    pending = [...pending, { agent, tuid, tool: shown.tool, file: shown.file, command: shown.command, output: shown.output, since: b.tick + 1 }];
    // the state stays as it was (only a repo the session still lacks is taken from the event)
    const state = prev.repo === null && shown.repo !== null ? { ...prev, repo: shown.repo } : prev;
    return commit(state, prevOpen, prevDropped);
  }
  if (name === 'Notification' && PERMISSION_TYPES.has(event.notification_type)) {
    if (pending.length > 0 || finished) return b;
    pending = [{ agent: null, tuid: null, tool: prev.tool, file: prev.file, command: prev.command, output: prev.output, since: b.tick + 1 }];
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
  } else if (POST.has(name) && toolUseId !== null && open.includes(toolUseId)) {
    open = open.filter((x) => x !== toolUseId);
  } else if (isDriverPrompt(event)) {
    open = [];
    dropped = false;
  }

  return commit(state, open, dropped);
}

export function boardView(board) {
  const b = isValidBoard(board) ? board : initialBoard();
  const shownKey = b.focus !== null && has(b.sessions, b.focus) ? b.focus : pickFocus(b, null);
  const shown = shownKey === null ? null : b.sessions[shownKey];
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
    others: Object.keys(b.sessions).filter((k) => k !== '').length - (shownKey === '' ? 0 : 1),
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
