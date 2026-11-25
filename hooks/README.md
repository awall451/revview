# Hooks

Two Claude Code command hooks feed the bar from a real Claude Code session (charter stage 2):

- `event.mjs`: every event the state core uses except `PermissionRequest`. Posts the hook's stdin JSON unchanged to
  `http://127.0.0.1:$REVVIEW_PORT/event` (default port 8138) and, for a few events, a synthetic `RevviewContext`
  (repo and branch). Never prints, never blocks for long: see "event.mjs" below.
- `permission-request.mjs`: the `PermissionRequest` hook. It posts the request JSON (unchanged) to
  `/permission` and waits. If the driver answers with a wheel button, the server replies with `{behavior:'allow'}` or
  `{behavior:'deny',message}` and the hook prints the matching `hookSpecificOutput` for Claude Code. For an `AskUserQuestion` request it also accepts
  `{behavior:'allow',updatedInput:{questions,answers}}` (the request's own `questions` unchanged; each answer an exact
  option label of a question in them); any other shape is refused and the terminal dialog stays.

`settings.json` is the complete hooks block (with the placeholder `$REVVIEW_DIR`). `install.mjs` writes it into a
Claude Code settings file.

## Install

```
node $REVVIEW_DIR/hooks/install.mjs            # into $CLAUDE_CONFIG_DIR/settings.json, else ~/.claude/settings.json
node $REVVIEW_DIR/hooks/install.mjs --dry-run  # print the merged file, write nothing
node $REVVIEW_DIR/hooks/install.mjs --remove   # take revview's hooks out again
```

It replaces `$REVVIEW_DIR` with this repository's absolute path (refused if the path has `"`, `` ` ``, `$`, `\` or
control characters, since it goes inside a quoted bash word), keeps every other key and hook, removes revview's own
entries before adding them again (idempotent; after moving the repo, run it again). Own entries are recognised by
the trailing `# revview-hook` marker (a bash comment at the end of each command) and, migrated once, by the old
snippet form for this repo (`node <this repo>/hooks/permission-request.mjs`). Other tools' hooks, even ones named
`.../hooks/event.mjs`, are never touched. A `hooks.<Event>` that is not an array makes it exit 2 with the file
untouched. A symlinked settings file stays a symlink (the real file is written, the backup sits next to it). It copies an existing file once to
`settings.json.revview-backup`. `--settings <file>` picks another file. Run it as the user that runs Claude Code
(on the Pi: the user of the revview sessions, see `pi/README.md`). Install into ONE settings file only: the same
hook in user and project settings would post every event twice (a doubled diff, QA r3-07).

The server port must match: the hooks read `REVVIEW_PORT` from Claude Code's environment (default 8138, the
server's default too).

## Which events

| Event | Hook | Why |
| --- | --- | --- |
| SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionDenied, Notification, Stop, StopFailure, SubagentStop, SessionEnd, PreCompact, PostCompact | `event.mjs`, timeout 5 s | the state core (`src/state/`) uses them |
| PermissionRequest | `permission-request.mjs`, timeout 600 s | owned by `/permission` (wheel-button answers) |
| SubagentStart | none | the state core ignores it; each hook costs a node start |

PreCompact and PostCompact set and clear the "compacting" note on the bar (docs/DECISIONS.md, "Compaction note
(cycle 38)"). They are posted without `compact_summary` (the whole conversation summary, large and private) and
without `custom_instructions`; `trigger` is kept. They never cause a RevviewContext post.

## event.mjs

- Reads stdin, checks it is a JSON object with a string `hook_event_name`, posts the bytes unchanged (except PreCompact/PostCompact, see above).
- **Never posts `PermissionRequest`** (also if it were installed on that event by mistake): the server feeds it into
  the board from `/permission`; a second copy through `/event` would make a duplicate pending entry, and a button
  press would then do nothing. Never posts a name starting with `Revview` either (a payload cannot become a
  synthetic event). Pinned in `tests/unit/hook-event.test.js`.
- **Context**: after a successful post of `SessionStart` (not `compact`), `UserPromptSubmit`, `Stop`, or
  `PostToolUse` of `Bash` (a command may switch branches), it runs `git -C <cwd> rev-parse --show-toplevel
  --abbrev-ref HEAD` (no shell) and posts `{hook_event_name:'RevviewContext', session_id, cwd:<toplevel>, branch}`.
  The toplevel keeps the repo name when Claude `cd`s into a subdirectory; a detached HEAD or no git gives
  `branch: null` (and the payload's cwd).
- **Failure rule**: prints nothing on stdout and exits 0 on anything (server down, non-2xx, hang, bad stdin). The
  whole run has an absolute deadline, `REVVIEW_EVENT_WAIT_MS` (default 1000 ms, clamped to 50..3000), well inside
  the settings `timeout` of 5 s. A diagnostic line may go to stderr, as in the permission hook.
- **Oversize** stdin (over 1 MiB, e.g. an Edit of a large file): the first 1 MiB + 64 KiB is posted, the server
  answers 413 and, if it was a `PostToolUse` of Edit/Write/MultiEdit, marks that session's diff incomplete (`≥`),
  as it does for any oversize body. Any other oversize event is lost (the bar keeps its previous state for it).
- The hooks are synchronous: Claude waits for each (about 0.1 s here, mostly node start-up; slower on a Pi, bench
  HW3). Claude Code's `async` hook option is not used: background hooks could post a tool's Post before its Pre.

## Spoken summary on Stop

Built in WB5, off by default. With the wiring installed, set `"speakOnStop": true` in a copy of
`config/speech.json` and start the server with `--speech <copy>` (or `REVVIEW_SPEECH=<copy>`). The `Stop` event that
`event.mjs` posts carries `last_assistant_message`; the server speaks it when the selected session stops (see
`src/speech/README.md`; bench R12, untested; nothing has made a sound here).

## A Claude that dies without SessionEnd

A session revview started itself (a window of the `--sessions` runner) leaves the bar once its tmux window is missing from two
consecutive polls (about 10 s; DECISIONS "owned window gone"). A Claude that was not started by revview and dies without
`SessionEnd` still stays on the bar with its last state (the state core has no clock).

## permission-request.mjs: no decision means the terminal prompt stays

Connection refused, timeout, non-200, a malformed or extended response, or stdin that is not JSON
(or over 1 MiB): the hook prints nothing and exits 0. The normal terminal dialog is shown at once
anyway and stays. The hook never allows or denies by default, and an allow never carries
`updatedPermissions` (no "always allow").

## permission-request.mjs timeouts

| Where | Value | Why |
| --- | --- | --- |
| server wait per request | 540 s | ends first, answers the hook with no decision |
| hook wait (`REVVIEW_HOOK_WAIT_MS`) | 570 s (clamped to at most 590 s) | backstop if the server hangs |
| settings `timeout` | 600 s | Claude Code kills the hook last |

## Do not also post PermissionRequest to /event

The server feeds `PermissionRequest` from this hook into the board itself. Another hook posting the
same event to `/event` would create a duplicate pending entry. `event.mjs` skips it (see above).
