# State core

Pure logic that turns Claude Code hook events into the view state (no DOM, no I/O, no clock, no timers).

## API (`src/state/index.js`)

- `initialState()` returns a fresh state.
- `reduce(state, event)` returns the next state. It never mutates its input, never throws, and returns the
  SAME reference when nothing changes or the event is ignored. A `state` that is not a valid state object
  (null, undefined, ...) is replaced by `initialState()`.
- `replay(events, state = initialState())` folds events and returns the array of states after each event.
- `isDriverPrompt(event)`: true for a `UserPromptSubmit` the driver typed (not one Claude Code injected).
- `countDiff(event)`, `lineCount(s)` (diff.js); `LIMITS`, `stripAnsi`, `lastOutputLine`, `shortenCommand`,
  `shortenPath` (format.js); `STATES`, `isState` (states.js).

- `initialBoard()`, `reduceBoard(board, event)`, `boardView(board)`, `replayView(events, board)`,
  `pendingPrompts(board)`, `shownPrompt(board)`, `MAX_SESSIONS` (board.js): the per-session layer, see "Board" below. `PAGE_ONLY_VIEWS`, `VIEWS` (states.js).

`STATES` are the views the state core emits: `working`, `waiting`, `permission`, `done`, `starting`, `offline`,
`insert-key`, `unknown` (nothing known yet: a fresh board or restarted server) and `ended` (Claude exited).
`PAGE_ONLY_VIEWS = ['no-link']` is drawn by the page when its SSE link is down and is never emitted here;
`VIEWS = [...STATES, ...PAGE_ONLY_VIEWS]`. `isState` accepts reducer states only.

## State shape (one session, `reduce`)

| field | meaning |
| --- | --- |
| `view` | what the screen shows: `locked ? 'insert-key' : offline && activity !== 'permission' ? 'offline' : activity` (needing the driver outranks OFFLINE; `offline` stays true as a secondary mark) |
| `activity` | `unknown` (initial), `starting`, `working`, `waiting`, `permission` or `done` (derived from Claude events) |
| `offline`, `locked` | overlays from the synthetic events below |
| `repo` | last path segment of `cwd`; set by `SessionStart` and `RevviewContext`, otherwise only filled from a Claude event's `cwd` while still null |
| `branch` | only from `RevviewContext` |
| `tool`, `file` | current tool name and its target file (relative to cwd, shortened) |
| `diff` | `{added, removed}` running total for the current turn |
| `command`, `output`, `outputLines` | last Bash command (whitespace collapsed, at most 300 code points), last non-empty output line (ANSI-stripped, at most 80), and `outputLines`: the last 3 non-empty output lines, oldest first, cleaned like `output`, each at most 80; `[]` when none. `output` is kept as the last line for compatibility: `outputLines.at(-1) ?? null === output` always |

## Events

| event | effect |
| --- | --- |
| `SessionStart` | activity `waiting`; `source: "compact"` (after an auto compaction mid-turn or `/compact`, recorded) is ignored |
| `UserPromptSubmit` | `working`; a driver prompt (`isDriverPrompt`) starts a new turn: diff 0/0, tool/file/command/output null, outputLines []. A prompt Claude Code injects itself (`<task-notification>` when a background subagent ends, recorded; or a `source` other than `user`) only sets `working` |
| `PreToolUse` (needs `tool_name`) | `working`; tool, file (`file_path`/`notebook_path`); Bash: command, output null, outputLines [] |
| `PermissionRequest` | `permission`; tool, file from the request; command = the request's own Bash command (cleaned as PreToolUse), else null; output null, outputLines [] always (a call waiting for permission has produced nothing) |
| `PostToolUse` (needs `tool_name`) | `working`; tool, file; diff += `countDiff` (the only place diff is counted); Bash: command, output and outputLines |
| `PostToolUseFailure` | `working`; Bash: output and outputLines from `error`; no diff |
| `PermissionDenied` | `working` |
| `Notification` | `notification_type` `permission_prompt` / `worker_permission_prompt` -> `permission`; `idle_prompt` -> `waiting`; anything else ignored (message text is never used) |
| `Stop` | `done`; `working` while `background_tasks` lists a `subagent` with status `running` (async subagents, recorded) |
| `StopFailure` | `waiting` |
| `SubagentStop`, `SubagentStart`, `SessionEnd`, `PreCompact`, `PostCompact`, unknown | ignored |
| `RevviewContext` `{cwd?, branch?}` (synthetic) | repo from cwd, branch (string or null) |
| `RevviewStarting` (synthetic) | `starting`; clears per-turn fields like UserPromptSubmit |
| `RevviewNetwork` `{online: boolean}` (synthetic) | `offline = !online` |
| `RevviewDataLock` `{locked: boolean}` (synthetic) | `locked` |
| `RevviewInput` `{present: boolean}` (synthetic, from the server's input reader) | board `buttons` = `present` (wheel buttons found or not); a non-boolean is ignored; `RevviewStarting` does not clear it |
| `RevviewButton` `{button, gesture}` (synthetic) | ignored by the board (same reference, never makes a session) |

`repo` is never renamed by other events, so a hook fired from a subdirectory keeps the repo name. On `Stop`
(and `StopFailure`/idle) tool, file, command, output and outputLines are kept on purpose: at `done` the driver can still
see the last command and its result (e.g. "2 passed"). Fields persist through `done`/`waiting` until the next
`UserPromptSubmit` resets them; the renderer decides what to show per state. Activity keeps updating under the
offline/locked overlays and shows again when they clear.

## Board (`board.js`)

`reduceBoard` keeps many sessions (key = `session_id`; an event without a usable one goes to the only live session if there is exactly one, else to the anonymous `''` session, which `others` never counts; subagent events carry
the parent's `session_id`, so they never make a second session). Pure, never throws, returns the SAME reference
when nothing changes. Board: `{phase, offline, locked, context: {repo, branch}, sessions, ended, tick, focus, spokenTo, buttons}`; `buttons` = `null` (not known yet) | `true` | `false`, set only by `RevviewInput`;
`sessions[id] = {state, open, touched, dropped, pending, pre}` (`state` from `reduce`, `open` = tool_use_ids
with a PreToolUse and no Post yet, `touched` = board tick of the last applied event, `pending` = unanswered
permission prompts, `pre` = the open PreToolUse calls per agent (at most 32); `focus` = id of the session the bar shows, or null; `spokenTo` = id of the session the driver last spoke to (a real driver prompt only), or null).

- Pending prompts: `pending = [{agent, tuid, tool, file, command, output, outputLines, since}]`, `pre = [{agent, tuid,
  tool, input}]`; the agent key is `agent_id` if it is a non-empty string, else `''` (main thread). A
  `PermissionRequest` (no `tool_use_id` in Claude Code 2.1.330) is tied to a `tuid` only when exactly one open
  PreToolUse of that agent has the same tool (and the same input, if the request carries one), else the `tuid` stays empty; it is appended unless the same agent+tuid is already pending. Only the main
  thread's request is "late" after Stop; a subagent's never is. A `permission_prompt` Notification adds a
  generic entry (`agent: null`) only when nothing is pending and the turn is not finished; it carries no tool, so the entry takes tool and file from the session state only while a call is open (command only if that tool is Bash), else all three are null. An entry's output is always null and outputLines [] (it describes the requested call only: a request's own tool/file/Bash command). The session's
  `state.activity` is NOT changed by them: the effective activity is `permission` while `pending` is not empty
  (and tool/file/command/output/outputLines come from `pending[0]`). Answered (entry removed) by `PostToolUse`,
  `PostToolUseFailure`, `PermissionDenied` with the same `tool_use_id`. An entry NOT tied to a call (`tuid` null: its Post came first or was lost, or the call was ambiguous) is cleared by any later tool event of the SAME agent key (`PreToolUse` with a `tool_use_id`, `PostToolUse`, `PostToolUseFailure`, `PermissionDenied`, any tool); generic entries count as main-thread. A tied entry may be one of several parallel calls, so other calls do not clear it, and a sibling agent's or the main thread's tool events never clear a subagent's entry (nor a subagent's a main-thread one); `SubagentStop` clears that agent (and its `pre`);
  `Stop` clears the main-thread and generic entries, and a subagent's unless `background_tasks` lists it as running (a missing list means none runs, as in the reducer); an `idle_prompt` Notification clears main-thread and generic entries (Claude Code sends it only when no dialog is open: an Esc'd prompt); a driver prompt clears main-thread and generic entries (an Esc'd prompt
  sends nothing else); an injected `<task-notification>` prompt clears nothing.

- `RevviewNetwork`, `RevviewDataLock`: board overlays. `RevviewStarting`: clears all sessions and the `ended`
  list, phase `starting`. `RevviewContext`: applied to its live session if it has a `session_id` of one,
  otherwise to `board.context`.
- `RevviewDropped` (internal, sent by the server when an event body was too large to read): marks that live
  session `dropped` (the diff may be incomplete). Without a session id it marks every live session that is in a turn (working, asking, or a tool open), or only the shown one if none is. This is deliberate: marking too few would show a wrong diff as exact, marking one more only shows `≥` on a diff that may be exact. A late `PostToolUse` of Edit/Write/MultiEdit after `Stop` that cannot be placed (no `tool_use_id`, or one not open) also marks it, since its lines are lost, or, without a usable id, the live sessions in a turn (else the shown one); an id the board
  does not know marks nothing. Reset by a driver `UserPromptSubmit` (not by an injected one).
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
  focus if it has one, else the one asked first); when the last pending prompt was just answered, `spokenTo` if live; the session the driver just spoke to; a focus that is no
  longer live -> the best of working > done > waiting > rest, then the highest `touched`; a focus that is
  idle/unknown/starting while another session works -> the most recently touched working one; else keep
  (sticky: other sessions' events never move it; a `done` focus stays until its idle_prompt). The cap avoids
  dropping the focus when another victim exists. `boardView` shows `sessions[focus]` when valid, else
  computes the same rule without storing it.
- `boardView` branch: `s.branch`, else `board.context.branch` only when `board.context.repo` is the repo shown.

`boardView(board)` is the flat state the page renders, always with exactly these keys (the list omits `note` and `answered`, added later: `note` = the board note or the shown quiet session's note; `answered` as above): `view, activity,
offline, locked, repo, branch, tool, file, diff {added, removed}, command, output, outputLines, others, diffIncomplete, buttons, voice, position, elsewhere, nav` (`buttons`: `'unknown'` | `'present'` | `'missing'`, from the board whatever session is shown).
With a shown session these are its fields (`others` = other live sessions, `diffIncomplete` = its `dropped`,
repo/branch fall back to `board.context`). With no live session `activity` is the board phase
(`unknown`, `starting`, `ended`), repo/branch come from `board.context`, the rest is null/0/false.
`view = locked ? 'insert-key' : offline ? 'offline' : activity`. `replayView(events, board)` returns the
`boardView` after each event; the recordings' expected files and the emulator fixtures use it.

Internal event `RevviewInterrupted {session_id}`: revview itself sent Esc / Ctrl+C to that session and Claude Code
fires no hook for it (QA r3-02). A session in a turn (effective activity `working` or `permission`) becomes
`waiting` (view as the reducer computes it: locked/offline respected), `open`, `pending` and `pre` are emptied
(Esc rejects a dialog), tool/command/file/diff are kept, `tick`/`touched` advance and focus is re-picked. An
unknown or missing `session_id`, or a `done`/`waiting` session, returns the same board; it never creates a
session. The server feeds it after sending the key and refuses it over HTTP.

Internal event `RevviewAnswered {session_id, agent, since, decision: 'allow'|'deny'}`: revview answered that permission
request through the hook. The pending entry with that exact `agent` and `since` in that session is removed (tick
advances, focus re-picked); no other entry, no activity change. The decision is stored on the session and `boardView` carries it as `answered` (`'allow'|'deny'|null`) while the shown call is the answered one; it is cleared by that session's next `PreToolUse`, `PermissionRequest` / permission `Notification`, `SessionStart` or driver prompt. No match, an unknown session or a malformed event
returns the same board. Refused over HTTP like `RevviewInterrupted`.

**Driver-chosen selection (WB4).** New board fields: `selected` (live session id or null), `want` (a session revview
started that is not on the board yet: the first event that creates it sets `selected = want`, `want = null`),
`owned` (ids revview owns; null = the server runs without sessions), `nav` (null or `{kind, row, id}`, kind `list|menu|new|projects|settings`; in the list `id` is the highlighted session and the highlight follows it; if it ends the list closes with the note 'Highlighted session ended: list closed'; an open new/projects view closes when the projects list changes),
`projects` (config-file paths, display only), `note` (null or a fixed text from `RevviewNote`); each session has `born` (the board tick that created it, kept on updates).
The shown session is `selected` when live; only when it is null do the heuristics above decide. Other sessions' events never move
`selected`; when the selected session ends it falls to `homeKey`; the cap never drops `selected` or `want`'s session.
Exports: `sessionOrder(board)` (sessions other than `''`, by `born` then id), `homeKey(board)` (needs permission 4 > waiting 3 > done 2 >
working 1 > rest; oldest ask first: smallest `pending[0].since`, else smallest `touched`, then the order; note done outranks working here,
unlike the cap's priority), `selectedKey(board)`.

Internal events (the server refuses them over HTTP): `RevviewSelect {session_id}` (known -> `selected`, unknown -> `want`),
`RevviewOwned {ids}` (<= 64 ids of <= 200 chars, deduplicated; `names` are display text only: control chars rejected, trimmed to 64) puts each owned id that is not on the board and not in `ended` there as a quiet placeholder (`state` unknown, note 'No events from this session yet', in owned order), removed when no longer owned while still quiet; its first hook event makes it a normal session (a placeholder counts as the one live session for id-less events, and `RevviewSelect` selects it at once; the cap drops sessions not in `owned` before owned ones),
`RevviewNote {text}` (one of a fixed set of texts; cleared by the next `RevviewNav` button gesture or a selection change), `RevviewProjects {paths}` (<= 32 strings of <= 4096),
`RevviewNav {button, gesture}` (does not touch `tick` or sessions): normal view left/right tap step through the order (wrapping),
back hold = home, up/down/press tap open the list on the shown session, menu tap opens the menu; inside a view up/down move the row
(clamped), press chooses/opens, back tap goes up one level, back hold = home and close, menu tap toggles, button `timeout`
closes from anywhere. `RevviewStarting` also clears `selected`, `want`, `nav`. Malformed events return the same board.

`boardView` also always carries `voice` (null without `owned`; else `'no-session'|'none'|'here'|'not-owned'`), `position`
(`{index, count}` or null), `elsewhere` (other sessions with a pending prompt; `others` still counts all) and `nav` (null or
`{kind, row, rows}`; session rows `{label, word, state, target, voice}`, other rows `{label}`). `shownPrompt` is null while `nav` is open.

Read helpers: `pendingPrompts(board)` is the flat list over all sessions of
`{ session, agent, since, tool, file, command }` per pending entry (`agent`: `''` main thread, an agent id, or
`null` for a generic notification entry). `shownPrompt(board)` is `null` unless `boardView(board).view` is
`'permission'`, else that record for the shown session's first pending entry; both use the same shown-session
helper.

## Diff counting

Edit/Write/MultiEdit only. Prefers `tool_response.structuredPatch` (`+` lines added, `-` removed); a Write
with `type: 'create'` counts the lines of its content; otherwise falls back to `tool_input`
(`old_string`/`new_string`, `edits`, `content`).

## Limits

`LIMITS = {path: 200, command: 300, output: 80, outputLines: 3}` (`outputLines` is a count, the others are code points; `lastOutputLines(text, n, max)` scans from the end, so its work does not grow with the size of the output); longer text is cut with a trailing `…` (the path limit is only a
payload guard, the view fits the file to pixels; paths keep the file
name and the trailing directories after `…/`).

## Tests and expected files

`tests/unit/replay.test.js` replays (through `replayView`) every `fixtures/sessions/*.jsonl` (real Claude Code 2.1.330 recordings)
and compares with `<name>.expected.json`. Regenerate after an intended change:

    REVVIEW_UPDATE_EXPECTED=1 npm run test:unit

then review the diff of the expected files.

## Payload assumptions not covered by a recording

Recorded (Claude Code 2.1.330, `fixtures/sessions/`): subagent `agent_id` on PreToolUse/PermissionRequest/
PostToolUse, no `tool_use_id` on PermissionRequest, async subagents with `Stop.background_tasks`, the injected
`<task-notification>` prompt, an Esc'd prompt sending nothing, `SessionStart` `compact` mid-turn (auto, forced
with `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=1`) and after `/compact`. **Assumed, not recorded** (shapes from the
binary's schemas or not seen at all; bench items B1-B3 (behaviour: B4-B6) in `docs/BENCH-TEST.md`):

- a prompt rejected with "No" (not Esc) answers with `PermissionDenied` or `PostToolUseFailure` carrying the
  `tool_use_id` (`PermissionDenied` has `tool_use_id` in the schema; never fired in a recording);
- `background_tasks[].id` equals the subagent's `agent_id` (true in the one recording with async subagents);
- foreground (synchronous) subagents: never recorded (2.1.330 launched both recorded ones async even with
  `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`); the rules do not depend on it;
- an Esc'd prompt of a subagent: assumed to end in `SubagentStop` or a later `Stop` that no longer lists it;
- `UserPromptSubmit.source` values other than `user` (schema only).

