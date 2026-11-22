// Pure reducer: (state, hook event) -> state. No clock, I/O, randomness or timers.
import { countDiff } from './diff.js';
import { lastOutputLine, relativeTo, shortenCommand, shortenPath } from './format.js';

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isStr = (x) => typeof x === 'string' && x !== '';

export function initialState() {
  return {
    view: 'unknown',
    activity: 'unknown',
    offline: false,
    locked: false,
    repo: null,
    branch: null,
    tool: null,
    file: null,
    diff: { added: 0, removed: 0 },
    command: null,
    output: null,
  };
}

const TURN_RESET = { tool: null, file: null, command: null, output: null, diff: { added: 0, removed: 0 } };

function computeView(s) {
  return s.locked ? 'insert-key' : s.offline ? 'offline' : s.activity;
}

function repoFromCwd(cwd) {
  if (typeof cwd !== 'string') return null;
  const parts = cwd.split('/').filter((x) => x !== '');
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

function targetFile(event) {
  const input = isObj(event.tool_input) ? event.tool_input : {};
  const p = typeof input.file_path === 'string' ? input.file_path : input.notebook_path;
  return typeof p === 'string' ? shortenPath(relativeTo(p, event.cwd)) : null;
}

function bashCommand(event) {
  // undefined: no string command (keep the previous one); null: blank command (clear it).
  if (event.tool_name !== 'Bash' || !isObj(event.tool_input)) return undefined;
  return typeof event.tool_input.command === 'string' ? shortenCommand(event.tool_input.command) : undefined;
}

// Fields common to PreToolUse / PermissionRequest / PostToolUse(Failure).
function toolPatch(event, activity) {
  const patch = { activity, tool: event.tool_name, file: targetFile(event) };
  const command = bashCommand(event);
  if (command !== undefined) patch.command = command;
  return patch;
}

// True for a UserPromptSubmit the driver typed. Claude Code 2.1.330 also fires UserPromptSubmit for prompts it
// injects itself: a `<task-notification>` when a background subagent ends (recorded, no `source` field), and
// the input schema's optional `source` ("user", "sdk", "system", "loop_wakeup", ...; from the binary).
export function isDriverPrompt(event) {
  if (!isObj(event) || event.hook_event_name !== 'UserPromptSubmit') return false;
  if (event.source !== undefined && event.source !== 'user') return false;
  return !(typeof event.prompt === 'string' && event.prompt.trimStart().startsWith('<task-notification>'));
}

// A Stop of the main turn while background subagents still run (Claude Code 2.1.330 lists them in
// `background_tasks`, recorded) does not end the work: their results start a new turn by themselves.
function subagentsRunning(event) {
  return Array.isArray(event.background_tasks)
    && event.background_tasks.some((t) => isObj(t) && t.type === 'subagent' && t.status === 'running');
}

// Returns a patch (object) to merge into the state, or null to ignore the event.
function patchFor(event) {
  switch (event.hook_event_name) {
    case 'SessionStart':
      // source "compact" follows a compaction (auto in the middle of a turn, or /compact): nothing changed
      return event.source === 'compact' ? null : { activity: 'waiting' };
    case 'UserPromptSubmit':
      return isDriverPrompt(event) ? { activity: 'working', ...TURN_RESET } : { activity: 'working' };
    case 'PreToolUse': {
      if (!isStr(event.tool_name)) return null;
      const patch = toolPatch(event, 'working');
      if ('command' in patch) patch.output = null;
      return patch;
    }
    case 'PermissionRequest':
      return isStr(event.tool_name) ? toolPatch(event, 'permission') : null;
    case 'PostToolUse': {
      if (!isStr(event.tool_name)) return null;
      const patch = toolPatch(event, 'working');
      patch.addDiff = countDiff(event);
      if (event.tool_name === 'Bash') patch.output = lastOutputLine(event.tool_response);
      return patch;
    }
    case 'PostToolUseFailure': {
      if (!isStr(event.tool_name)) return null;
      const patch = toolPatch(event, 'working');
      if (event.tool_name === 'Bash') patch.output = lastOutputLine(event.error);
      return patch;
    }
    case 'PermissionDenied':
      return { activity: 'working' };
    case 'Notification':
      if (event.notification_type === 'permission_prompt' || event.notification_type === 'worker_permission_prompt') {
        return { activity: 'permission' };
      }
      return event.notification_type === 'idle_prompt' ? { activity: 'waiting' } : null;
    case 'Stop':
      return { activity: subagentsRunning(event) ? 'working' : 'done' };
    case 'StopFailure':
      return { activity: 'waiting' };
    default:
      return null;
  }
}

// Synthetic Revview* events: return a patch or null.
function syntheticPatch(event) {
  switch (event.hook_event_name) {
    case 'RevviewContext': {
      const patch = {};
      const repo = repoFromCwd(event.cwd);
      if (repo !== null) patch.repo = repo;
      if (typeof event.branch === 'string' || event.branch === null) patch.branch = event.branch;
      return 'repo' in patch || 'branch' in patch ? patch : null;
    }
    case 'RevviewStarting':
      return { activity: 'starting', ...TURN_RESET };
    case 'RevviewNetwork':
      return typeof event.online === 'boolean' ? { offline: !event.online } : null;
    case 'RevviewDataLock':
      return typeof event.locked === 'boolean' ? { locked: event.locked } : null;
    default:
      return null;
  }
}

function isValidState(s) {
  return isObj(s) && typeof s.activity === 'string' && isObj(s.diff);
}

export function reduce(state, event) {
  const base = isValidState(state) ? state : initialState();
  if (!isObj(event) || typeof event.hook_event_name !== 'string') return base;

  let patch = syntheticPatch(event);
  if (patch === null) {
    patch = patchFor(event);
    if (patch === null) return base;
    // Only SessionStart sets repo; other events fill it in when still unknown.
    const repo = repoFromCwd(event.cwd);
    if (repo !== null && (event.hook_event_name === 'SessionStart' || base.repo === null)) patch.repo = repo;
  }

  const { addDiff, ...fields } = patch;
  const next = { ...base, ...fields };
  if (addDiff && (addDiff.added !== 0 || addDiff.removed !== 0)) {
    next.diff = { added: base.diff.added + addDiff.added, removed: base.diff.removed + addDiff.removed };
  }
  next.view = computeView(next);

  const changed = Object.keys(next).some((k) => (k === 'diff'
    ? next.diff.added !== base.diff.added || next.diff.removed !== base.diff.removed
    : next[k] !== base[k]));
  return changed ? next : base;
}

// Folds events from `state` (default initialState()); returns the state after each event.
export function replay(events, state = initialState()) {
  const out = [];
  let s = state;
  for (const ev of events) {
    s = reduce(s, ev);
    out.push(s);
  }
  return out;
}
