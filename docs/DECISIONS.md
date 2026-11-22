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
| `src/view/` | The static glance page (HTML/CSS/JS). |
| `src/server/` | Live server: hook POSTs in, state to the page over SSE (added with the glance view). |
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

- **Physical size in one place**: `emulator/panel.js` (moved to `src/view/panel.js` with the glance view; the emulator file re-exports it). Active area about 190 x 60 mm (DESIGN.md; not
  measured on the real panel, bench item 13). 1280/190 = 6.737 and 400/60 = 6.667 px/mm differ by about 1%;
  one uniform scale is used, **1280/190**, the larger, so px-to-mm never overstates a size (400 px = 59.4 mm).
  Viewport 1280x400, device scale factor 1.
- **Text height = cap height**: ink height of a capital H in the element's computed font, measured with
  canvas `measureText('H').actualBoundingBoxAscent` (`emulator/mm.js`), tested against painted ink. Not the
  CSS font-size (the em box, always larger). Measured with headless Chromium's fonts here, which are not the
  Pi's (bench item 11). The thresholds are set by the glance view (see "glance view" below).
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

## 2026-11-21: glance view (the real 1280x400 renderer) and the live path

### Layout

Three lines, black background, no scrolling, nothing wraps:

1. **State band**: full-width band in the state colour, black text: a shape, the state word, and
   `repo · branch` right-aligned (hidden when it would be squeezed under about 8 characters, e.g. next to
   NEEDS PERMISSION).
2. Tool and file, diff `+N −N` at the right (green/red, bold, never shrinks; compact counts rounded down:
   12.3k, 999k, 1.2M).
3. `$ command` (monospace, at most 45% of the line) and the last output line.

When the tool is Bash, line 2 shows the command instead of "Bash" with no file, and line 3 the output over
the whole width. `starting`, `offline` and `insert-key` show a short plain note instead (offline also says
what Claude is doing underneath). Fields that do not fit are cut with `…`; the file path is cut in the
middle so the file name stays visible (`src/view/fit.js`). Fonts: DejaVu Sans / Sans Mono (what Raspberry
Pi OS ships), not `system-ui`, so the Pi picks the same font as the emulator; WenQuanYi / IPA as CJK
fallback.

### Colour and shape per state (colour is never the only cue)

| View | Band colour | Shape | Lowest contrast over everything that can be shown in that state (computed) |
|---|---|---|---|
| working | `#5eb1ff` blue | filled circle | 8.32:1 (`#ff7a7a` removed count) |
| waiting | `#c8a2ff` violet | two bars (pause) | 8.32:1 (`#ff7a7a`) |
| permission | `#ffb020` amber | triangle | 8.32:1 (`#ff7a7a`) |
| done | `#4fdc7a` green | check mark | 8.32:1 (`#ff7a7a`) |
| starting | `#e0e0e0` light grey | ring | 15.91:1 (black on band) |
| offline | `#ff6b6b` red | cross | 7.57:1 (black on band) |
| insert-key | `#ff8ad8` pink | key | 9.88:1 (black on band) |
| unknown | `#5ce1e6` cyan | question mark | 13.37:1 (black on band) |
| ended | `#d8c28a` sand | power-off symbol | 12.00:1 (black on band) |
| no-link | black, white outline | broken link | 21:1 (white on black) |

Detail text is white `#fff` (21:1) or grey `#b8b8b8` (10.59:1) on black; diff counts are `#5fe08a` added
(12.52:1) and `#ff7a7a` removed (8.32:1) on black; band text is black on the band colour (9.21 working, 10.07
waiting, 11.48 permission, 11.85 done, 15.91 starting, 7.57 offline, 9.88 insert-key, 13.37 unknown, 12.00 ended; no-link is white on black, 21). The table gives, per
state, the lowest ratio over every colour pair that state can show; the diff counts appear in every state
except starting, insert-key, unknown, ended and no-link (`NO_DIFF`, `showDiff` in `src/view/view.js`), so they set the minimum in working,
waiting, permission and done. The ratios were computed with the WCAG formula from the colours in
`src/view/view.css`. The Playwright test computes the ratio of every text element from its computed colour
and its effective (opaque) background, but only for the fixtures, which are a subset of what can be shown; the floor is **7:1** (WCAG AAA for normal text) because the panel is read in daylight
through glare.

### Type sizes in mm (cap height of a capital H, at 1280/190 px/mm)

| Text | Design (`TYPE_MM`, `src/view/type.js`) | Asserted minimum (`MIN_MM`) | Measured in the emulator |
|---|---|---|---|
| State word | 10.6 mm | 10.5 mm | 10.69 mm |
| Everything else | 6.1 mm | 6.0 mm (floor for any text) | 6.23 mm |

Why: the panel sits on the dash about 700-800 mm from the eyes. 6 mm cap height at 750 mm is about 27
arcminutes; in-vehicle display guidance (ISO 15008, from memory: not checked here, the standard is not
reachable) asks for roughly 20 arcmin minimum and about 24 preferred, so the floor is above that with some
margin for the Pi's rendering. The state word is the one thing for a one-second glance: 10.5 mm is about 48
arcmin, and it is the largest round size at which the longest label, NEEDS PERMISSION, fits one line with
its shape in 1280 px in DejaVu Sans Bold (about 1087 px of 1232). Bigger detail text would leave about 30
characters per line and cut almost every path and output line. The sizes are set in mm: at runtime the
view measures the real font's cap-height ratio (canvas `measureText('H')`) and sets the CSS font sizes from
it, so a different font on the Pi keeps the cap heights (but may change widths: bench items 18-19).

### Worst-case content

`emulator/worst-case/*.json` (hand-written renderer stress content, NOT reducer output: far over the
limits, unbroken tokens, CJK/emoji, exactly at the limits in `W`, a 999999999 diff), merged over every
state in the layout tests and screenshotted (`worst-<id>.png`, `worst-<id>-permission.png`). They live
outside `emulator/fixtures/` because every file there is a view state that must have its own screenshot.

### Live path: `src/server/index.js`

- Node standard library only. **Port 8138** by default (`REVVIEW_PORT` or the first argument; 8137 stays the
  static dev server), bound to **127.0.0.1 only** (no option to bind elsewhere): the hooks and the kiosk
  browser run on the same Pi.
- `POST /event`, body = one raw Claude Code hook JSON object (exactly what a command hook gets on stdin, so
  the hook is `curl -s -X POST --data-binary @- http://127.0.0.1:8138/event`). 204 accepted; 400 malformed
  JSON or not an object; 413 over **1 MiB** (a Read or Write payload can carry a whole file; bigger events
  are dropped, which only loses one diff count); 403 for a foreign `Origin` or `Host` (a web page in the
  kiosk browser could otherwise POST cross-site, and DNS rebinding); 405/404 otherwise. Synthetic
  `Revview*` events go the same way. A throwing state core answers 500 and changes nothing. At most 8 SSE
  clients (503 beyond); a client that stops reading (backlog over 256 KiB) is dropped.
- **Server-Sent Events** on `GET /events` (one-way push is all the page needs; built into the browser and
  `node:http`, no WebSocket code): `retry: 1000`, then `{seq, state}` at once (a late joiner sees the
  current state) and after every accepted POST; a comment ping every 15 s. `GET /state` for debugging.
  State lives in memory only; a restarted server starts at `starting`.
- The page (live when it has no `?fixture`/`?state`) shows `starting` until the first message, and also
  whenever the link is down (a stale WORKING would be a lie); it reconnects by itself (the browser's own
  retry, and a new EventSource after 1 s if the browser gave up).
- The server serves only `src/view/` at `/`, so the view imports nothing outside that directory; that is
  why the panel constants moved to `src/view/panel.js`.

## 2026-11-22: honest states (the bar never shows a state it does not know)

QA round 1 (issues qa-20261121-01, -02, -03, -04, -05, -10, -11) found the bar showing a confident state it
did not know. Principle from now on: **a state is shown only when the events prove it; anything unknown or
stale has its own look, never STARTING.** This section supersedes, where they differ, the earlier lines "a
restarted server starts at starting", "SessionEnd ... ignored", "the page shows starting whenever the link is
down" and "bigger events are dropped, which only loses one diff count".

### New looks (each with its own colour, shape and word; measured in the emulator)

| View | Made by | Word | Shape | Band | Lowest text contrast | Notes (line 2 / line 3) |
|---|---|---|---|---|---|---|
| `unknown` | state core: fresh board (a started or restarted server) | UNKNOWN | question mark | cyan `#5ce1e6` | 13.37:1 | "Not known until Claude's next step" / "Push-to-talk may still work" |
| `ended` | state core: the last session sent SessionEnd | CLAUDE EXITED | power-off symbol | sand `#d8c28a` | 12.00:1 | "No Claude Code session running" / "Voice input goes nowhere" |
| `no-link` | the page only: its SSE link is down (or not up yet) | NO LINK | broken chain link | inverted: black band, white 0.6 mm outline, white word and shape | 21:1 | "Display lost the revview server" / "Claude may still be running" |

State word 10.69 mm and smallest text 6.23 mm cap height in all three, as the other looks. `no-link` is
inverted on purpose: a display fault must not look like any coloured Claude state. Fixtures:
`emulator/fixtures/unknown.json` and `ended.json` are generated by the state core from recipes;
`no-link.json` is `{"view":"no-link"}` (it is not a state-core state; `PAGE_ONLY_VIEWS` in
`src/state/states.js`). All three are in the screenshot set (`unknown.png`, `ended.png`, `no-link.png`), plus
`boot.png` and `more-sessions.png`.

### Decisions

- **01, restart: no persistence; a restarted server shows UNKNOWN.** Reason: hooks POSTed while the server
  was down are lost (each hook is a one-shot curl), so a restored state could itself be stale; it would need
  its own "maybe stale" look anyway, and UNKNOWN is that look without writing anything (no SD wear, nothing to
  corrupt on a power cut). STARTING now only follows `RevviewStarting` (key-on). The note tells the driver
  push-to-talk may still work, so the deadlock QA found (Claude waits, the bar says "not ready") is gone: the
  driver can speak, and the next hook shows the real state.
- **02, link down: the page draws NO LINK itself** (also before the first message), never the stale state
  and never STARTING; it reconnects by itself (EventSource retry 1 s, a new EventSource after 1 s if closed)
  and the server sends the current state on reconnect.
- **03, sessions: state per `session_id`** (`src/state/board.js`, a pure layer over the per-session
  reducer). Subagents are not separate sessions: Claude Code 2.1.330 builds every hook input with the
  session's own `session_id` and adds `agent_id`/`agent_type` inside a subagent (checked in the installed
  binary; the recorded SubagentStop lines show the same). The bar shows the session that most needs the
  driver: permission > waiting > working > done, ties to the most recent event. **Hint**: `+N` in the band
  when N other sessions are live (their states are not shown; by the rule above none of them needs the driver
  more). At most 8 live sessions (`MAX_SESSIONS`, so N has one digit); on overflow the least recently active
  is dropped (a crashed Claude never sends SessionEnd). Events without a `session_id` share one anonymous
  session, so hand-posted events still work.
- **04, SessionEnd removes its session**; with none left the bar shows CLAUDE EXITED (repo kept). Late events
  of an ended session are ignored, except a SessionStart with that id, which recreates it (`/clear`).
- **10, late tool events**: once a turn has ended (`done`, or `waiting` with no tool open), a
  PostToolUse/PostToolUseFailure/PermissionDenied never changes the activity; a Post whose tool was still
  open at Stop still adds its diff and output. Late permission events after the turn ended are ignored. A
  PreToolUse after Stop is accepted: Claude can start work on its own (background tasks), and hiding real
  work would be the worse lie.
- **11, oversize events**: still 413 over 1 MiB (memory stays bounded), but the server keeps the first
  64 KiB; if it is a PostToolUse of Edit/Write/MultiEdit (or the tool name is not in the prefix), it feeds
  `RevviewDropped {session_id}` to the board and the diff is shown as a lower bound: `≥ +N −N` (reset at the
  next prompt). A lost Read/Bash/PreToolUse event counts no diff, so it marks nothing. Claude Code writes
  `session_id` first and `tool_name` before `tool_input`, so they are inside the prefix.
- **05, Chromium before the server: `src/view/boot.html`.** A self-contained page (inline CSS and script,
  no imports, works from `file://`) showing the NO LINK look ("Waiting for the revview server"). Every second
  it probes `http://127.0.0.1:<port>/state` with a `no-cors` fetch (a no-cors GET sends no `Origin` header,
  so the server's Origin check passes; tested from `file://` in the emulator's Chromium) and then
  `location.replace`s itself with the live view. **Requirement for the stage-4 kiosk unit**: start Chromium
  on `file://<install dir>/src/view/boot.html?port=8138` (not on `http://127.0.0.1:8138/` directly, which
  shows a white error page when Chromium is first), and do not make it wait for the server; the server unit
  should restart on failure. If the live page later loses the server it shows NO LINK and recovers by itself;
  a Chromium restart starts from the boot page again.
- No new dependencies.

### Not solved here (known limits)

- A Claude that dies without SessionEnd (crash, power cut) stays on the bar with its last state until a new
  session pushes it out or `RevviewStarting` clears the board: the state core has no clock by design.
- With two sessions, voice goes to whichever terminal has focus; the bar shows the neediest session and the
  `+N` hint, but cannot say where push-to-talk will land.

## Detail lines polish (QA round 1: 06 07 08 09 12)

- Line 3 for a non-Bash tool shows `$ command`, then a grey `→` separator, then the output line (the
  separator only when both are shown; the command box is at most 40% of the line).
- The tool name uses the whole line when there is no file (MCP names).
- The file path is cut once, in the view, to real pixels (middle cut keeping the base name); the state core
  only guards payload size with `LIMITS.path = 200` (was 40).
- The band's `repo · branch` keeps the repo whole and cuts the branch in its middle (the end survives),
  falling back to the old end-cut only when the repo alone does not fit.
- A Bash event with an empty command clears the stale command and output.
