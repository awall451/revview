// Pure reducer: (state, hook event) -> state. No clock, I/O, randomness or timers.
import { countDiff } from './diff.js';
import { stripAnsi, lastOutputLines, displayTool, relativeTo, shortenCommand, shortenPath, shortenQuery, shortenUrl } from './format.js';

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
    outputLines: [],
    failed: null,
    compacting: false,
  };
}

const TURN_RESET = { compacting: false, tool: null, file: null, command: null, output: null, outputLines: [], diff: { added: 0, removed: 0 } };

function computeView(s) {
  // needing the driver outranks OFFLINE (the page shows offline as a secondary mark)
  return s.locked ? 'insert-key' : s.offline && s.activity !== 'permission' ? 'offline' : s.activity;
}

function repoFromCwd(cwd) {
  if (typeof cwd !== 'string') return null;
  const parts = cwd.split('/').filter((x) => x !== '');
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

function targetFile(event) {
  const input = isObj(event.tool_input) ? event.tool_input : {};
  if (event.tool_name === 'WebFetch') return shortenUrl(input.url);
  if (event.tool_name === 'WebSearch') return shortenQuery(input.query);
  const p = typeof input.file_path === 'string' ? input.file_path : input.notebook_path;
  return typeof p === 'string' ? shortenPath(relativeTo(p, event.cwd)) : null;
}

function bashCommand(event) {
  // undefined: no string command (keep the previous one); null: blank command (clear it).
  if (event.tool_name !== 'Bash' || !isObj(event.tool_input)) return undefined;
  return typeof event.tool_input.command === 'string' ? shortenCommand(event.tool_input.command) : undefined;
}

// output is always the last of outputLines.
function setOutput(patch, lines) {
  patch.outputLines = lines;
  patch.output = lines.at(-1) ?? null;
}

const sameLines = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

// Fields common to PreToolUse / PermissionRequest / PostToolUse(Failure).
function toolPatch(event, activity) {
  const patch = { activity, tool: displayTool(event.tool_name), file: targetFile(event) };
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

const ERROR_WORD = /^[a-z_]{1,40}$/;

function failedOf(event) {
  const error = typeof event.error === 'string' && ERROR_WORD.test(event.error) ? event.error : 'unknown';
  // up to 200 code points; a longer message is cut to 199 and ends with an ellipsis (as command and output rows do)
  const cps = typeof event.last_assistant_message === 'string'
    ? Array.from(stripAnsi(event.last_assistant_message).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()) : [];
  const text = cps.length > 200 ? cps.slice(0, 199).join('').trim() + '…' : cps.join('');
  return { error, message: text === '' ? null : text };
}

// Returns a patch (object) to merge into the state, or null to ignore the event.
function patchFor(event) {
  switch (event.hook_event_name) {
    case 'SessionStart':
      // source "compact" follows a compaction (auto in the middle of a turn, or /compact): the activity did not
      // change (reduce() still clears the compacting mark, as it does for every event but SubagentStop)
      return event.source === 'compact' ? null : { activity: 'waiting' };
    case 'UserPromptSubmit':
      return isDriverPrompt(event) ? { activity: 'working', ...TURN_RESET } : { activity: 'working' };
    case 'PreToolUse': {
      if (!isStr(event.tool_name)) return null;
      const patch = toolPatch(event, 'working');
      if ('command' in patch) setOutput(patch, []);
      return patch;
    }
    case 'PermissionRequest': {
      // the prompt describes the requested call only: a call waiting for permission has produced nothing
      if (!isStr(event.tool_name)) return null;
      const patch = toolPatch(event, 'permission');
      if (!('command' in patch)) patch.command = null;
      setOutput(patch, []);
      return patch;
    }
    case 'PostToolUse': {
      if (!isStr(event.tool_name)) return null;
      const patch = toolPatch(event, 'working');
      patch.addDiff = countDiff(event);
      if (event.tool_name === 'Bash') setOutput(patch, lastOutputLines(event.tool_response));
      return patch;
    }
    case 'PostToolUseFailure': {
      if (!isStr(event.tool_name)) return null;
      const patch = toolPatch(event, 'working');
      if (event.tool_name === 'Bash') setOutput(patch, lastOutputLines(event.error));
      return patch;
    }
    case 'PermissionDenied':
      return { activity: 'working' };
    case 'Notification':
      if (event.notification_type === 'permission_prompt' || event.notification_type === 'worker_permission_prompt') {
        return { activity: 'permission' };
      }
      return event.notification_type === 'idle_prompt' ? { activity: 'waiting' } : null;
    case 'PreCompact':
      // compaction starts (auto in the middle of a turn, or /compact at the prompt): only the mark; the activity stays.
      // Not always followed by a compaction (recorded), so the next event of any kind clears the mark again.
      return { compacting: true };
    case 'PostCompact':
      // the compaction is over (the mark is cleared for every event but SubagentStop in reduce()); activity unchanged
      return {};
    case 'Stop':
      return { activity: subagentsRunning(event) ? 'working' : 'done' };
    case 'StopFailure':
      // the turn ended with an API error: the driver is waited for (the terminal says "Resend your message"), and
      // `failed` says the work did not finish. Built from the recorded payload only (fixtures/sessions/hook-wiring).
      return { activity: 'waiting', failed: failedOf(event) };
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
      return { activity: 'starting', failed: null, ...TURN_RESET };
    case 'RevviewNetwork':
      return typeof event.online === 'boolean' ? { offline: !event.online } : null;
    case 'RevviewDataLock':
      return typeof event.locked === 'boolean' ? { locked: event.locked } : null;
    default:
      return null;
  }
}

const sameFailed = (a, b) => (a === null || b === null || a === undefined || b === undefined ? (a ?? null) === (b ?? null) : a.error === b.error && a.message === b.message);

function isValidState(s) {
  return isObj(s) && typeof s.activity === 'string' && isObj(s.diff);
}

export function reduce(state, event) {
  const base = isValidState(state) ? state : initialState();
  if (!isObj(event) || typeof event.hook_event_name !== 'string') return base;

  let patch = syntheticPatch(event);
  if (patch === null) {
    patch = patchFor(event);
    // The compacting mark lasts until the next main-thread Claude hook event, whatever it is; an event otherwise
    // ignored still clears it. Kept by: the summariser's own SubagentStop (recorded), any event of a subagent
    // (it carries agent_id; one may still run during a main-thread compaction) and an idle_prompt Notification
    // (a /compact typed at an idle prompt that runs long).
    const mid = event.hook_event_name === 'SubagentStop' || isStr(event.agent_id)
      || (event.hook_event_name === 'Notification' && event.notification_type === 'idle_prompt');
    if (patch === null) return base.compacting === true && !mid ? { ...base, compacting: false } : base;
    if (event.hook_event_name !== 'PreCompact' && !mid) patch.compacting = false;
    // any event that changes the turn ends a failed turn; idle_prompt (Claude Code still idle ~60 s later) and a
    // compaction (a /compact after the failure: the turn is still not redone) do not
    const keepsFailed = (event.hook_event_name === 'Notification' && event.notification_type === 'idle_prompt')
      || event.hook_event_name === 'PreCompact' || event.hook_event_name === 'PostCompact';
    if (!('failed' in patch) && !keepsFailed) patch.failed = null;
    // Only SessionStart sets repo; other events fill it in when still unknown.
    const repo = repoFromCwd(event.cwd);
    if (repo !== null && (event.hook_event_name === 'SessionStart' || base.repo === null)) patch.repo = repo;
  }

  const { addDiff, ...fields } = patch;
  const next = { ...base, ...fields };
  if (addDiff && (addDiff.added !== 0 || addDiff.removed !== 0)) {
    next.diff = { added: base.diff.added + addDiff.added, removed: base.diff.removed + addDiff.removed };
  }
  if (sameLines(next.outputLines, base.outputLines)) next.outputLines = base.outputLines;
  next.view = computeView(next);

  const changed = Object.keys(next).some((k) => (k === 'diff'
    ? next.diff.added !== base.diff.added || next.diff.removed !== base.diff.removed
    : k === 'failed' ? !sameFailed(next.failed, base.failed) : next[k] !== base[k]));
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
