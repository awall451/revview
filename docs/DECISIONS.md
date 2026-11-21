# Decisions

## 2026-11-21: stack and skeleton (set by the owner, recorded here)

**Stack.** Node 22 (VM: v22.23.5, npm 10.9.9), plain JavaScript ES modules (`"type": "module"`), no build
step, no UI framework. The view is one static HTML/CSS/JS page, because that is exactly what Chromium kiosk
runs on the Pi, so the emulator tests the real thing. No runtime dependencies. `package.json` is `private`.

**Dev dependencies** (exactly two, exact versions, `package-lock.json` committed, installed with `npm ci`):

| Package | Version | Reason |
|---|---|---|
| `@playwright/test` | 1.65.1 | Drives Chromium for the 1280x400 panel emulator and the per-state screenshots. Version matches the browsers requested below. |
| `eslint` | 10.15.0 | Lint. Supports Node `^20.19 \|\| ^22.13 \|\| >=24`, so Node 22 is fine. Flat config `eslint.config.js`, written without `@eslint/js` or `globals` (rules and globals are listed by hand) to avoid more dependencies. |

State logic is tested with the built-in `node:test`: no dependency.

**Owner package requests** (the team cannot install system packages):

- `apt:shellcheck`, request 20261121T174603Z-k-f1c293: to lint the shell scripts (`tools/`, `tests/*.sh`, later the Pi image scripts). Not installed yet.
- `recipe:playwright-browsers@1.65.1`, request 20261121T174603Z-k-ee4355: Chromium for Playwright (expected at `/opt/ms-playwright`, which does not exist yet). Needed for the emulator and screenshots. Do not run `playwright install`; no browser test is written until it is installed. Installed since (`chromium-1255` and the headless shell); the panel emulator uses it.

**Layout**

| Path | Contents |
|---|---|
| `src/state/` | State core: pure logic, hook events to view state (`reducer.js`, `diff.js`, `format.js`, `states.js`). |
| `src/view/` | The static glance page (HTML/CSS/JS). For now a placeholder that shows a state plainly. |
| `emulator/` | 1280x400 panel emulator (Playwright): `panel.js` (physical size), `mm.js`, `fixtures/` (one state per view state), `serve.js`, `tests/` (specs), `dev/` (developer page at physical size). |
| `tests/unit/` | `node:test` unit tests; `tests/*.sh` are the gate's tests (`tests/unit.sh` runs `npm ci` + unit tests, `tests/emulator.sh` runs `npm ci` + the Playwright emulator tests). |
| `out/` | Git-ignored output: `out/shots/` (screenshots), `out/test-results/` (Playwright). |
| `fixtures/` | Recorded hook events (`sessions/*.jsonl`, real Claude Code 2.1.330 recordings) and their expected state sequences. |

## 2026-11-21: canonical view states

Identifiers are stable: code, tests, fixtures and screenshots use these names. Exported from
`src/state/states.js`. Meanings are from `docs/DESIGN.md`.

| Identifier | Meaning |
|---|---|
| `working` | Claude is working (tool running). Shows current tool and file, `+N −N`, last command and last output line. |
| `waiting` | Claude finished its turn and waits for me (my next voice input). |
| `permission` | Claude needs permission for an action; waits for a confirmation (when parked for anything destructive). |
| `done` | The task is finished (Stop). |
| `starting` | Key-on until Claude Code is really ready for push-to-talk (the better part of a minute). |
| `offline` | No network (tunnel, dead zone, hotspot lost); dictation cannot work. Also says so when a dictation failed. |
| `insert-key` | The encrypted data partition is locked because the key stick is not in; no password prompt. |

## 2026-11-21: state core, hook fixtures and synthetic events

### Where the hook payload shapes come from

All three fixture sessions in `fixtures/sessions/` were **recorded on this VM with Claude Code 2.1.330**
(`/home/agent/.local/share/claude/versions/2.1.330`, model `haiku`), in a throwaway git repo under `/tmp`
whose `.claude/settings.json` had a hook on every event that appended its stdin as one JSON line. Nothing in
them is hand-written. The only edit: `/home/agent/` was replaced by `/home/user/` (in `transcript_path`).
Session ids, prompt ids and tool-use ids are the random ids of those throwaway sessions; prompts and file
contents are the throwaway test prompts and files. No tokens or keys are in them (checked).

| Fixture | How | Events in it |
|---|---|---|
| `working-turn.jsonl` | `claude -p` headless, `--allowedTools "Bash Edit Write Read"` | SessionStart, UserPromptSubmit, Pre/PostToolUse for Read, Edit, Write, Bash, Stop, SessionEnd |
| `permission-prompt.jsonl` | interactive `claude --permission-mode default` in a pty (`script`), keystrokes sent by a driver script; approved the prompt | ... PreToolUse Bash, **PermissionRequest**, **Notification `permission_prompt`**, PostToolUse, Stop, SubagentStop, **Notification `idle_prompt`** (about 60 s after Stop), SessionEnd |
| `idle-prompt.jsonl` | same, permission mode `auto` (no prompt) | ... Stop, SubagentStop, Notification `idle_prompt`, SessionEnd |

**Derived from package source, not recorded** (the binary, via `strings`): the full list of
`notification_type` values (`permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`,
`agent_needs_input`, `agent_completed`, `worker_permission_prompt`, ... ), the `StopFailure`,
`PostToolUseFailure` (`error` string) and `PermissionDenied` input schemas, and that there is **no
`MultiEdit` tool** in 2.1.330 (only a permission-rule alias to `Edit`). The reducer's handling of
`worker_permission_prompt`, `StopFailure`, `PostToolUseFailure`, `PermissionDenied` and `MultiEdit` rests on
this, not on recordings; no fixture claims otherwise.

Findings worth knowing:

- The Notification payload is `{hook_event_name, message, notification_type, cwd, session_id, ...}` with no
  `title`. Real messages: `"Claude needs your permission"` (permission_prompt; no tool name in this version)
  and `"Claude is waiting for your input"` (idle_prompt). The state core keys **only on
  `notification_type`**, never on message text.
- A `PermissionRequest` event fires before the permission Notification and carries the tool and its input.
- After `Stop` a `SubagentStop` fires (an internal helper agent, `agent_type: ""`). It must not change state.
- `PostToolUse` for Edit and Write carries `tool_response.structuredPatch` (unified-diff hunks); a Write that
  creates a file has `type: "create"`, `structuredPatch: []` and `content`. Bash has
  `tool_response.stdout` / `stderr` with the ANSI codes the command printed.
- No payload carries the git branch.

Fields the state core relies on: `hook_event_name`, `cwd`, `tool_name`, `tool_input.file_path` /
`notebook_path` / `command` / `old_string` / `new_string` / `content` / `edits`,
`tool_response.structuredPatch` / `type` / `content` / `stdout` / `stderr`, `notification_type`, `error`
(PostToolUseFailure).

### Reducer decisions (`src/state/reducer.js`; details in `src/state/README.md`)

- **Stop -> `done`**, matching the canonical-state table ("The task is finished (Stop)"). The real
  `idle_prompt` Notification that follows about 60 s later moves it to **`waiting`**. No timers or inferred
  timeouts: only real events change the state.
- `SessionStart` -> `waiting`; `UserPromptSubmit` -> `working` and starts a new turn; `PreToolUse` /
  `PostToolUse` -> `working`; `PermissionRequest` and Notification `permission_prompt` /
  `worker_permission_prompt` -> `permission`; `idle_prompt` -> `waiting` (also out of `permission`, so a
  rejected prompt cannot leave the view stuck); `StopFailure` -> `waiting`. `SessionEnd`, `SubagentStop` and
  unknown events are ignored.
- **Diff** is a running total per turn (reset on `UserPromptSubmit`), counted once per tool call, on
  `PostToolUse` only. It uses the real `structuredPatch` (`+` lines added, `-` lines removed); a Write create
  counts the lines of its content; without a usable response it falls back to the input (Edit: `old_string`
  lines removed, `new_string` lines added; MultiEdit: summed over `edits`; Write: `content` lines added). A
  trailing newline does not count as an extra line.
- **Strip limits**: path 40, command 60, output line 80 characters (`LIMITS` in `src/state/format.js`),
  cut with `…`. Paths are made relative to `cwd`, then keep the file name and as many trailing directories as
  fit after `…/`. Commands collapse whitespace to one line. Output is the last non-empty line (stdout, else
  stderr), ANSI/escape codes removed, only the text after the last `\r`.
- **Repo** = last segment of `cwd`, set by `SessionStart` and `RevviewContext`; any other Claude event sets it only while it is still null (so a hook from a subdirectory never renames it). **Branch** only arrives through a synthetic event.
- Unknown tool names (Glob, Grep, MCP tools, ...) still mean "working" and show the tool name; they never
  count diff. Malformed input never throws and leaves the state unchanged (same reference).

### Synthetic events

Not Claude hook events; the future hook-wiring and boot scripts send them on the same channel. All use the
`hook_event_name` field with a `Revview` prefix so they cannot collide with Claude's names.

| Event | Effect |
|---|---|
| `{hook_event_name:"RevviewContext", cwd?, branch?}` | repo from `cwd`, `branch` (string or null). The hook script reads git, never the reducer. |
| `{hook_event_name:"RevviewStarting"}` | activity `starting` (key-on, before Claude Code is ready); clears per-turn data. `SessionStart` then moves it to `waiting`. |
| `{hook_event_name:"RevviewNetwork", online: boolean}` | `offline` overlay on/off. |
| `{hook_event_name:"RevviewDataLock", locked: boolean}` | `insert-key` overlay on/off. |

`view` = `insert-key` if locked, else `offline` if offline, else the Claude-derived activity; the activity
keeps updating underneath, so when the network returns the view shows the current activity again.

## 2026-11-21: panel emulator

- **Physical size in one place**: `emulator/panel.js`. Active area about 190 x 60 mm (DESIGN.md; not
  measured on the real panel, bench item 13). 1280/190 = 6.737 and 400/60 = 6.667 px/mm differ by about 1%;
  one uniform scale is used, **1280/190**, the larger, so px-to-mm never overstates a size (400 px = 59.4 mm).
  Viewport 1280x400, device scale factor 1.
- **Text height = cap height**: ink height of a capital H in the element's computed font, measured with
  canvas `measureText('H').actualBoundingBoxAscent` (`emulator/mm.js`), tested against painted ink. Not the
  CSS font-size (the em box, always larger). Measured with headless Chromium's fonts here, which are not the
  Pi's (bench item 11). The placeholder view asserts a state word cap height of at least 10 mm; the real
  design sets the real threshold.
- **Fixtures**: `emulator/fixtures/<state>.json`, one per entry of `STATES`, each exactly the reducer's
  state object. The list is `STATES` itself (`emulator/fixtures.js` `FIXTURE_IDS`), used by unit tests,
  Playwright specs and the developer page. Fixtures are generated, not written: the reducer's output for the
  events in `emulator/fixtures/recipes.js` (recorded sessions plus synthetic `RevviewContext`,
  `RevviewStarting`, `RevviewNetwork`, `RevviewDataLock`); a unit test checks they still match and are
  valid states. `offline` is the network overlay over a working turn, `insert-key` the lock overlay over
  starting.
- **Serving**: `emulator/serve.js`, a dependency-free `node:http` static server for the repository root
  (`file://` blocks ES modules and `fetch`). Tests start one per Playwright worker on a free port (no fixed
  port, so the gate and a developer run cannot clash); developers run `node emulator/serve.js` (port 8137).
  The view takes `?fixture=<id>`, `?state=<JSON>` or `window.revviewRender(state)`.
- **Screenshots**: `<state>.png`, exactly 1280x400 px (asserted from the PNG header), in `out/shots/`
  (git-ignored) or `$REVVIEW_SHOTS_DIR` (meant for the future `tools/check` to point at `<outdir>/shots`;
  `tools/check` is unchanged, so the gate's run currently writes them inside its checkout).
- **Gate wiring**: `tests/emulator.sh` (`npm ci`, then `playwright test -c emulator/playwright.config.js`
  with `PLAYWRIGHT_BROWSERS_PATH` defaulting to `/opt/ms-playwright`).
- **Developer page** `emulator/dev/`: the view in a 1280x400 iframe scaled to the panel's mm, calibrated by
  monitor diagonal or credit card (stored in localStorage), state picker over `STATES`.
