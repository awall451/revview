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

`reduceBoard` keeps many sessions (key = `session_id`, or `''` for events without one; subagent events carry
the parent's `session_id`, so they never make a second session). Pure, never throws, returns the SAME reference
when nothing changes. Board: `{phase, offline, locked, context: {repo, branch}, sessions, ended, tick}`;
`sessions[id] = {state, open, touched, dropped}` (`state` from `reduce`, `open` = tool_use_ids with a
PreToolUse and no Post yet, `touched` = board tick of the last applied event).

- `RevviewNetwork`, `RevviewDataLock`: board overlays. `RevviewStarting`: clears all sessions and the `ended`
  list, phase `starting`. `RevviewContext`: applied to its live session if it has a `session_id` of one,
  otherwise to `board.context`.
- `RevviewDropped` (internal, sent by the server when an event body was too large to read): marks that live
  session `dropped` (the diff may be incomplete), or every live session without a usable id; an id the board
  does not know marks nothing. Reset by `UserPromptSubmit`.
- `SessionEnd`: removes the session and remembers its id in `ended` (last 16; the anonymous `''` session is
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
- At most `MAX_SESSIONS = 8` live sessions (the band hint `+N` has room for one digit); on overflow the least recently touched is dropped (a crashed
  Claude never sends `SessionEnd`).
- Shown session: priority `permission` > `waiting` > `working` > `done` > anything else; tie -> highest `touched`.

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
