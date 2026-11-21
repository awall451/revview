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

## State shape

| field | meaning |
| --- | --- |
| `view` | what the screen shows: `locked ? 'insert-key' : offline ? 'offline' : activity` |
| `activity` | `starting`, `working`, `waiting`, `permission` or `done` (derived from Claude events) |
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

## Diff counting

Edit/Write/MultiEdit only. Prefers `tool_response.structuredPatch` (`+` lines added, `-` removed); a Write
with `type: 'create'` counts the lines of its content; otherwise falls back to `tool_input`
(`old_string`/`new_string`, `edits`, `content`).

## Limits

`LIMITS = {path: 40, command: 60, output: 80}`; longer text is cut with a trailing `…` (paths keep the file
name and the trailing directories after `…/`).

## Tests and expected files

`tests/unit/replay.test.js` replays every `fixtures/sessions/*.jsonl` (real Claude Code 2.1.330 recordings)
and compares with `<name>.expected.json`. Regenerate after an intended change:

    REVVIEW_UPDATE_EXPECTED=1 npm run test:unit

then review the diff of the expected files.
