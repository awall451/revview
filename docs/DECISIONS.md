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
| `working` | Claude is working (tool running). Shows current tool and file, `+N −N`, the command and the last output lines. |
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
- **Strip limits** (command 60 and the single output line were changed on 2026-11-22, see the dense layout section): path 40, command 60, output line 80 characters (`LIMITS` in `src/state/format.js`),
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

`view` = `insert-key` if locked, else `offline` if offline (except a pending permission since QA round 3, see
"2026-11-22: QA round 3"), else the Claude-derived activity; the activity
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

Three lines, black background, no scrolling, nothing wraps (superseded on 2026-11-22: see the dense layout section; the band is now 84 px with up to 7 rows below it):

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

Superseded on 2026-11-22: the owner chose smaller type; see "2026-11-22: dense layout" at the end. The table and
the argument above are the history of the first choice.

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

State word 10.69 mm and smallest text 6.23 mm cap height in all three, as the other looks (before the 2026-11-22 dense layout: now 5.94 and 3.41 mm). `no-link` is
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
  is dropped: chosen by least need first (done, then working, then waiting), then least recently active, and
  **never a session at NEEDS PERMISSION** (if all others need permission the newcomer is still admitted and
  the cap is exceeded; a pending prompt must not vanish). A crashed Claude never sends SessionEnd. An event
  without a `session_id` goes to the one live session when there is exactly one (no false `+1` from
  hand-posted or old-style hooks); otherwise it goes to a shared anonymous session that `+N` never counts.
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
  `session_id` first and `tool_name` before `tool_input`, so they are inside the prefix and the first match
  is the real field (tests: a decoy `"tool_name":"Edit"` inside `tool_input` after a real Read marks nothing;
  `tests/unit/server.test.js` asserts the key order in `fixtures/sessions/*.jsonl`, so a changed order shows up
  when sessions are re-recorded). A late Edit/Write PostToolUse after Stop that cannot be placed (no
  `tool_use_id`) is dropped for the activity but marks the diff `≥` as well.
- **Page before its first message** (QA round 1b): the live page shows NO LINK, not STARTING, until the first
  SSE message arrives; STARTING only follows `RevviewStarting`. The boot page and the live page both start at
  NO LINK, so the hand-over shows no flash.
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
- Ended sessions are remembered by id (last 256, `MAX_ENDED`) so that late hooks cannot resurrect them. A
  late event of a session that ended more than 256 SessionEnds ago re-creates it (and its repo name) on the
  bar until the next `SessionEnd`/`RevviewStarting`. Bounded memory without a clock cannot do better.
- With two sessions, voice goes to whichever terminal has focus; the bar shows the neediest session and the
  `+N` hint, but cannot say where push-to-talk will land.
  Design decision 2026-11-22 (not built): push-to-talk will go to the session the driver selected by button, and
  the bar will show that session; see docs/BUTTONS.md. Until that is built the limit stands.

## Detail lines polish (QA round 1: 06 07 08 09 12)

- Line 3 for a non-Bash tool shows `$ command`, then a grey `→` separator, then the output line (the
  separator only when both are shown; the command box is at most 40% of the line). Replaced on 2026-11-22 (dense layout).
- The tool name uses the whole line when there is no file (MCP names).
- The file path is cut once, in the view, to real pixels (middle cut keeping the base name); the state core
  only guards payload size with `LIMITS.path = 200` (was 40).
- The band's `repo · branch` keeps the repo whole and cuts the branch in its middle (the end survives),
  falling back to the old end-cut only when the repo alone does not fit.
- A Bash event with an empty command clears the stale command and output.

## 2026-11-22: several sessions and subagents (QA round 2: 01 02 04 05 06 07)

Recorded first (Claude Code 2.1.330, `fixtures/sessions/subagent-permission`, `permission-interrupted`,
`compaction`; how in `fixtures/README.md`). What the recordings showed and the rules rest on:

- Subagents launched by the Agent tool run **async** (`tool_response.isAsync: true`; the PostToolUse of the
  Agent call comes at once). The main turn sends `Stop` while they still run; `Stop` carries
  `background_tasks: [{id, type: "subagent", status: "running", ...}]`. Each finished subagent makes Claude
  Code inject a `UserPromptSubmit` whose prompt starts with `<task-notification>`, then another `Stop`.
- Inside a subagent every hook carries `agent_id`/`agent_type`. `PermissionRequest` has **no `tool_use_id`**
  (main thread neither); the PreToolUse just before it, of the same agent, has one, and the approval is the
  PostToolUse of that agent with that `tool_use_id`. The `permission_prompt` Notification has no agent and can
  come after the main Stop. A prompt rejected with **Esc sends nothing** (no Post, PermissionDenied or Stop)
  until the driver's next prompt.
- Auto compaction fires in the middle of a turn: `PreCompact {trigger: "auto"}`, `SessionStart {source:
  "compact"}`, `PostCompact`, then the turn goes on; `/compact` at the prompt sends the same with `manual`.

Decisions:

- **06**: `SessionStart` with `source: "compact"` is ignored (the activity before it stays: WORKING mid-turn,
  DONE after `/compact`). Only `startup`, `resume`, `clear` (and `fork`, or no source) mean "at the prompt".
- **Async subagents**: `Stop` while `background_tasks` lists a running subagent is WORKING, not DONE (their
  results start a new turn by themselves; a background shell such as a dev server does not count). An
  injected `<task-notification>` prompt (or a `UserPromptSubmit.source` other than `user`) is not the driver
  speaking: WORKING, but no new turn (diff, open tools, `≥` mark and prompts are kept) and no focus change.
- **02, prompts are tracked per prompt, not per session**: each session keeps a list of unanswered prompts
  (agent key = `agent_id` or the main thread, plus the `tool_use_id` of that agent's last PreToolUse of the
  same tool). While the list is not empty the session is NEEDS PERMISSION with the prompt's tool and command,
  whatever its other subagents do. A prompt ends only by: a PostToolUse/PostToolUseFailure/PermissionDenied
  with its `tool_use_id`; `SubagentStop` of its agent; a main `Stop` (main-thread prompts; a subagent's only
  when `background_tasks` no longer lists it as running); the driver's next prompt (main-thread prompts: the
  Esc case). A subagent's PermissionRequest after the main Stop is not a late hook.
- **01 and 04, which session is shown**: only a pending permission pre-empts. Otherwise the bar shows the
  **focus**: the session the driver last spoke to (a driver `UserPromptSubmit`). It is sticky: events of
  other sessions never move it, so two working sessions do not alternate. It moves only when (a) another
  session asks for permission (the first one asked wins; when the last prompt is answered the bar goes back to `spokenTo`, the session the driver last spoke to with a real prompt, if it is live; injected prompts do not set it), (b) the driver
  speaks to another session, (c) the focus ends or is dropped (then: working > done > waiting > rest, most
  recent), or (d) the focus is idle (WAITING via `idle_prompt` or SessionStart, unknown, starting) while
  another session works (then the most recently active working one). No timer: a DONE focus stays until
  Claude Code's own `idle_prompt` (about 60 s after Stop) turns it into WAITING; only then does a working
  session take over. This supersedes "permission > waiting > working > done" in "03, sessions" above.
  Consequence: an idle session at its prompt never hides a working one; a just-opened session (SessionStart
  only) never takes the bar from a working one.
- **05**: a session without its own branch shows `board.context.branch` only when `board.context.repo` is the
  repo it shows. The branch of an ended session (kept in the context) never appears next to another repo.
- **07**: a `SessionEnd` of a session the board never saw only remembers its id; the phase stays (UNKNOWN or
  STARTING stay). CLAUDE EXITED needs the end of the last session the board knew.

- **Esc on a main-thread prompt.** Claude Code sends no hook for the rejection, but its `idle_prompt` timer
  (2.1.330 binary) fires only when the UI is not loading and `isDialogOnScreen()` is false, so it cannot fire
  while a permission dialog is open. Hence `idle_prompt` clears the session's main-thread prompts (WAITING after
  about 60 s); a subagent's prompt stays (background agents also hold the timer back). The recordings do not
  contain an idle_prompt during a dialog (permission-interrupted has none; permission-prompt's comes after the
  Stop). A Stop with no `background_tasks` list means no subagent runs, so subagent prompts clear too.
- **Prompt to call matching.** Open PreToolUse calls are kept per agent; a PermissionRequest takes a call's id
  only when exactly one open call has its tool (and input, when carried); otherwise the id stays empty.

Not solved here: a DONE session stays shown over a working one for the
~60 s until its `idle_prompt`; the bar still does not say which repo a `+N` session is in (issue 03, view).

- **Id-less lost event (11, state half).** The lost Edit/Write can only come from a session in a turn, so the
  `≥` mark goes to EVERY live session in a turn (working, asking, a tool open); if none is, to the shown session
  only (a late result after Stop); never to sessions that are not in a turn. Claude Code writes `session_id` first, so this is a fallback for a
  garbled prefix; a wrong guess shows one session exact when it was not, which the wide rule would have avoided
  at the cost of marking sessions that lost nothing.

## View and server polish (QA round 2026-11-22: 03 08 09 10 11 12 13 14)

- **Which session (03).** The band has no room for `repo` next to WAITING FOR ME or NEEDS PERMISSION plus `+N`.
  When `others > 0` and the band hides it, the repo (not the branch) shows bold at the right end of line 3
  (`#session`, at most 30%). The driver needs "which session", not its branch; line 3's output gives way to it.
- **Reload while the server is down (08).** A page cannot stop Chromium's error page. The live page registers a
  small network-first service worker (`src/view/sw.js`, served by the server at `/sw.js`) that answers the page
  and its scripts from its cache when the server does not answer. Rejected: a second always-on static server
  (more moving parts), a kiosk-side watchdog (not in this repo yet). Not fixable: the first load of a fresh
  profile. The kiosk must still start on `boot.html`; BENCH-TEST H8 is the proof and is untested.
  A page loaded from the cache reloads itself once when its link first comes up (fresh scripts); the worker is network first and never answers `/state`, `/events`, `/event`.
- **First paint (10).** `index.html` contains the NO LINK look itself, so the page never paints an empty band
  before `view.js` runs. (Static fixture pages also start NO LINK for a moment; they are for tests and the
  developer page.)
- **Lower bound of zero (11, view half).** `diffIncomplete` with nothing counted shows `+? −?` (unknown), not
  `≥ +0 −0`. With some count the `≥` form stays. The state half (an id-less lost event) is decided above.
- **`+N` from ten on (12)** reads `9+`; the exact number is in `data-full`.
- **Branch stub (13).** When no cut of the branch fits, the repo alone is shown unless at least two letters of
  the branch stay readable after the end cut.
- **OFFLINE note (14).** `Claude exited` / `Claude: not known` for the ended and unknown activities.
- **Command width (09).** The 40% cap on line 3's command applies only when there is an output line. (Gone on 2026-11-22: the command and the output have their own rows.)

## 2026-11-22: dense layout (owner: smaller type, more lines)

Owner priority message 20261122T042927Z-o-d9a077: "The glance view text is far too big. I have good eyesight and
want to see more of what is happening. Shrink the state word to about 6 mm capitals and all other text to about
3.5 mm, use the freed space for more lines (full command, last 2-3 output lines, tool and file, diff), and lower
the tested minimums to match." The owner chose this, overriding the legibility argument in "Type sizes in mm"
(10.6 / 6.2 mm for 700-800 mm). That argument is not refuted; it is the owner's call, and whether 3.5 mm is
readable on the dash is not known (bench item 26).

Type sizes (cap height of a capital H, 1280/190 px/mm). The tests now assert a two-sided range (`RANGE_MM`,
`src/view/type.js`) instead of floors:

| Text | Design (`TYPE_MM`) | Asserted range (`RANGE_MM`) | Measured in the emulator |
|---|---|---|---|
| State word | 6.05 mm | 5.8 - 6.3 mm | 5.94 mm (40 px) |
| Everything else | 3.55 mm | 3.3 - 3.7 mm | 3.41 mm (23 px) |

Measured in all looks (working, waiting, permission, done, starting, unknown, ended, no-link, offline,
insert-key, boot page), from `emulator.log` of `bash tools/check`. Only the emulator measured this.

Why 6.05 / 3.55 and not 6.0 / 3.5: the emulator's canvas measurement reports the hinted cap height in whole
pixels, rounded down. At the exact targets it can fall to 5.9 and 3.3 mm. The design values sit a little above
the targets so the measured values land inside the range and close to what the owner asked for.

Layout. Band 84 px (was 140). Below it a flow of 40 px rows without gaps (8 px padding top and bottom). Row A:
tool, file, notes, session, diff (the tool name now shows for Bash too). Then the command, wrapped, in at most
6 minus the number of output rows shown (so 3 to 6 rows), cut with an ellipsis at its end only when it does not
fit, the full text in `data-full`; or `note2` in the note views. Then up to 3 output lines, oldest first, one
row each, cut with an ellipsis. At most 7 rows: 84 + 8 + 7 x 40 + 8 = 380 px of 400. At this size the band has
room for `repo · branch` next to the state word in practice; `#session` (the repo at the right end of row A)
stays as the fallback when the band has no room.

What replaced QA 09's 40% command cap and the `→` separator: command and output have their own rows, so
neither competes for width and no separator is needed. Both are gone.

State core: `outputLines` is the last 3 non-empty output lines (CRLF-safe, ANSI-stripped, each at most 80 code
points, scanned from the end so the work does not grow with the output); `output` stays its last element.
`LIMITS.command` goes from 60 to 300 code points (the view wraps and cuts it to the rows it has).

Contrast is unchanged: `git diff gate/main -- src/view/view.css` shows no colour value changed (only
layout properties, and the `#sep` / `#prompt` rules keep `var(--grey)`), so the table of ratios above still
holds. Smaller text has the same ratio but is harder to read at equal ratio; that is part of bench item 26.

Tests: `emulator/tests/dense.spec.js` checks that no text lies outside the panel, is clipped or overlaps another,
for every fixture and every worst case, plus the wrapped and cut command and 1 to 3 output rows; `expectFits`
in `emulator/tests/checks.js` now checks text boxes too.

## 2026-11-22: wheel buttons (design, not built)

Owner request 20261122T060852Z-p-dcd34d. Full note: `docs/BUTTONS.md`. Nothing here is built, and nothing was
tried on hardware. Scope beyond charter stage 3 is an open escalation (`docs/agents/ESCALATIONS.md`); until
the owner answers, only stage 3 is built.

Rules chosen (proposals until the owner confirms):

- **One selected session.** The bar shows the selected session and every action goes to it. Only the driver
  changes the selection (left/right, back-hold home, a list row, a new session) or the session ending. Other
  sessions' events show as the `+N` hint. In `board.js`, `focus` becomes driver-owned; `spokenTo` is not needed
  for focus.
- **revview owns the sessions:** plain interactive `claude` in a private tmux server (`tmux -L revview`, one
  window per session). Keys go by `tmux send-keys`. The `--bg` + `attach` hub pattern stays the fallback.
- **Allow and deny** through a waiting PermissionRequest hook answered by the revview server, with an explicit
  `timeout` (proposal 600 s). Space, Esc and one Ctrl+C go as keys. Never two Ctrl+C in a row.
- **Presses during `starting` are dropped**, not queued: a late Esc or allow could hit the wrong thing.
- **Push-to-talk in `/voice` tap mode.** Hold mode needs imitated key auto-repeat and may break with an update.
- **keyd is superseded** by revview's own reader (exclusive grab, key map in config) because several sessions and
  non-key actions need more than a key-to-key remap. The owner to confirm. The grab needs a new dependency
  (python3-evdev or a small C helper), to be decided with its own entry when it is built.

Recorded facts (Claude Code 2.1.330, `fixtures/buttons/`):

- Esc mid-turn stops the turn at once; the hooks fire no Stop and no PostToolUse (`events-a-esc.jsonl`). The
  session works afterwards. One Ctrl+C mid-turn does the same; at an idle prompt two Ctrl+C within the hint
  window exit Claude (`pane-b-6-ctrlc-idle-first-of-fast-pair.txt`).
- A waiting PermissionRequest hook does not hide the terminal dialog (`pane-c2-1-hook-waiting.txt`). Its allow
  answer dismisses the dialog in about 1.5 s and the command runs (`pane-c2-2-after-answer-file.txt`).
- Its deny answer shows the reason, the command does not run, and the turn ends with a Stop, but no
  PermissionDenied event (`pane-d-1-after-deny.txt`, `events-c2-d-d2-allow-deny-terminal.jsonl`).
- With `"timeout": 5` and a silent hook, the hook is killed, nothing is allowed or denied, and the dialog stays
  (`events-c1-hook-timeout5.jsonl`, `pane-c1-2-after-timeout-8s.txt`). The default timeout was not recorded.
- An answer in the terminal wins at once; the waiting hook is not killed and its late answer has no effect
  (`pane-d2-1-after-terminal-1-while-hook-waits.txt`, `permhook-log.txt`).
- Two `claude --bg` sessions are listed by `claude agents --json` (`agents.json`). `claude attach` in a tmux
  pane takes keys for that session only (`pane-e-3-attached-after-esc.txt`); Left opens the agent list
  (`pane-e-4-after-left-arrow.txt`). No command to send input to a `--bg` session was found in the binary.

## 2026-11-22: wheel buttons 2, the input layer (built, not tried on hardware)

The owner approved the full wheel-buttons scope (inbox 20261122T064434Z-o-942fed: "build as phased in
docs/BUTTONS.md section 8"). WB2 is built: key events in, named gestures out (`src/input/README.md`). Nothing acts
on Claude Code yet (WB3).

- **The grab: a python3 helper using only its standard library, no new dependency.** Node core has no
  `ioctl`. `src/input/grab.py` opens the node, calls `fcntl.ioctl(fd, EVIOCGRAB, 1)` (0x40044590, the same on arm64
  and x86-64), and copies the raw bytes to stdout; Node parses them. Why not the others:
  - python3-evdev (BUTTONS.md suggested it) is a Debian package the team cannot install, and the stdlib `fcntl` call
    is all it would be used for.
  - A tiny C helper needs a compiler and a build step on the Pi and in the check.
  - A native npm addon needs node-gyp and a compiler, and it would be a new pinned dependency.
  python3 ships with Raspberry Pi OS. Its version is not pinned by the repo, but the helper uses only `os`,
  `fcntl`, `signal`, `errno` and `sys`, which have been stable for years. If python3 is missing on the image,
  the Pi image scripts (charter stage 4) must install it (bench W2). The grab ends when the helper's fd
  closes, so a dead helper never leaves the keyboard grabbed. The grab succeeding is not proven here: only the
  failure paths ran (ENOTTY on a regular file, a missing path).
- **The reader runs inside the server, not as a separate service** (`--input [config]`). This supersedes the
  "small input service" and `RevviewInput` HTTP proposal in BUTTONS.md section 1. Presence is then known
  exactly: no heartbeat, no lost-service case. The server is the process that starts early anyway (the kiosk
  waits for it). Gestures from the device, from the dev bridge and from a POSTed `RevviewButton` event all
  end up in one log (`GET /buttons`). WB3 acts on them through the `onGesture` seam.
- **The device is found by name/vendor/product in `/proc/bus/input/devices`** (or a fixed `path`), taking the first
  `kbd` node whose `B: KEY=` bits include a bound key, so a dongle's consumer-control node is skipped. An
  explicit `path` that is missing is "not found". It never falls back to "any keyboard", which would grab the
  console's. Retries every 1 s and re-opens by itself.
- **struct input_event = 24 bytes** (64-bit userspace, Pi OS Trixie arm64 per DESIGN.md). The 16-byte 32-bit
  layout is parsed only on request. Times are arrival times on Node's monotonic clock, not kernel timestamps.
- **Gesture rules** as BUTTONS.md section 1: a button without hold or long hold fires on press. Otherwise a tap
  is a release before 400 ms, a hold fires at 400 ms and a long hold at 1000 ms. A release after 400 ms gives
  no tap, so cancel released between 400 and 1000 ms does nothing. Repeats (value 2) are ignored, and so is a
  press within 30 ms of that key's release. A lost device or `SYN_DROPPED` resets the detector: a key that
  was still down gives no gesture. The timings can be set in the config.
- **Key map in `config/buttons.json`**, validated loudly (the file and field are named; unknown fields are
  errors). The server exits 2 on a bad config. Only F1-F24 plus Ctrl/Shift/Alt/Meta combos are accepted.
- **NO BUTTONS** is a quiet outlined tag at the right end of the band, at the detail size (measured 3.41 mm
  cap height). It is not a takeover, and it is hidden during STARTING and NO LINK. `boardView` gained the key
  `buttons` (`unknown`/`present`/`missing`), so every expected file gained `"buttons": "unknown"`.
- **Dev bridge** for the emulator: `POST /dev/key` exists only when the server is started with `--dev-bridge`
  (`npm run start:dev`; `devBridge: true` in tests). Without it the route does not exist. It keeps the 127.0.0.1
  bind and the Origin/Host checks. The page sends keys only at `/?devkeys=1`; otherwise it has no key listener.
  The bridge feeds the same detector as the device. The Pi's server unit must never pass `--dev-bridge`.
- Presses during `starting` are logged as `dropped` (WB3 must not act on them). The "bar briefly marks a
  dropped press" part of BUTTONS.md is not built.
- **Gestures and presence are never accepted over HTTP outside `--dev-bridge`.** `POST /event` with
  `RevviewButton` or `RevviewInput` answers 403 unless the server runs with `--dev-bridge`. Any local process
  without an `Origin` header (for example a Bash command Claude Code runs: `curl 127.0.0.1:8138/event`) could
  otherwise forge a button press and later answer its own permission prompt, or fake the NO BUTTONS state.
  The device reader runs in-process (internal `apply()`), so the HTTP path has no production use.
  Also: after an open or grab failure the reader backs off (delay doubles from 1 s to 30 s, reset on a
  successful open, a changed path, `start()`; "device not found" stays at 1 s); the server handles
  SIGTERM/SIGINT by closing (which stops the grab helper) and exiting 0, and `grab.py` exits within about 1 s
  when its parent dies (`select` with a 1 s timeout and a `getppid` check); a release within 30 ms of a
  hold/long-hold button's press is contact bounce and is ignored, so the hold continues as one press.

## 2026-11-22: QA round 3 (01 03 04 06 09 10)

- **NEEDS PERMISSION shows only the requested call (01).** A `PermissionRequest` entry carries the request's
  tool and file, the requested command for Bash only (null otherwise), and never output (a call waiting for
  permission has produced nothing). The generic `permission_prompt` entry (its payload names no tool)
  describes the open call only, and nothing when no call is open. `reduce` alone does the same. The gallery's
  `worst-*-permission` shots merge their content through `asPermission` (`emulator/worst-case.js`), the same
  rule, so they show what the state core can emit (an Edit with no `$` row).
- **No diff under NEEDS PERMISSION (03).** The turn total reads as the size of the asked edit. The request's own
  size is not shown either: no recording (Claude Code 2.1.330) has a PermissionRequest for Edit/Write/MultiEdit,
  so that payload is not proven, and `old_string`/`new_string` line counts overstate an edit that keeps context
  lines. `boardView.diff` stays the turn total; the view hides it in `permission`.
- **An untied prompt clears on its agent's next tool event (06).** A pending entry with no `tuid` (its call had
  already closed, its Pre was lost, or the match was ambiguous) is cleared by any later PreToolUse, Post* or
  PermissionDenied of the same agent (generic entries: of the main thread). An agent with an open dialog
  neither starts nor finishes other calls. A tied entry keeps the old rules because it may be one of several
  parallel calls (concurrency-safe tools run side by side), and a sibling call's events prove nothing. Other
  agents' events never clear an entry (round 2's rule kept). Not solved: a tied entry whose Post was lost after
  approval stays until Stop, idle_prompt or a driver prompt.
- **Needing the driver outranks OFFLINE (04).** `view = locked ? insert-key : offline && activity !==
  'permission' ? offline : activity`. This changes the order in "synthetic events" above for this one case.
  The dialog is local: Claude is blocked on the driver whatever the network does, and answering it (terminal
  now, wheel buttons later) needs no network. OFFLINE then shows as one grey row at the bottom (`No network:
  voice input will not work`), which takes one of the command's rows. WAITING, WORKING and DONE stay under
  OFFLINE, because what the driver would do next there is speak, and that needs the network. INSERT KEY still
  wins (the data is locked).
- **Commands break at spaces (09).** The displayed command has a U+2060 WORD JOINER after each `-` that is
  followed by a non-space; `data-full` and the ellipsis cut use the plain text. A token longer than a row still
  breaks inside it. The row height is read from the computed line-height of `#command`, and a test pins it
  (40 px, 6 rows).
- **`#session` is not reachable with the emulator's fonts**: next to NEEDS PERMISSION, `9+` and NO BUTTONS,
  `#where` keeps about 190 px against its 157 px floor. A test forces it with a style; the Pi's fonts may differ.

## 2026-11-22: wheel buttons 3, sessions and actions (built; real Claude Code here, not on hardware)

Owner one-shot job 20261122T061803Z-o-0ba39d. Code: `src/sessions/` (README), `src/server/` (README), `hooks/`.
Recordings: `fixtures/buttons/README.md`, section WB3. Bench S1-S6.

- **Sessions: plain interactive `claude` in a private tmux server**, as BUTTONS.md section 3 chose, not the
  owner's item text (`claude --bg` + `attach`): an attached pane adds a client layer (Left opens the agent list,
  Ctrl+Z detaches) and voice inside an attached `--bg` session is unknown. `claude agents --json` is not used.
  `--sessions` uses `tmux -L revview` (socket in `/tmp/tmux-<uid>/`, mode 0700), always with `-f /dev/null`.
  Each session runs `claude --session-id <uuid>` with a uuid revview made, stored as the window option
  `@revview_id`; that uuid is also the hook events' `session_id` (recorded), which ties the chosen session to the
  bar. `--start <dir>` starts one at boot. The chosen session is a plain variable in the runner (`choose`, `list`,
  `start`, `stop` are plain functions for WB4). There is no HTTP route to start or choose a session.
- **Keys go only to the chosen session, re-verified at every send**: the runner lists the windows and finds the
  one whose `@revview_id` is the chosen uuid, then `send-keys -t @<window id>` (tmux never reuses a window id in a
  server's life). Gone -> the choice is cleared and nothing is sent. Only `Escape`, `C-c` and `Space` can be sent.
- **Actions** (`src/sessions/actions.js`), one gesture at a time: cancel tap = Esc; cancel long-hold = ONE Ctrl+C,
  and any further Ctrl+C within **5 s** of the last one sent is refused (two within the hint window exit Claude;
  4 s apart did not, recorded); push-to-talk tap = Space (voice tap mode); press tap = allow; deny tap = deny.
  **Hold-mode push-to-talk is not built** (the detector gives no key-down/up stream; bench S2).
- **What may act**: only gestures from the device reader or the dev bridge, and not `dropped`. The target comes
  only from the runner, never from the board. A POSTed event (e.g. `RevviewStarting`, which marks presses
  `dropped`, or `RevviewButton` under `--dev-bridge`, source `post`) can make a press do nothing, but can never
  make one act or change where it goes. That is our reading of WB2 review finding 7: suppressing is allowed,
  causing or redirecting is not.
- **QA r3-02 solved**: after revview sends Esc or Ctrl+C it feeds the internal `RevviewInterrupted
  {session_id}`; a session in a turn becomes WAITING FOR ME (pending prompts cleared: Esc rejects a dialog).
  `POST /event` refuses it with 403, also under `--dev-bridge`. Recorded: `/state` was `waiting` 300 ms after
  the press. An Esc or Ctrl+C typed by anyone else still leaves WORKING (no hook fires).
- **Allow / deny by a waiting PermissionRequest hook** (`hooks/permission-request.mjs`). The hook POSTs its stdin
  to `POST /permission` and waits. Only on a 200 with exactly `{"behavior":"allow"}` or `{"behavior":"deny",
  "message": <1 to 200 characters>}` does it print a decision (the server always sends the one sentence
  "Denied with the wheel button."; the hook accepts any message of that length, it is the server's job to choose);
  anything else (204, timeout, server down,
  error, extra keys) prints nothing and exits 0, so the normal terminal dialog stays. Never allow or deny by
  default, no `updatedPermissions` ("always allow" is impossible). Timeouts: the server ends its wait at **540 s**
  (204), the hook gives up at **570 s** (`REVVIEW_HOOK_WAIT_MS` is clamped to at most 590 s, `hooks/wait.mjs`), Claude Code's `timeout` is **600 s** in `hooks/settings-snippet.json` (since stage 2: `hooks/settings.json`).
- **The press answers only the prompt shown on the bar.** The server feeds the request's own event to the board
  and binds the request to the pending entry THAT event created (identity: session, agent, the board tick
  `since`; plus its shown tool, file and command). If the event created no entry (a duplicate, a request for a
  finished turn) the request is unbound and no button can ever answer it. A press answers a request only if, at
  that instant: the bar's view is NEEDS PERMISSION (`shownPrompt(board)`), the shown session is the chosen one
  (re-verified tmux target), the shown entry is the request's entry with the same text, it has been the shown
  prompt for at least **1500 ms** (`MIN_SHOWN_MS`, server clock injected in tests; any change of what the bar
  shows restarts the time), and exactly one waiting request matches. One press answers one request, once.
  Recorded: a press right after the prompt appeared did nothing, one 2 s later allowed.
- **An answered prompt leaves the bar at once.** When a press answers a request, the server feeds the internal
  `RevviewAnswered {session_id, agent, since, decision}` to the board, which removes exactly that pending entry
  (same session, agent and `since`); allow or deny, the session shows WORKING (or the next pending prompt) until
  PostToolUse, PermissionDenied or Stop arrive. It does not shorten the 1500 ms wait of any later prompt (the
  next prompt has its own `since`, so the shown-time restarts). `POST /event` refuses it with 403, also under
  `--dev-bridge`.
- **No carry-over**: after every board change, waiting requests whose entry left the board (answered in the
  terminal -> PostToolUse, Stop, interrupt, `RevviewStarting`) get 204 at once and are removed; a disconnected
  hook is removed; the 17th waiting request gets 503. No request id ever leaves the server, so nothing can name
  one, and no HTTP route answers.
- **Stage 2 must not post PermissionRequest to `/event`** as well: `/permission` puts it on the board. If it
  does, the press fails safe (the second entry is unbound or not the one shown).

Residual risks (honest):

- Any local process (including a Bash command Claude runs) can POST to 127.0.0.1:8138. It can: fake hook events
  that change what the bar shows (it could already); post `RevviewStarting` or a PostToolUse that clears a real
  prompt, so its waiting hook gets no decision (the terminal dialog stays: a denial of service, never an allow);
  fill the 16 request slots (same); post a fake `/permission` request and receive the driver's allow for it if the
  driver presses while the fake is shown (the answer goes to the faker, not to Claude Code). It cannot make a press
  answer a real request whose own tool, file and command were not on the bar for 1.5 s in the chosen session.
- The repo, branch and diff shown next to the prompt come from session state, which a hostile `POST /event` can
  change while the prompt is shown. The request's own tool, file and command cannot be changed that way.
- What the bar shows is the shortened command (`shortenCommand`); two commands that differ only beyond the shown
  part look the same to the driver. The request is still bound to its own entry, so a different hidden command
  can only be allowed if Claude itself asked for it.
- A real prompt raised while another prompt of the chosen session is shown waits behind it; the driver answers the
  shown one only. A subagent prompt shows no dialog in the main pane (recorded): if nobody answers in 540 s the hook
  ends with no decision, and what Claude Code then shows was not recorded (bench S6).
- The 5 s Ctrl+C gap is global, measured on the server's monotonic clock. A Ctrl+C typed by hand in the pane is not
  counted.
- Not proven: voice (tap or hold) inside tmux, the hook and buttons on the Pi, the real pods (bench S1-S6).

## 2026-11-22: wheel buttons 4, the driver's selection, list and menu (built; emulator only, not on hardware)

Code: `src/state/board.js`, `src/sessions/` (`actions.js`, `runner.js`, `projects.js`), `src/server/index.js`,
`src/view/view.js`; the READMEs of those folders; `config/projects.example.json`. Bench V1-V9. Everything below is
tested in the emulator and with a stand-in; nothing was tried on the Pi or the pods.

- **One selection.** The board's `selected` is the only source of where a key or an answer goes. The runner no
  longer keeps a chosen session (`target(id)` and `send(key, id)` take the id from the caller). Every key and every
  answer goes to `selectedKey(board)`, re-verified against the live tmux windows at that moment (`runner.target`).
  `owned` is the list of ids of the runner's windows, read at start, after New session, and every 5 s. It is `null`
  when the server runs without `--sessions` (then the old look stays).
- **When the selection changes.** Only by: driver gestures (left/right step through the sessions in the order first
  seen, with wrap; back hold = home; a row chosen in the list); a session revview started (New session, `--start`,
  or the only existing window at boot), which is selected at once because it is already on the board as a quiet
  placeholder (see the fix round below; `want` only covers the gap before the first `RevviewOwned`);
  the selected session ending or being dropped (it falls to home). Never by another session's events. A prompt in
  another session shows only as the `+N` hint with a triangle (`elsewhere`). The old focus heuristics (pending
  prompt pre-empts, sticky focus, working beats idle) apply only while nothing is selected.
- **Home ranking.** Needs permission, then waiting, then done, then working; the oldest ask first among equals
  (pending `since`, else `touched`). Deviation: this follows BUTTONS.md section 3 (done before working), not the
  cap's `PRIORITY` order in `board.js` (working before done). Reason: a done session needs the driver, a working one
  does not. The cap still drops by its own order.
- **Press and deny.** On the normal view with NEEDS PERMISSION shown, press is an allow attempt only: a refusal
  does nothing else and never opens the list. Otherwise press opens the list. Deny is never navigation. While a
  list or menu is open every button only navigates: no key is sent and no request is answered, and `shownPrompt` is
  null. The 1500 ms rule is unchanged. A selection change, and a list or menu closing, both restart the shown time
  (the prompt key includes the session; the registry saw `null` while the list was open). So a press right after a
  switch, right after a timeout close, or right after a prompt appeared cannot allow. `answer` also re-checks after
  its await that no list is open and the selection is unchanged.
- **Auto-close and back.** A list or menu closes after 10 s with no gesture (a server timer, `NAV_TIMEOUT_MS`,
  injected in tests; it is re-armed after every gesture). Back closes one level: new, projects or settings go to
  the menu, the list and the menu go to the normal view. The menu button opens the menu from the list and closes
  the menu and its screens (it toggles). Up and down move the row (no wrap); back hold = home from anywhere.
- **Internal events.** `RevviewSelect`, `RevviewNav`, `RevviewOwned`, `RevviewProjects` and `RevviewNote` get 403 on `POST /event`
  always, also under `--dev-bridge` (stricter than `RevviewButton`, which `--dev-bridge` accepts). The dev bridge
  reaches the list and menu only through `/dev/key` gestures. Dropped gestures and posted ones (source `post`) do
  nothing.
- **RevviewStarting** (any local process can post it) clears the selection but keeps it as `want`. It can blank
  the bar; it cannot redirect a button: the same session is selected again when its events return.
- **Projects file.** `--projects <file>` or `REVVIEW_PROJECTS`. Format `{"projects": ["/abs/dir", ...]}`
  (`config/projects.example.json`), at most 32. Each entry must be absolute, normalised, at most 4096 characters
  and free of `#` and control characters (the same rule as `runner.start`, which checks again and also that the
  directory exists). A bad entry is logged and skipped; a missing or malformed file gives an empty list and the
  bar still runs. **New session** = menu, New session, a project row, press: it starts `claude` in that directory
  in tmux and the board selects it at once (it is on the board as a quiet placeholder before its first hook). **Projects** is the read-only list of those paths
  (press does nothing). **Settings** is a read-only screen of four facts (voice needs tap mode, wheel buttons found or
  not, session counts, projects count); it changes nothing.
- **Bar looks** (view only; all at `TYPE_MM`, no new size). A mic mark and the position ("2/3") in the band, only
  when the server runs with sessions; without, the old look is unchanged. A crossed mic and a note row at the
  bottom when push-to-talk does not go to the shown session, in three wordings: "no session chosen", "not a revview
  session", "no revview session". The list and menu widget: a title row and up to 6 rows of 40 px; in the list a
  state chip, the label and the state word (a mic on the selected session's row); the highlighted row inverted with
  a bar at its left edge; a chevron mark when rows are above or below; labels cut in the middle like paths. The
  worst band (NEEDS PERMISSION, 9+, triangle, crossed mic, 12/13, NO BUTTONS) fits; its fixture is a hand-merged
  content object (13 sessions cannot be replayed: `MAX_SESSIONS` is 8), like the other worst cases.

Residual risks and what is not proven:

- `owned` is polled: the mic mark can be up to 5 s stale. Actions re-verify, so a stale mark never sends a key to
  the wrong window.
- A hand-started `claude` (not in revview's tmux) can be selected and shown, but the buttons do nothing for it; the
  bar says so (crossed mic and note). Home may still land on such a session (r4-06; design question, home
  ranking is unchanged).
- Positions renumber when a session ends.
- The list and menu can distract the driver; that is the owner's choice (BUTTONS question 8). Only the 10 s
  auto-close limits it.
- A posted `SessionEnd` of the selected session moves the selection to home. Any local process can do this; it
  can never cause an allow, because the 1500 ms rule restarts.
- A posted `SessionStart` carrying a revview session's uuid (visible in `ps`) makes a pending `want` select early;
  it is the same session.
- Not tried: the list, menu, switch and New session on the Pi, the pods or in the car; reading the 3.55 mm rows and
  the mic glyph in daylight; a real PermissionRequest after a switch. See bench V1-V9.

### Fix round (QA r4)

Code: `src/state/board.js`, `src/sessions/actions.js`, `src/server/index.js`, `src/view/view.js`. Issues
`docs/agents/issues/qa-20261122-r4-*.md`. Emulator only, like the rest.

- **List highlight is a session.** `nav.id` is the id of the highlighted session; the highlight follows that
  session when others come and go (r4-02), not the row number. If it ends while the list is open, the list closes
  with the note 'Highlighted session ended: list closed'. A prompt that becomes visible then starts its 1500 ms
  clock at that moment, because nothing is shown as a prompt while nav is open. An open New session or Projects
  view closes if the projects list changes.
- **Board `note`** (`RevviewNote`, internal, 403 over HTTP). Fixed texts only, never text from outside. Cleared by
  the next button gesture or by a selection.
- **Owned sessions are on the board at once** (r4-01, r4-03). Every `RevviewOwned` puts each owned window (valid
  UUID `@revview_id`, reported by revview's private tmux server) that is not on the board and not in `ended` as a
  quiet placeholder: state UNKNOWN, note 'No events from this session yet', in owned order. It is removed when it is
  no longer owned while still quiet. The first hook event makes it a normal session. So after a restart and after
  New session the session is on the board and selected immediately; the boot log says 'selected' only when that is
  true, else 'wanted'. An id-less hook event goes to the one live session when there is exactly one; a placeholder
  counts as one. New risk: session ids and names now also come from tmux windows. Only windows with a valid
  `@revview_id` UUID on revview's private tmux server count. Names are display text only (control characters
  rejected, trimmed to 64) and are never sent anywhere.
- **Refused or failed New session** shows a fixed note: 'project folder missing', 'see the server log' or 'no such
  project'. Never the error text.
- **The 8-session cap** drops sessions revview does not own before its own (r4-08).
- **Answers in words** (r4-04). `RevviewAnswered` stores the answer on the session. While the shown call is the
  answered one, the tool row says 'Denied: <tool>' or 'Allowed: <tool>'. This lasts until that session's next
  `PreToolUse`, `PermissionRequest` or permission `Notification`, `SessionStart`, or driver prompt. So DONE after a
  deny says Denied, never a denied command as if it ran.
- **Mic marks** (r4-09, r4-06). Crossed mic on list rows the buttons cannot drive; crossed mic on the band when
  offline or when no wheel buttons were found. Not-owned note: 'Buttons do nothing here: not a revview session'.
  The Settings voice row reads 'Voice: needs tap mode (/voice tap in Claude Code)': a requirement, not a detected
  value (r4-11). STARTING has one note row (r4-11).
- **A key send failing with 'selected session gone'** refreshes `owned` at once (not after up to 5 s).
- **Still open:** r4-05 (band numbers ambiguous), r4-07 (refused press is silent), r4-10 (band and row cuts), and
  home may still land on a session the buttons cannot drive (r4-06, part).

## 2026-11-22: wheel buttons 6, dongle and pod set-up (written, nothing run on hardware)

- **`pi/` holds the Pi files** for the dongle: `70-revview-dongle.rules`, `revview.service`, `install.sh`, README.
  Charter stage 4 (the whole image) is not built; `pi/` takes only what this job needs and the image can grow
  there. `docs/zmk/` holds the reference ZMK keymap, options and notes.
- **Config alone is enough to find the dongle.** `src/input` already matches by `device.vendor`, `device.product`
  and `device.name` (and the key bits) from `/proc/bus/input/devices`, or by a fixed `device.path`. So the udev
  rule only gives group `input` and mode 0660 and an optional symlink (a fallback for `device.path`). No product
  code was changed. The USB ids are a placeholder (ZMK default 1d50:615e, from memory) until bench W1 and D5.
- **The unit has no ordering on the kiosk, network or dongle** and passes `--input --sessions`, never
  `--dev-bridge`. User `revview` with `SupplementaryGroups=input`. A missing dongle is handled by the reader's
  retry with backoff. `KillMode=process` is a guess to keep the tmux sessions over a restart (bench D3).
- **The key map is `config/buttons.json` as it is** (F13-F24, no combos). A unit test checks it against the
  BUTTONS.md table, that the udev ids equal the config ids, that the reference ZMK keymap has the same keys in the
  same order and no hold-tap or layers, and that the unit has the right flags and no ordering lines.
- **ZMK details are from memory.** One fetch of `https://zmk.dev/docs` was refused by the proxy, so no ZMK option,
  node or default is checked. Every such file says so.
- **Open questions** (boards, 5-way part, `zmk.dev` domain, USB ids, hold on the Pi) are in BUTTONS.md section 9
  with suggested defaults. Bench items D1-D12.

## 2026-11-22: wheel buttons 5, read aloud (built; stand-in engine only, no engine or audio device here)

Code: `src/speech/`, `config/speech.json`, `src/sessions/actions.js`, `src/server/index.js`; the READMEs of those
folders. Bench R1-R14. Everything is tested with a stand-in engine (`tests/unit/fixtures/speech/fake-engine.sh`).
Nothing was heard: there is no audio device and no speech engine in this VM, so all sound is untested.

- **Engines.** espeak-ng is a Debian package, tiny, starts at once and sounds robotic. Piper sounds natural, but a
  voice is about 60 MB, it starts slower on a Pi 4B, and it is not a Debian package. The standing default from
  BUTTONS.md section 8 is kept: Piper first, espeak-ng as the fallback. They are an ordered list in
  `config/speech.json`, so the owner can change the order or the words without code.
- **Honest status of the engines.** Neither is installed here. The lead asked the owner for `apt:espeak-ng`
  (request id `20261122T134519Z-k-4b7f18`, pending when this was written). Piper has no apt package or recipe here,
  so it could not be installed or tried at all. Piper's command line (`--model <voice.onnx> --output-raw` piped into
  `aplay -r 22050 -f S16_LE -t raw -`) and the `/opt/piper` paths are FROM MEMORY and UNTESTED.
- **Pinning for the Pi (all from memory, unverified).** espeak-ng: whatever Debian 12 (bookworm) ships
  (`apt install espeak-ng`, 1.51 as far as I remember; check with `espeak-ng --version`). Piper: the rhasspy/piper
  release 2023.11.14-2 aarch64 tarball and the voice `en_US-lessac-medium`; the version and the file names are not
  checked. `aplay` comes from alsa-utils.
- **Design consequences.** The engine is a configured command, not code. The first engine whose programs and `needs`
  files exist is used. With none found, nothing harmful happens: the server logs `read aloud: no speech engine found
  (tried piper, espeak-ng): the read-aloud button does nothing`, and a tap puts the fixed note "Read aloud: no
  speech engine installed" on the screen. With one found it logs `read aloud: <name> (...)`. A bad config file is
  logged and the server runs without speech.
- **Safety.** The text goes only to stdin of the first stage. Arguments are an argv array, used exactly as written
  (no placeholder substitution), spawned with no shell. Each stage is its own process group. Stop is SIGTERM to the
  groups, then SIGKILL after 500 ms. A new speak stops the old one first, a push-to-talk waits for the stop before
  the Space key is sent, and server close kills speech, so no process is left over. Failures are logged, never
  thrown. Not handled: a hard kill (SIGKILL) of node itself can leave a speech child that finishes its sentence.
- **What the buttons do.** Read-aloud tap speaks for the selected session (none selected: refused). Hold or
  long-hold stops, also with a list open. It never sends a key and never answers a prompt. No HTTP route speaks, and
  `RevviewButton` stays refused over HTTP as before. The stop hold is the same F14 hold the config already had.
- **What is spoken.** A pending permission prompt of the selected session wins: "Permission: Bash <command>", the
  command cut at a word to 100 characters plus "...", other tools "Permission: <tool> <file base name>", and MCP-style
  tool names spoken with spaces. Else the last Stop's `last_assistant_message`, with code blocks, inline code, URLs,
  links (the text is kept), file paths and markdown removed, at most 3 sentences and 300 characters (BUTTONS.md
  said about 2; 3 is the built limit).
- **"Nothing to read."** When there is nothing to say, the fixed phrase "Nothing to read." is spoken. A driver needs
  to hear that the button worked; silence is ambiguous (broken, or empty?). `speakOnStop` never speaks that phrase.
- **The closing message is kept outside the state core.** `src/speech/memo.js` keeps the last Stop message per session
  in the server: at most 16 sessions and 8000 characters each, forgotten on SessionEnd. It is deliberately not in the
  board, so the board, the reducer and the view stay unchanged and the message text never goes to the page.
- **`speakOnStop` (charter stage 2) is off by default** (`config/speech.json`). When on, the closing text is spoken once
  when the SELECTED session stops, not while background subagents keep it working.
- **Not done, possible follow-ups.** No "speaking" mark on the view. No Settings row for the engine: Settings still
  does not show it. Neither engine, nor the audio path, was heard; see the bench.

## 2026-11-22: core hardening (WB4 follow-ups, real espeak-ng, QA r3-07 and r3-08)

Code: `src/state/board.js`, `tests/unit/board-hardening.test.js`, `tests/unit/speech-real-engine.test.js`.

- **Id-less events and placeholders.** `targetOf` no longer routes an event without a session id to a quiet
  placeholder (an UNKNOWN session known only from `RevviewOwned`). With exactly one non-quiet live session it goes
  there; otherwise to the anonymous `''` session, as with no session at all. A local process can no longer show a
  forged NEEDS PERMISSION on an owned session that has said nothing. (It can still show one on the anonymous
  session, as before: that is the hand-posted case and has no session to forge.)
- **SessionEnd of an owned id. Chosen: both halves.** The window is still there (`b.owned` lists the id), so the
  Claude in it may start again. (a) A `SessionEnd` for a quiet placeholder is ignored. (b) A `SessionEnd` for a live
  session whose id is still owned removes it but is NOT remembered in `ended`; the next `RevviewOwned` brings the
  placeholder back, and a late hook of that id is not dropped. Ids that are not owned keep the old rule
  (remembered in `ended`). Cost: a late event of a really finished owned session can show it again until revview
  drops the window from the owned list. One existing test (placeholders: "not for ended") was changed to say this:
  an ended id whose window is no longer owned still gets no placeholder; one still owned does.
- **r3-07, duplicate Post.** Each session keeps the last 64 `tool_use_id`s closed by a Post (`closed`). A Post whose id
  is closed and not open is a duplicate delivery and changes nothing (before or after Stop). A new Pre of the same id
  forgets the closing. It does not cover a Post whose Pre was never seen (no way to know it is a duplicate).
- **r3-08, Stop then idle_prompt.** A session remembers `stopped` (set by Stop; kept while the state is done or
  waiting; cleared by anything that makes it work again, for example a driver prompt). A turn counts as ended when
  `done`, or `waiting` with no tool open, or `waiting` and `stopped`. So a late Post after Stop + idle_prompt keeps
  WAITING FOR ME and still updates output. An idle_prompt during an unanswered prompt, with no Stop, still lets the
  Post mean working. No new guess about Claude Code: the README rule ("a turn has ended when it is done") is
  applied to the waiting that follows it.
- **Real espeak-ng (1.51 here), measured with `-w` files and a pipe nobody reads; NO SOUND WAS HEARD (no audio
  device).** The shipped line `espeak-ng -v en-us -s 165` with the text on stdin works as shipped: it writes a valid
  wav (RIFF), longer text gives a longer wav, exit code 0. Without a sound card it still exits 0 and prints ALSA
  errors on stderr (ignored). Stop (SIGTERM to the process group) ended a blocked espeak-ng and its pipe partner and
  nothing was left. `[[ ]]` IS phoneme input (`[[h@l'oU]]` was read as phonemes, shorter than the same text as
  letters): the reviewer's guess is confirmed, and text.js already removes it. `< >` are NOT markup without `-m`:
  `<break time="30s"/>` was spoken as words, not as a 30 s pause: the guess is refuted for the shipped line;
  scrubbing `< >` stays as a cheap safeguard in case someone adds `-m`. Still untested: the sound, Piper, the Pi,
  the `audio` group, the delay. The tests assert on the real engine only when it is on PATH (their names say so) and
  pass otherwise.

## 2026-11-22: stage 2 hook wiring (built; real Claude Code 2.1.330 here, not on the Pi)

- **Two hooks, one settings file.** `hooks/event.mjs` for every event the state core uses, `hooks/permission-request.mjs`
  (WB3) for `PermissionRequest`. `hooks/settings.json` is the complete hooks block (it replaces
  `settings-snippet.json`), `hooks/install.mjs` merges it into a Claude Code settings file (see `hooks/README.md`).
  Registered with `event.mjs`: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure,
  PermissionDenied, Notification, Stop, StopFailure, SubagentStop, SessionEnd (all in the 2.1.330 settings schema,
  checked in the binary). Not registered: SubagentStart, PreCompact, PostCompact (ignored by the core; each hook is a
  node start). No `matcher` on the event hooks (the earlier recordings used none and fired for every tool);
  PermissionRequest keeps `matcher: "*"` and `timeout: 600`.
- **event.mjs never posts PermissionRequest** (the press would do nothing with a duplicate pending entry) nor any
  `Revview*` name. Tests pin both, also end to end: the recorded `permission-prompt` session fed line by line through
  the real hook into a real server shows NEEDS PERMISSION (from the Notification) with exactly one pending entry.
- **Node, synchronous, 1 s deadline.** Same language and failure rule as the WB3 hook (nothing on stdout, exit 0 on
  any failure). Claude waits for each hook (about 0.1 s here, mostly node start-up); Claude Code's `async` hook option
  was not used because background hooks could reach the server out of order (a Post before its Pre). A hung server
  costs at most `REVVIEW_EVENT_WAIT_MS` (1000 ms, clamped 50..3000) per event; settings `timeout` 5 s is the backstop.
  The Pi's node start time is unknown (bench H3); if it is too slow, a curl one-liner or a resident helper is the
  fallback, not async hooks.
- **Synthetic events: who sends what.**
  - `RevviewContext` (accepted over HTTP): sent by `event.mjs` after SessionStart (not `compact`), UserPromptSubmit,
    Stop and Bash PostToolUse, with the git toplevel as `cwd` (a `cd` into a subdirectory never renames the repo) and
    the branch (`null` when detached or not a repo). Posted after the event itself, so the session exists on the board.
  - `RevviewStarting` (accepted over HTTP): key-on, before any Claude is ready. It belongs to the Pi's boot (stage 4):
    the kiosk/boot unit should post it once when the server comes up on key-on. Not a hook's job: a hook only runs
    once Claude is already up, and the event clears every session. Not sent by anything yet.
  - `RevviewNetwork {online}` (accepted over HTTP): a network monitor on the Pi (stage 4: hotspot link up/down, e.g. a
    small systemd unit polling the default route or NetworkManager's state). Not sent by anything yet.
  - `RevviewDataLock {locked}` (accepted over HTTP): the key-stick unlock on the Pi (stage 4, DESIGN data partition).
    Not sent by anything yet.
  - Internal ones (`RevviewInterrupted`, `RevviewAnswered`, `RevviewSelect`, `RevviewNav`, `RevviewOwned`,
    `RevviewProjects`, `RevviewNote`, and `RevviewButton`/`RevviewInput` without `--dev-bridge`) keep their 403; no
    hook sends them, and `event.mjs` refuses to forward any `Revview*` name from a payload.
- **Spoken summary on Stop** is WB5's `speakOnStop` (off by default); the wiring only had to deliver `Stop` with
  `last_assistant_message`, which it does. How to turn it on: `hooks/README.md`. Not rebuilt.
- **Recorded proof** (`fixtures/sessions/hook-wiring/`, real Claude Code 2.1.330, haiku, hooks installed by
  `install.mjs` into a temp `CLAUDE_CONFIG_DIR` next to a user's own recorder hook): the bar followed a session
  through repo, branch `main` -> `feature-bar` (after a `git switch` in Bash), Write +3, Edit, a failing command,
  done, ended. Seen for the first time: **PostToolUseFailure** (a Bash command with non-zero exit; fields `tool_name`,
  `tool_input`, `tool_use_id`, `error`, `is_interrupt`, `duration_ms`) and **StopFailure** (API unreachable; `error:
  "server_error"`, `last_assistant_message`, no `error_details`). In headless `claude -p` the StopFailure hook did not
  reach the server in any of 5 runs (the process exits first, probably); interactive (the car's mode, in tmux) it
  did, and the bar showed WAITING FOR ME, which is QA r3-05 (state core, not changed here). Not provoked:
  **PermissionDenied** (the auto-mode classifier allowed the command we tried; we did not try a really dangerous one),
  **worker_permission_prompt** (agent teams only). No duplicated PostToolUse (r3-07) and no late PostToolUse after
  Stop (r3-08) were seen.
- **A Claude that dies without SessionEnd** (decided, not built here). Hooks cannot see a death, and the state core
  has no clock by design. On the car every driver session is a revview tmux window (`--sessions`), and the server
  already polls the owned windows every 5 s (`RevviewOwned`); today `board.js` drops an id that is no longer owned
  only while it is still a quiet placeholder. Proposal: treat a session that WAS owned and is no longer owned like a
  `SessionEnd` (its window and so its Claude are gone). That is a small `board.js` change, owned by the state-core
  lead, so it is left to them. Sessions started by hand outside revview still stay until a new session pushes them out
  or `RevviewStarting` clears the board; a power cut restarts the server with an empty board anyway. A timer
  ("no event for N minutes") was rejected: a long silent tool call (a build, a test run) would vanish while it works.
- **Install on the Pi**: as the user that runs the Claude sessions (stage 4 still has to decide that user, see
  `pi/README.md`). One settings file only: the same hook installed twice (user and project settings) would post every
  event twice.
