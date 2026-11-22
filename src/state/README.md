# State core

Pure logic that turns Claude Code hook events into the view state (no DOM, no I/O, no clock, no timers).

## API (`src/state/index.js`)

- `initialState()` returns a fresh state.
- `reduce(state, event)` returns the next state. It never mutates its input, never throws, and returns the
  SAME reference when nothing changes or the event is ignored. A `state` that is not a valid state object
  (null, undefined, ...) is replaced by `initialState()`.
- `replay(events, state = initialState())` folds events and returns the array of states after each event.
- `countDiff(event)`, `lineCount(s)` (diff.js); `LIMITS`, `stripAnsi`, `lastOutputLine`, `shortenCommand`,
  `shortenPath` (format.js); `STATES`, `isState` (states.js).

- `initialBoard()`, `reduceBoard(board, event)`, `boardView(board)`, `replayView(events, board)`,
  `MAX_SESSIONS` (board.js): the per-session layer, see "Board" below. `PAGE_ONLY_VIEWS`, `VIEWS` (states.js).

`STATES` are the views the state core emits: `working`, `waiting`, `permission`, `done`, `starting`, `offline`,
`insert-key`, `unknown` (nothing known yet: a fresh board or restarted server) and `ended` (Claude exited).
`PAGE_ONLY_VIEWS = ['no-link']` is drawn by the page when its SSE link is down and is never emitted here;
`VIEWS = [...STATES, ...PAGE_ONLY_VIEWS]`. `isState` accepts reducer states only.

## State shape (one session, `reduce`)

| field | meaning |
| --- | --- |
| `view` | what the screen shows: `locked ? 'insert-key' : offline ? 'offline' : activity` |
| `activity` | `unknown` (initial), `starting`, `working`, `waiting`, `permission` or `done` (derived from Claude events) |
| `offline`, `locked` | overlays from the synthetic events below |
| `repo` | last path segment of `cwd`; set by `SessionStart` and `RevviewContext`, otherwise only filled from a Claude event's `cwd` while still null |
| `branch` | only from `RevviewContext` |
| `tool`, `file` | current tool name and its target file (relative to cwd, shortened) |
| `diff` | `{added, removed}` running total for the current turn |
| `command`, `output` | last Bash command (shortened) and last non-empty output line (ANSI-stripped, shortened) |

## Events

| event | effect |
| --- | --- |
| `SessionStart` | activity `waiting` |
| `UserPromptSubmit` | `working`; new turn: diff 0/0, tool/file/command/output null |
| `PreToolUse` (needs `tool_name`) | `working`; tool, file (`file_path`/`notebook_path`); Bash: command, output null |
| `PermissionRequest` | `permission`; tool/file/command as PreToolUse |
| `PostToolUse` (needs `tool_name`) | `working`; tool, file; diff += `countDiff` (the only place diff is counted); Bash: command and output |
| `PostToolUseFailure` | `working`; Bash: output from `error`; no diff |
| `PermissionDenied` | `working` |
| `Notification` | `notification_type` `permission_prompt` / `worker_permission_prompt` -> `permission`; `idle_prompt` -> `waiting`; anything else ignored (message text is never used) |
| `Stop` | `done` |
| `StopFailure` | `waiting` |
| `SubagentStop`, `SubagentStart`, `SessionEnd`, `PreCompact`, `PostCompact`, unknown | ignored |
| `RevviewContext` `{cwd?, branch?}` (synthetic) | repo from cwd, branch (string or null) |
| `RevviewStarting` (synthetic) | `starting`; clears per-turn fields like UserPromptSubmit |
| `RevviewNetwork` `{online: boolean}` (synthetic) | `offline = !online` |
| `RevviewDataLock` `{locked: boolean}` (synthetic) | `locked` |

`repo` is never renamed by other events, so a hook fired from a subdirectory keeps the repo name. On `Stop`
(and `StopFailure`/idle) tool, file, command and output are kept on purpose: at `done` the driver can still
see the last command and its result (e.g. "2 passed"). Fields persist through `done`/`waiting` until the next
`UserPromptSubmit` resets them; the renderer decides what to show per state. Activity keeps updating under the
offline/locked overlays and shows again when they clear.

## Board (`board.js`)

`reduceBoard` keeps many sessions (key = `session_id`; an event without a usable one goes to the only live session if there is exactly one, else to the anonymous `''` session, which `others` never counts; subagent events carry
the parent's `session_id`, so they never make a second session). Pure, never throws, returns the SAME reference
when nothing changes. Board: `{phase, offline, locked, context: {repo, branch}, sessions, ended, tick, focus}`;
`sessions[id] = {state, open, touched, dropped, pending, pre}` (`state` from `reduce`, `open` = tool_use_ids
with a PreToolUse and no Post yet, `touched` = board tick of the last applied event, `pending` = unanswered
permission prompts, `pre` = the last PreToolUse per agent; `focus` = id of the session the bar shows, or null).

- Pending prompts: `pending = [{agent, tuid, tool, file, command, output, since}]`, `pre = [{agent, tuid,
  tool}]`; the agent key is `agent_id` if it is a non-empty string, else `''` (main thread). A
  `PermissionRequest` (no `tool_use_id` in Claude Code 2.1.330) takes the `tuid` of the agent's last PreToolUse
  when its tool is the same; it is appended unless the same agent+tuid is already pending. Only the main
  thread's request is "late" after Stop; a subagent's never is. A `permission_prompt` Notification adds a
  generic entry (`agent: null`) only when nothing is pending and the turn is not finished. The session's
  `state.activity` is NOT changed by them: the effective activity is `permission` while `pending` is not empty
  (and tool/file/command/output come from `pending[0]`). Answered (entry removed) by `PostToolUse`,
  `PostToolUseFailure`, `PermissionDenied` with the same `tool_use_id` (or, without a tuid, the same agent and
  tool; a main-thread Post also clears generic entries); `SubagentStop` clears that agent (and its `pre`);
  `Stop` clears the main-thread and generic entries, and a subagent's only when `background_tasks` is an array
  that does not list it as running; a driver prompt clears main-thread and generic entries (an Esc'd prompt
  sends nothing else); an injected `<task-notification>` prompt clears nothing.

- `RevviewNetwork`, `RevviewDataLock`: board overlays. `RevviewStarting`: clears all sessions and the `ended`
  list, phase `starting`. `RevviewContext`: applied to its live session if it has a `session_id` of one,
  otherwise to `board.context`.
- `RevviewDropped` (internal, sent by the server when an event body was too large to read): marks that live
  session `dropped` (the diff may be incomplete). A late `PostToolUse` of Edit/Write/MultiEdit after `Stop` that cannot be placed (no `tool_use_id`, or one not open) also marks it, since its lines are lost, or every live session without a usable id; an id the board
  does not know marks nothing. Reset by `UserPromptSubmit`.
- `SessionEnd` of a session the board never saw only remembers its id in `ended` (not `''`); the phase is not
  touched (an `unknown`/`starting` board stays so: one end proves nothing about the others).
- `SessionEnd`: removes the session and remembers its id in `ended` (last `MAX_ENDED = 256`; an older id can be resurrected by a late event, see DECISIONS "not solved"; the anonymous `''` session is
  never remembered). With no session left, phase is `ended` and `board.context` keeps its repo/branch. Later
  events of an ended id are ignored, except `SessionStart`, which recreates the session.
- Ignored events (the reducer returns the same state) never create a session.
- Late events: a session's turn has ended when it is `done`, or `waiting` with no tool open (an idle_prompt
  during an unanswered permission prompt has not ended it). Then `PermissionDenied` and Post* events never
  change its activity: a Post* whose `tool_use_id` is in `open` (it was running when `Stop` came) still
  updates output, diff and tool but keeps activity and view; any other is ignored. `PermissionRequest` and
  permission Notifications are ignored too (a permission needs a running turn). `PreToolUse` after `Stop` is
  accepted (Claude can start work on its own).
- A board that this module did not build (any session not of the shape above) is replaced by `initialBoard()`.
- At most `MAX_SESSIONS = 8` live sessions (the band hint `+N` has room for one digit); on overflow the session that needs the driver least is dropped (unknown/starting, then done, working, waiting; the least recently touched among equals; a crashed
  Claude never sends `SessionEnd`). A session at `permission` is never dropped: if all others need permission, the newcomer is still admitted and the cap is exceeded (`+N` may have two digits).
- Shown session = `focus` (recomputed after every change by `refocus(board, spoke)`; `spoke` = the session a
  driver prompt was applied to). In order: no live session -> null; a pending permission pre-empts (keep the
  focus if it has one, else the one asked first); the session the driver just spoke to; a focus that is no
  longer live -> the best of working > done > waiting > rest, then the highest `touched`; a focus that is
  idle/unknown/starting while another session works -> the most recently touched working one; else keep
  (sticky: other sessions' events never move it; a `done` focus stays until its idle_prompt). The cap avoids
  dropping the focus when another victim exists. `boardView` shows `sessions[focus]` when valid, else
  computes the same rule without storing it.
- `boardView` branch: `s.branch`, else `board.context.branch` only when `board.context.repo` is the repo shown.

`boardView(board)` is the flat state the page renders, always with exactly these keys: `view, activity,
offline, locked, repo, branch, tool, file, diff {added, removed}, command, output, others, diffIncomplete`.
With a shown session these are its fields (`others` = other live sessions, `diffIncomplete` = its `dropped`,
repo/branch fall back to `board.context`). With no live session `activity` is the board phase
(`unknown`, `starting`, `ended`), repo/branch come from `board.context`, the rest is null/0/false.
`view = locked ? 'insert-key' : offline ? 'offline' : activity`. `replayView(events, board)` returns the
`boardView` after each event; the recordings' expected files and the emulator fixtures use it.

## Diff counting

Edit/Write/MultiEdit only. Prefers `tool_response.structuredPatch` (`+` lines added, `-` removed); a Write
with `type: 'create'` counts the lines of its content; otherwise falls back to `tool_input`
(`old_string`/`new_string`, `edits`, `content`).

## Limits

`LIMITS = {path: 200, command: 60, output: 80}`; longer text is cut with a trailing `…` (the path limit is only a
payload guard, the view fits the file to pixels; paths keep the file
name and the trailing directories after `…/`).

## Tests and expected files

`tests/unit/replay.test.js` replays (through `replayView`) every `fixtures/sessions/*.jsonl` (real Claude Code 2.1.330 recordings)
and compares with `<name>.expected.json`. Regenerate after an intended change:

    REVVIEW_UPDATE_EXPECTED=1 npm run test:unit

then review the diff of the expected files.
