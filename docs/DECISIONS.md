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

- A Claude that dies without SessionEnd (crash, power cut) and was NOT started by revview stays on the bar with its last
  state until a new session pushes it out or `RevviewStarting` clears the board: the state core has no clock by design.
  A session revview started (an owned tmux window) now ends when its window is gone from two listings (see
  "owned window gone ... confirmation", 2026-11-22).
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
  (Cycle 38: the activity still stays; it now also ends the compacting mark, see "Compaction note (cycle 38)".)
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
  node start). (Cycle 38: PreCompact and PostCompact are now registered, see "Compaction note (cycle 38)".) No `matcher` on the event hooks (the earlier recordings used none and fired for every tool);
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
- **A Claude that dies without SessionEnd** (decided; built later for owned windows only, see 2026-11-22 "owned window gone"). Hooks cannot see a death, and the state core
  has no clock by design. On the car every driver session is a revview tmux window (`--sessions`), and the server
  already polls the owned windows every 5 s (`RevviewOwned`); today `board.js` drops an id that is no longer owned
  only while it is still a quiet placeholder. Proposal: treat a session that WAS owned and is no longer owned like a
  `SessionEnd` (its window and so its Claude are gone). That is a small `board.js` change, owned by the state-core
  lead, so it is left to them. Sessions started by hand outside revview still stay until a new session pushes them out
  or `RevviewStarting` clears the board; a power cut restarts the server with an empty board anyway. A timer
  ("no event for N minutes") was rejected: a long silent tool call (a build, a test run) would vanish while it works.
- **Install marker.** Every command in `hooks/settings.json` ends with the bash comment ` # revview-hook`; `install.mjs`
  replaces only entries with that marker (plus, once, the old snippet form for this repo), so other tools' hooks named
  `hooks/event.mjs` are never touched (reviewer finding). A real session was re-run with the marker form: same events.
- **Install on the Pi**: as the user that runs the Claude sessions (stage 4 still has to decide that user, see
  `pi/README.md`). One settings file only: the same hook installed twice (user and project settings) would post every
  event twice.

## 2026-11-22: failed turn (StopFailure, QA r3-05)

QA r3-05: after an API error the bar showed a plain WAITING FOR ME, like a turn that ended well. Recorded now (Claude Code
2.1.330, `fixtures/sessions/hook-wiring/events-stop-failure*.jsonl`): `StopFailure` with `error: "server_error"` and
`last_assistant_message` ("API Error: Connection refused ..."); the terminal says "Resend your message to try again".

- **No new state word and no new shape.** The session really waits for the driver, so the state stays `waiting`
  (WAITING FOR ME); the body says the turn failed. A new word would be a state the events cannot prove apart from
  the recorded ones, and the driver's action is the same (speak again).
- **Reducer:** `StopFailure` sets `activity: waiting` and `failed: {error, message}`, built only from the payload:
  `error` only if it matches `/^[a-z_]{1,40}$/` (else `unknown`), `message` from `last_assistant_message` (control
  characters removed, trimmed, 200 chars, `null` if absent). Every other event that changes the state clears `failed`
  (a driver prompt, tool events, `Stop`, `SessionStart` not compact, `RevviewStarting`); events that leave the state
  untouched keep it. `RevviewNetwork`/`RevviewDataLock`/`RevviewContext` do not clear it, nor does the
  `idle_prompt` Notification (Claude Code is still idle about 60 s later; nothing was resent). Tool, file, command and diff
  stay in the state as before.
- **boardView:** flat key `failed` (`null` or `{error, message}`; present in every view, also with no session). While
  failed with nothing pending and no answered request, tool/file/command are null and `output`/`outputLines` are the
  message, so the old command's output does not sit under it.
- **View:** on `waiting` (and on `offline` over a waiting turn, on the row the Denied/Allowed word uses) the tool row reads
  "Turn failed: <error with _ as space>" (e.g. "Turn failed: rate limit"), bold and white with `data-failed="1"`
  (words, not colour alone); the message shows in the output rows and is cut to fit.
- Looks: `failed-turn` and `offline-failed` in `emulator/wb4/recipes.js`, made from the real interactive recording
  (`out/shots/wb4-failed-turn.png`, `wb4-offline-failed.png`).
- Not changed: headless `claude -p` still loses the StopFailure post (the process exits first); the car runs
  interactive claude.

## 2026-11-22: owned window gone, ended-session note (QA r5-03, r5-04)

- **Owned window gone ends its session.** A Claude that dies without a `SessionEnd` stayed on the bar for ever. Now a
  `RevviewOwned` list (re-posted every `ownedPollMs`) that lacks an id the previous list had ends that session when it is on
  the board and not a quiet placeholder: like a `SessionEnd` of a not-owned id (removed, remembered in `ended` so a late hook
  is dropped, phase `ended` if it was the last). No timer: a listed window stays however silent. `b.owned === null` (first
  list, no runner) ends nothing; sessions never owned are untouched. Cost: a window that vanishes and comes back (same id)
  needs a new id, since the old one is in `ended`; a `SessionEnd` posted for a still-listed window keeps the core-hardening
  behaviour (placeholder again on the next poll).
- **Note when the selected session ends.** If `selected` ends (SessionEnd or window gone) and sessions remain, the board note is
  "<repo> ended" (label cut to 100 chars, "Selected session" without a repo), cleared by the next gesture. `selected` itself
  is unchanged (fall to the home key, as before). "Highlighted session ended: list closed" is set later in the same reduce
  and replaces it: one note.
- **Voice `none` wins over the quiet note (r5-03).** With owned windows and no selection, the placeholder's "No events from
  this session yet" no longer hides "Push-to-talk goes nowhere: no session chosen"; a real board note still wins. The voice
  wording is unchanged: BUTTONS.md does not say a press chooses a session, so "press to choose" would be false.
- Changed assertion: `board-wb4.test.js` "placeholders: removed when no longer owned" expected a real session to stay when
  its window left the list; it now ends.

## 2026-11-22: a window must be missing twice (QA r5b blocking)

- **Rule.** One empty or short tmux listing proves nothing (the runner returns `[]` for any "no server" style error, which
  includes "error connecting" and "No such file or directory", so a hiccup looks like "nothing is running"). A session
  ends only when its id is missing from two consecutive successful `RevviewOwned` listings: the board keeps `missing`
  (ids that were owned or missing and are absent from the last listing); an id in `missing` that is absent again ends, an id
  that reappears is dropped from `missing`. A confirmation, not a timer.
- **Not put in `ended`.** A gone window's id is NOT remembered in `ended` (this replaces the first QA r5-03 wording): a dead
  Claude sends no hooks, a live one whose window was only misread comes back with its next poll (placeholder) or hook.
  Cost: a late hook of a really dead Claude would show it again; none comes in practice.
- **What clears the answered mark.** `answer` holds `{decision, tool, file, command}` only (the `tuid`/`agent` fields were
  never read and are gone). The mark clears at the session's next call (PreToolUse), a new permission request, SessionStart
  or a driver prompt, as before.
- **Not done:** `list()` still treats "error connecting" as no server (it is how tmux says it when the socket is absent, which
  is a real no-server); the two-listing rule is what protects the sessions. The server already skips the post on a thrown error.
- **Small:** `cleanText` also strips bidi/zero-width characters; `displayTool` output is cleaned and cut to 64 code points;
  the StopFailure message loses ANSI and is cut by code points; WebFetch prompts are spoken with the host, WebSearch with the
  query cut by words; `--remove` writes no backup (QA r5b-03).

## 2026-11-22: stage 4A, the Pi appliance set-up (written; tested against a fake root only, nothing run on a Pi)

Files: `pi/install.sh` (root steps), `pi/setup.mjs` (every file edit and generated file, pure functions + a CLI),
`pi/kiosk.sh` (respawn loop), `pi/revview.service` (now a user unit), `src/server/netmon.js`, `--boot` and
`--netmon` in `src/server/index.js`. Tests: `tests/unit/pi-setup.test.js`, `pi-install.test.js`, `pi-kiosk.test.js`,
`server-boot.test.js`, `netmon.test.js`; fixtures `tests/unit/fixtures/pi/` (stock Trixie files WRITTEN FROM MEMORY).
Owner steps: `pi/README.md`. Bench items P1-P14 in `docs/BENCH-TEST.md`, all untested.

- **One login user runs everything** (lead's default, kept). The ordinary user the desktop auto-logs in as (name given
  with `pi/install.sh --user NAME`, never assumed to be `pi`) runs the kiosk Chromium, the revview server and the Claude
  sessions (tmux). Reason: Claude Code's claude.ai sign-in (`~/.claude.json`, `~/.claude/`), its settings and hooks
  and the repositories live in that user's home, and Claude's `/voice` needs that user's audio session for the mic.
  The WB6 `revview` system user is dropped: it had no sign-in and no audio session. `install.sh` removes the old system
  unit `/etc/systemd/system/revview.service` if it finds it and prints `userdel revview` (it deletes no user). The user
  gets groups `input` (wheel buttons) and `audio`; it must exist already and must not be root.
- **The server is a systemd USER unit**, `/etc/systemd/user/revview.service` with `ConditionUser=<user>`, enabled by a
  symlink in `/etc/systemd/user/default.target.wants/` and started at boot through lingering
  (`/var/lib/systemd/linger/<user>`, the file `loginctl enable-linger` writes). Why a user unit and not a system unit
  with `User=`: a system unit gets no `XDG_RUNTIME_DIR` and no PipeWire session, so Claude's mic (inside the tmux
  sessions the server starts, which inherit its environment) and read aloud would likely have no audio; with lingering
  it still starts at boot without waiting for the desktop. Why in `/etc/systemd/user` and not in the home: part B moves
  the user's data onto the encrypted partition, and the server must run while that is locked (to show INSERT KEY).
  `User=` and `SupplementaryGroups=` do not belong in user units, so the groups come from the account. The unit keeps
  `--input --sessions`, never `--dev-bridge`, and no ordering lines (the WB6 test still holds unchanged); it adds
  `--boot --netmon` and `PATH=%h/.local/bin:...` (Claude Code's native install puts `claude` in `~/.local/bin`, from
  memory). Logs: `journalctl --user -u revview` as that user. `KillMode=process` stays (bench D3).
- **The repository lives outside the home** (`/opt/revview` suggested), readable by the user. Node is checked (22 or
  newer; a warning when missing, older or inside a home), never installed: the unit uses `command -v node` as found.
- **Kiosk.** `~/.config/labwc/autostart` (DESIGN) is generated: `wlr-randr --output HDMI-A-1 --transform 90`, then
  `<repo>/pi/kiosk.sh &`. A user autostart replaces the system `/etc/xdg/labwc/autostart` (from memory), so there is no
  desktop, panel or icons: that is the "black desktop, no icons". A foreign existing autostart is backed up once.
  `kiosk.sh` is the respawn loop: Chromium on `file://<repo>/src/view/boot.html?port=8138` (the boot page shows NO
  LINK until the server answers, then goes to `http://127.0.0.1:8138/`; src/view README "Boot page"), flags for
  Wayland (`--ozone-platform=wayland`) and against first-run, restore and crash bubbles, keyring prompts
  (`--password-store=basic`), translate, pinch and swipe-back. The profile is in `$XDG_RUNTIME_DIR` (tmpfs): fresh at
  every boot, so no restore prompt after a power cut and no browser writes to the SD card; the crash marks in
  `Preferences` are cleared before each respawn. Respawn after 1 s, doubling up to 30 s while Chromium dies in under
  10 s. Pause markers: `~/.config/revview/kiosk-paused` or `/boot/firmware/revview-kiosk-paused` (the second can be
  made from another computer on the SD card). All flag behaviour is from memory (no Chromium docs reachable).
- **Rotation, all three** (DESIGN "three things must agree"): `video=HDMI-A-1:400x1280M@60,rotate=90` on the kernel
  command line, `wlr-randr --transform 90` in the autostart, the touch udev rule
  `/etc/udev/rules.d/71-revview-touch.rules` with matrix `0 -1 1 1 0 0`. `--rotate 270` (mount flipped 180 degrees)
  gives `rotate=270`, transform 270 and matrix `0 1 0 -1 0 1`; `rotate=270` for the console is our inference, DESIGN
  only names the transform and matrix. `--output` changes the connector name in both places.
- **Quiet boot** exactly as DESIGN: `config.txt` gets `disable_splash=1` in a marked `[all]` block at the end (any
  other `disable_splash=` line is removed, so ours is the only one; a warning when no `dtoverlay=vc4-kms-v3d` is
  active); `cmdline.txt` loses `splash` and gets `quiet loglevel=0 logo.nologo vt.global_cursor_default=0` (old
  copies of these tokens and of `video=<output>:` are removed first, so every run gives the same file). cmdline.txt
  stays one line; a cmdline.txt with several lines is refused and left alone. The first change copies a file once to
  `<file>.revview-backup`.
- **Autologin**: `autologin-user=<user>` in `[Seat:*]` of `/etc/lightdm/lightdm.conf` (from memory: Pi OS with labwc
  still uses lightdm). Without that file the installer says to use raspi-config's Desktop Autologin and changes nothing.
- **Hooks**: `hooks/install.mjs` runs as that user (`runuser -u <user>`), so they land in `~/.claude/settings.json`
  owned by the user.
- **Testable here**: `install.sh --root <dir>` acts on a fake root (no root needed; no apt, usermod, systemctl or
  udevadm there) and `--dry-run` writes nothing. The tests run the real script against a temp root twice (the second
  run changes no byte) and run shellcheck on the generated autostart. `tools/check` lints `install.sh` and `kiosk.sh`
  (bash shebang); `setup.mjs` is linted by eslint. The generated autostart is not in git, so only the test lints it.
- **Packages**: `chromium tmux python3 espeak-ng wlr-randr` (only the missing ones, `--no-install-recommends`). No new
  npm dependency. Package names are from memory for Trixie (`chromium`, not `chromium-browser`; the loop tries both).
- **RevviewStarting: the server sends it itself, in-process, with `--boot`.** Right after listening, before the first
  tmux listing. Why the server: a curl from the autostart could run before the server is up and be lost, and the
  server knows when it is up. Before it listens the kiosk shows NO LINK (the boot page); after that, STARTING until
  the first session is on the board. `--boot` also starts the key-on Claude session itself, AFTER listening (so that
  session's SessionStart reaches the bar), in `REVVIEW_START` (one directory, from `/etc/revview/server.env`; unset =
  none, the driver starts one from the menu), and only when tmux has no revview window (a power cut killed them; after
  a service restart the surviving window is selected and nothing new starts). A failed start is logged and the bar
  stays up. Known gap: once the started window is listed it shows as a quiet placeholder (UNKNOWN, "No events from
  this session yet") until Claude's SessionStart hook, not as STARTING; making a quiet placeholder read STARTING during
  the boot phase is a state-core change, left to core (it must not trap the driver if SessionStart is lost). Without
  `REVVIEW_START` and with no surviving window the bar says STARTING until the driver starts a session.
  *(Superseded 2026-11-22, QA r6-01: that trapped the bar, as presses are dropped during STARTING. See "QA round 6:
  STARTING always ends" below; the known gap is closed there too.)*
- **RevviewNetwork: the server sends it, in-process, with `--netmon`** (`src/server/netmon.js`, injected probe and
  timers). "Online" = a default route on any interface (`/proc/net/route` or `/proc/net/ipv6_route`; no interface
  name, nothing about Ethernet) AND a TCP connect to `api.anthropic.com:443` within 3 s (`REVVIEW_NETMON_HOST`
  overrides it). Why that host: Claude Code needs it anyway, so no extra service is contacted, and a hotspot whose
  Wi-Fi link is up while the phone has no signal (a tunnel) still counts as offline. No route = offline with no
  traffic at all. Every 10 s while online, 5 s while offline; OFFLINE after 2 failures in a row (one lost connect does
  not flash the bar), back after 1 success. Cost: one DNS lookup and one TCP handshake per 10 s. Not chosen:
  NetworkManager's state (says nothing about the phone's own signal), ping (ICMP needs a capability), an HTTP request
  (more bytes). Whether the host answers a bare connect from the car and how fast OFFLINE shows is bench P11/P12.
  Both events are also accepted over HTTP (they are not in the 403 list); the server does not need that.
- **RevviewDataLock** is part B (not sent by anything yet).
- **Where part B hooks in** (nothing here blocks it):
  - The home holds the sign-in. Part B mounts the LUKS data partition and puts `~/.claude`, `~/.claude.json`, the
    repositories and the push credentials there (bind mounts or symlinks). Recommended: keep `~/.config/labwc` and
    `~/.config/revview` on the root file system, so the kiosk starts while the data is locked; or install the
    autostart as `/etc/xdg/labwc/autostart` instead. Decide in part B.
  - The server and its unit live outside the home (`/opt/revview`, `/etc/systemd/user`), so the bar runs while locked.
    The unlock step sends `RevviewDataLock` (accepted over HTTP: a curl to 127.0.0.1:8138, or an in-process flag like
    `--netmon`), and the key-on session must start only after unlock: today `--boot` starts `REVVIEW_START` at server
    start, so part B either moves that start behind the unlock or has the unlock step trigger it.
  - Read-only root: the kiosk profile is already in tmpfs; the linger file, units, udev rules, `server.env` and the
    `/boot/firmware` edits are written once by the installer (run it with the overlay off). tmux sockets are in `/tmp`.
  - Piper install, `docs/REVOKE.md`, power-cut behaviour: part B.

- **Review fixes (stage 4A).** Paths written into the autostart, unit and udev rules must match `^/[A-Za-z0-9._/-]+$`
  (setup.mjs exits 2, install.sh refuses the same). A `cmdline.txt` with no `root=` token is skipped byte-identical,
  with a warning and exit 1 (other files are still done). The rotation edit also drops `fbcon=rotate:N` and any
  `video=` token carrying `rotate=` (ours from an earlier `--output`); a `video=` without `rotate=` is the user's and
  stays. Edited files are written by temp file, fsync and rename (on the FAT boot partition that is still the best
  available); a symlink target is refused (skipped, exit 1); `--root` is resolved with `pwd -P` and never `/` unless
  given as `/`. Every lightdm `[Seat:*]` section is edited; `apt-get update` precedes install. netmon: one probe at a
  time (a pending lookup counts), lookups through `dns.promises.Resolver({timeout, tries: 1})` with cancel, connect to
  the IP, `stop()` cancels a running probe, default timeout `DEFAULT_CONNECT_TIMEOUT_MS` (3000) tested. The flaky
  `close() kills a running stand-in` test asserted the stand-in's `sleep` child was dead the instant `close()`
  returned; close() only waits for the stand-in itself, so the test now polls (reproduced 1 in 20 idle, 8 in 20 under load).

## core small run (cycle 14)

- **Cap and missing.** `capSessions` gets `[...owned, ...missing]` (both the `RevviewOwned` call and the hook-path call), so a window missing from one listing is not evicted at the cap.
- **Late hook of an ended owned session: pinned, not changed.** It shows the session again (live, not quiet); `tests/unit/board-owned-gone.test.js` names it a known limit. A repeated identical PreToolUse already cleared the answered mark; now pinned by a test.
- **Failed-turn message** wraps over the free rows (6, or 5 with the grey voice note) and is cut with an ellipsis only beyond them. **Long tokens** (over 24 characters) may break after `/ - _ . = :` (ZERO WIDTH SPACE in the shown text only); short tokens keep the r3-09 rule (a flag moves whole).
- **Missing project folder (r5-07):** `RevviewProjects` carries an optional `missing` subset; the server re-checks on the owned poll; New session rows show MISSING. Project rows lead with the folder name (bold), the rest of the path grey.
- **r5-03:** the note reads "No session chosen: press up to open the list".
- **r4-05:** with a position `i/N` the band drops `+N` and shows the number of other sessions needing permission after the triangle (`9+` from 10); without a position `+N` stays. Not proven on the panel (bench V8).
- **r4-10:** a 24 px gap before the band hint. Cut rules are NOT unified: the band cuts at the end (little room, the start identifies the repo), the list cuts in the middle (the tail tells similar names apart). Left as is on purpose.
- **r4-07:** only the too-early refusal (prompt shown under 1.5 s) shows "Too early: press again" in the grey note row; other refusals stay silent. A successful answer clears the board note.
- **Finding 2 (reason split):** the registry now refuses with `too-early` when the prompt is the shown one but under 1500 ms old, and with `not-shown-long-enough` when nothing, or another prompt, is shown. Only `too-early` sets the note. The allow rule did not change; a second fast press is refused again.
- **Stale "Too early" note:** `RevviewAnswered` clears any board note (`reduceBoard`, with the `RevviewNav` clear). Also, while the note is "Too early: press again", a change of the shown prompt (another session or prompt on the bar, or none) clears it, so it cannot sit under a prompt it was not meant for. No timer: with the same prompt shown the note stays until a press, a gesture or a selection change.
- **Tests added:** missing-once session kept at the cap by a later `RevviewOwned` (mutation: dropping `...missing` fails it); `9+` with more than 9 other sessions needing permission; no U+200B in commands without a token over 24 characters.

## 2026-11-22: stage 4B, power cuts and the locked data (decided before building; nothing run on a Pi)

DESIGN leaves the power-cut answer open ("propose one") and decides the encryption (LUKS, Adiantum, a key file on a
stick on the keychain, no password prompt at boot, "insert key" while locked, `docs/REVOKE.md`). These are the
decisions for part B. Everything about raspi-config, cryptsetup, udev and systemd below is FROM MEMORY (no
documentation reachable from the VM, no Pi): every such step is a bench item, `untested`.

### (a) Power cuts: a read-only root, made by raspi-config's overlay

- **Read-only root, not a shutdown HAT.** DESIGN offers both. The overlay needs no hardware, no wiring to the ignition
  and no extra part on a dash in the sun; a HAT can still be added later and changes nothing here. With the overlay the
  SD card's root and boot partitions are never written while driving, so a cut at key-off cannot damage them. The only
  file system written in the car is the encrypted data partition (below): ext4 with its journal (`data=ordered`, the
  default commit every 5 s), checked with `e2fsck -p` before every mount. What a cut can still lose: the last seconds
  of writes on the data partition (a Claude transcript line, a file being saved, an unfinished `git` operation: bench
  B-items say how to check with `git fsck`). It cannot lose the system or the sign-in.
- **raspi-config's overlay file system, not an own initramfs hook.** It is the stock Pi OS way (Performance Options,
  Overlay File System; `raspi-config nonint do_overlayfs 0` turns it on, `1` off, *from memory*), it is maintained by
  Raspberry Pi with the kernel and initramfs it ships, and an own hook would be early-boot code we cannot run or test
  here. Its boot partition read-only option (`nonint enable_bootro` / `disable_bootro`, *from memory*) is turned on
  too, so `/boot/firmware` (FAT, the most fragile) is not written either.
- **A separate step, run last:** `pi/readonly.sh status|enable|disable`. `install.sh` and `data-setup.sh` refuse
  (exit 2, nothing written) when `/` is an overlay right now, and `install.sh` also when `/boot/firmware` is mounted
  read-only (`pi/lib.sh` reads `/proc/mounts`; in a fake root `<root>/proc/mounts`). Updating = `readonly.sh disable`,
  reboot, update/re-run the installer, `readonly.sh enable`, reboot (pi/README.md "Updating"). `disable` takes two
  rounds when the boot partition is read-only under an active overlay: the first turns the overlay off (after making
  `/boot/firmware` writable for that boot), the second, after the reboot, turns the boot read-only option off.
- **Claude Code's auto-updater is off in the unit** (`DISABLE_AUTOUPDATER=1`; the name is in the 2.1.330 binary, its
  effect is from memory): under the overlay an update would land in RAM and vanish at the next boot. Claude Code is
  updated in the update procedure (`claude update`, overlay off).

### (b) The key stick and the data partition

- **What is encrypted:** ONLY Claude Code's state (`~/.claude`, including the sign-in `.credentials.json` and the
  former `~/.claude.json`), the repositories (`~/repos`) and the push credentials (`~/.ssh`: per-repository deploy
  keys, or a fine-grained token in a credential file there). `~/.config/labwc` and `~/.config/revview` stay on the
  root, so the kiosk and the bar run while the data is locked.
- **Where it is mounted:** the LUKS partition opens as `/dev/mapper/revview-data` and mounts (ext4,
  `noatime,nosuid,nodev`) on `/srv/revview-data`, a root-owned directory. In the home, `~/.claude`, `~/.ssh` and
  `~/repos` are SYMLINKS to `/srv/revview-data/{claude,ssh,repos}`, made once by the set-up. Why symlinks and not bind
  mounts into the home: root would mount onto paths the user can change (a user's symlink swapped in at the right
  moment would make root mount the data over, say, `/etc`); with the symlinks root never mounts anything in the home,
  and a locked partition leaves them dangling into an empty root-owned directory, so nothing can write secrets to the
  root by accident.
- **`~/.claude.json` moves into `~/.claude`** through `CLAUDE_CONFIG_DIR=$HOME/.claude` (checked here with Claude
  Code 2.1.330: with `CLAUDE_CONFIG_DIR` set, `.claude.json` is written inside that directory and the home's copy is
  not touched). A symlinked or bind-mounted single file would break when Claude replaces it by rename. The variable is
  set for the server (and so for every Claude in its tmux sessions) by `/etc/revview/data.env`, and for the user's
  terminals by `/etc/profile.d/revview-claude.sh` (only for that user). Both are written by the data set-up only:
  without the data set-up nothing changes (Claude would otherwise miss its existing `~/.claude.json`).
- **The stick is found by its file system UUID**, recorded at set-up in `/etc/revview/data.conf` (not by label: a
  label is easy to repeat on another stick, and the set-up never guesses a device). The key is a file of 4096 random
  bytes at `revview/data.key` on the stick (FAT, exFAT or ext4), made by the set-up straight from `/dev/urandom` onto the
  stick: it never exists on the root. The set-up also adds a recovery passphrase to a second key slot (asked
  interactively; `--no-recovery-passphrase` skips it): it opens the data if the stick is lost and is needed to remove
  the lost stick's key slot (docs/REVOKE.md).
- **LUKS2 with Adiantum** exactly as DESIGN: `--cipher xchacha12,aes-adiantum-plain64 --key-size 256`. The key-file
  slot uses `--pbkdf pbkdf2 --iter-time 500` (4096 random bytes cannot be guessed, so a slow key derivation only slows
  every boot on a Pi 4B); the passphrase slot keeps cryptsetup's default (argon2id). Options *from memory*.
- **Set-up is destructive only on request:** `pi/data-setup.sh --user NAME --device /dev/X --key-device /dev/Y`
  never picks a device itself; `--format` is needed to erase, and the device name must be typed again (or given as
  `--confirm /dev/X`); `--dry-run` writes and erases nothing. It refuses a device that is not a partition, is mounted
  or in use, is the key stick or on the stick's disk, and a key device that is not on USB or is mounted. Without
  `--format` it only (re)writes the configuration for an existing LUKS partition.
- **Unlocking:** `pi/unlock.sh`, run as root by `revview-unlock.service` (a system oneshot unit) at boot and again by a
  udev rule (`72-revview-key.rules`, matching the stick's UUID) when the stick is plugged in later. It mounts the stick
  read-only (`ro,nosuid,nodev,noexec`) on a 0700 directory under `/run`, hands the key file's path to
  `cryptsetup open --key-file`, and unmounts the stick at once. The key is never copied, printed or logged. A symlink
  on the way to the key file, a key of the wrong size, a wrong key or a failed `e2fsck` leave the data locked (logged,
  exit 1). It is idempotent (already open or mounted: nothing to do) and serialised with `flock`. `data.conf` is read
  as data, never sourced; each value is checked against an allow-list.
- **Stick pulled while running: nothing happens.** The partition stays open until power-off; the key is only in the
  kernel. Locking at once would kill the running Claude mid-write and the driver loses the session for nothing: in the
  car the power goes at key-off anyway, and then the data is locked again. Cost: someone who takes the Pi while it runs
  and keeps it powered has the data; that is why the credentials must be revocable (REVOKE.md).
- Not chosen: `/etc/crypttab` with systemd's key-file-on-a-device form (no clean "stick inserted later" path, no hook
  for telling the server, and a missing stick makes boot wait); Clevis/Tang (DESIGN: later, maybe).

### (c) What the bar shows and what works while locked

- **INSERT KEY** (the state core's `insert-key` look: "Data locked", "Insert the key stick to unlock"), over STARTING.
  The bar, the network check, the buttons (list, menu, back) and read aloud work. **No Claude session starts:** the
  key-on `REVVIEW_START` session waits for the unlock, and the menu's New session is refused while locked (the server
  wraps the runner's `start`; nothing in `src/sessions/` changes). After the unlock the bar goes on to STARTING and the
  key-on session starts once, exactly as before.
- **The server decides "locked" itself, from the kernel's mount table.** With `--data-lock [DIR]` (or
  `REVVIEW_DATA_MOUNT=DIR`, set by `/etc/revview/data.env`; default DIR `/srv/revview-data`) it reads
  `/proc/self/mountinfo` at start, every 3 s, and when poked: unlocked = the topmost mount on DIR is ext4 from
  `/dev/mapper/revview-data`. It applies `RevviewDataLock {locked}` in-process.
- **Trust decision.** A posted `RevviewDataLock` is today accepted over HTTP, and any local process may POST to
  127.0.0.1. If that post decided the lock, any local process could fake an unlock and make the key-on session start.
  So with `--data-lock` a posted `RevviewDataLock` is only a poke: its `locked` value is ignored, the server re-reads
  the mount table and answers 204. An unprivileged process cannot fake that mount: `/srv/revview-data` is owned by
  root (no FUSE mount there without write access to it), and FUSE would show as `fuse.*`, not ext4 from the mapper
  device. `unlock.sh` posts the poke so the bar changes at once; if the post is lost (the server is not up yet) the
  next 3 s check or the server's own start finds it. Without `--data-lock` (development, the emulator) the event
  is applied as before. A local process as the kiosk user can still start a Claude by hand in tmux; nothing here tries
  to stop the user's own processes, only to keep a forged event from starting one.
- **Behaviour without the data set-up stays as today:** no `data.env`, no `--data-lock`, `--boot` starts the key-on
  session at server start.

### Built (stage 4B), and what was decided while building

- Files: `pi/lib.sh`, `pi/readonly.sh`, `pi/data-setup.sh`, `pi/data.mjs`, `pi/files.mjs` (the writer of `setup.mjs`,
  moved out unchanged), `pi/unlock.sh`, `pi/revview-unlock.service`, `pi/72-revview-key.rules`; `pi/install.sh` and
  `pi/revview.service` changed; `src/server/datalock.js` and `src/server/index.js` (`--data-lock`). Docs:
  `pi/README.md` (data, read-only root, Updating, Piper), `docs/REVOKE.md`, bench S4B-1 to S4B-19 (the "Stage 4B" series; renamed from a second B1-B17 in QA round 6b). Tests:
  `pi-readonly`, `pi-unlock`, `pi-data`, `pi-data-setup`, `datalock`, `server-datalock`, more in `pi-install`.
- **Piper: documented steps, no script.** A download whose checksum cannot be known here is not put in a script; the
  steps (rhasspy/piper 2023.11.14-2 aarch64 into `/opt/piper`, voice `en_US-lessac-medium` into `/opt/piper/voices`)
  match `config/speech.json` and are FROM MEMORY. espeak-ng stays the fallback.
- `unlock.sh` pokes the server with `locked:true` when the stick is absent and `locked:false` after an unlock or when
  already unlocked; nothing on refusals (the server decides from the mount table anyway). The unit runs it as
  `/bin/bash .../unlock.sh`, so it does not depend on the file's mode. cryptsetup's and e2fsck's messages go to the
  journal (neither prints key material); cryptsetup's stdout is dropped.
- `data-setup.sh` also refuses before any change: `--confirm` without `--format`, `/srv/revview-data` already
  mounted, `/dev/mapper/revview-data` already open (with `--format`), and a key file already on the stick that is a
  symlink or not 4096 bytes (an existing good one is reused, so one stick can serve again). The copy, delete and
  symlink steps of the migration run AS the user (`runuser`), so root never walks a path the user controls. Without
  `--format` it refuses while the data is open (the device has a child): register a new stick with the data locked
  (REVOKE.md (c)).
- `install.sh` skips the hooks (exit 1, the rest done) when `~/.claude` is a symlink whose target is missing (the data
  is locked); after a data set-up the hooks are already inside the moved `~/.claude`.
- The guarded New session re-reads the mount table at the press, so a press right after the stick is plugged in
  works before the next 3 s poll.
- Not verified anywhere: that util-linux `mount` records `/dev/mapper/revview-data` (and not `/dev/dm-0`) as the
  source in `/proc/self/mountinfo`. If it shows `dm-N` on the Pi, the bar stays INSERT KEY although the data is
  mounted (bench B-items say what to look at); the fix would be to accept the mapper's major:minor too.

### Review fixes (stage 4B)

Opus review: changes needed, 1 blocking, 8 smaller. Fixed:
- **Blocking: the path to `pi/unlock.sh` must be trusted.** The unlock unit runs `<repo>/pi/unlock.sh` as root, so a
  user-owned parent directory or `pi/` would let the kiosk user swap in their own script and become root. `data.mjs
  write` (and so `data-setup.sh`, before anything destructive) now checks EVERY component from `/` to
  `pi/unlock.sh` (`checkTrustedPath`): no symlink, owned by root, not group/other writable (a root-owned sticky
  directory excepted). README "Updating" now pulls with `sudo git -C` and says never to chown the repository.
- **Boot race:** a stick event during the boot run of `revview-unlock.service` would merge into the running job and
  leave the data locked. The udev rule now starts a second unit, `revview-unlock-stick.service` (same script, not
  enabled); `flock` in `unlock.sh` serialises the two.
- `--start` with a data lock but without `--boot` is refused (it would start a session before the server, past the
  lock). `--data-lock` takes the next argument only when it starts with `/`.
- REVOKE (c): mount the new stick `uid=0,gid=0,umask=077` (a plain FAT mount makes the key readable by every user).
- Documented: `authorized_keys` moves with `~/.ssh`, so SSH key login does not work while locked; FAT/exFAT sticks
  preferred (an ext4 stick replays its journal even when mounted read-only).
- **Kept on purpose: `DISABLE_AUTOUPDATER=1` for every install**, with or without the data set-up. The car cuts power
  at key-off, so an update in progress can be cut at any time with or without the overlay; Claude Code is updated in
  the update procedure. The criterion "behaviour stays as today without the data set-up" is about the key-on session,
  which does stay as today.

## 2026-11-22: QA round 6, STARTING always ends; part D (STARTING until the first hook); installer exit codes

Tested in the unit suite only (fakes, injected timers); nothing run on a Pi.

- **Rule: the boot STARTING always ends (r6-01).** `bootSessions` ends it in every path with the internal event
  `RevviewBootDone` (no POST can forge it): nothing to start, one or several surviving windows, a start that worked, a
  start or tmux listing that failed. The phase goes to `unknown`, so the buttons work and the menu's New session is
  reachable. Notes (the board note, cleared by the next gesture): nothing to start and no windows: "No session yet:
  open the menu for New session"; a relative `REVVIEW_START` (now refused before trying, no longer resolved against
  the service's cwd): "Key-on session not started: start folder must be an absolute path"; a missing folder: "...:
  start folder missing"; any other failure: "...: see the server log" (the log has the reason). A bound: after 60 s
  without an outcome STARTING ends with "Key-on session is slow to start: see the server log" and the start goes on.
  `--boot` without `--sessions` ends STARTING at once (nothing can start a session). Under `--data-lock`: INSERT KEY
  while locked with working buttons (as 4B (c)); the start and its 60 s bound begin at the unlock; a failed start
  there ends STARTING the same way.
- **Presses are dropped only while the boot STARTING lasts** (the board flag `booting`, set only by the server's own
  boot through the internal `RevviewBootBegin`, and view `starting`), not during a per-session STARTING. A POSTed
  `RevviewStarting` keeps its old meaning (blanks the bar, placeholders come back as UNKNOWN) but never sets
  `booting`, so it can neither drop presses nor turn placeholders into a STARTING nothing would end.
- **r6-06:** while the boot lasts a quiet placeholder (window listed, no hook yet) shows STARTING, so a restart with
  one surviving window goes STARTING -> that session, without the "No session chosen" flash.
- **Part D: a session revview starts (key-on or New session) shows STARTING until its first hook, at most 30 s.**
  The server marks it with the internal `RevviewLaunching` after a successful start and arms a 30 s timer
  (`launchLimitMs`, injectable) that sends `RevviewLaunchExpired`; after that a still-quiet session falls back to the
  UNKNOWN placeholder "No events from this session yet". 30 s: Claude Code's SessionStart fires early in its start, a
  few seconds even on a slow machine *(not measured on a Pi: bench P20 times it)*; 30 s is long enough not to flip to
  UNKNOWN on a slow start and short enough that a lost SessionStart costs the driver half a minute, not the bar.
  The list is at most 8 ids.
- **Push-to-talk while the selected session is STARTING: dropped, with the note "Claude is still starting: push-to-talk
  not sent".** Claude is still loading, so a Space could land before its input is ready (typed into the prompt or
  lost). The allow rule for who receives keys is unchanged (this only adds a refusal). The mic is crossed while the
  view is STARTING. It keys on the selected session (the one the key goes to), not the shown one; with no selection nothing is refused here, and not while the data is locked (a session selected under INSERT KEY is already running). After the 30 s fallback push-to-talk is sent as for any quiet placeholder today.
- **r6-04:** a bad `REVVIEW_NETMON_HOST` is logged and the default `api.anthropic.com:443` is used; the server no
  longer exits 2 (a bad optional setting must not cost the whole bar).
- **Installer exit codes (r6-02, r6-03).** `setup.mjs`: 0 done; 4 a file refused or skipped so the appliance is half
  set up (a symlink at ANY component of the path below the root, the home included; a missing `cmdline.txt` or
  `config.txt`; a `cmdline.txt` with several lines or no `root=`; files left byte-identical); 2 bad arguments; 3 an
  unexpected error caught in main (message, no stack). Not 1 for a refusal: node itself exits 1 on an error outside
  main (an import or syntax error), which must not read as a refusal. `install.sh` keeps its own codes: setup's 4 ->
  the rest runs, final exit 1; setup's 2 -> "refused the arguments", exit 2; any other non-zero code (1, 3, a signal)
  stops it: no hooks, no "done" line, exit with that code. A missing `lightdm.conf` stays a note (exit 0). With
  `--root` as an ordinary user nothing is chowned (only root can give a file away). The standard merged-/usr links
  (`/bin`, `/lib`, ...) are on none of the written paths, so no exception is needed. Left as it is: `data.mjs write`
  still exits 1 for a refusal and `data-setup.sh` reports any failure the same way (a vaguer message, it stops).
- **The Pi needs no npm package** (checked: src/, hooks/, pi/ import only `node:` modules and relative files), so
  pi/README drops `sudo npm ci`; the repository comes by `git clone` over Wi-Fi or a copy from a laptop.

## 2026-11-23: QA round 6b (small fixes on the r6 branch)

- **Posted `RevviewStarting` and `RevviewDataLock` are refused over HTTP (403) unless `--dev-bridge` (r6b-08).** The
  server makes both states itself (`--boot`, `--data-lock`), so on a real install nothing legitimate posts them.
  Checked: `hooks/` posts neither; `pi/unlock.sh`'s poke posts `RevviewDataLock` to a server that runs with
  `--data-lock`, and that case is answered 204 before this check (re-read the mount table, as before). The
  emulator fixtures and the tests use the dev bridge, so they are unchanged. Rejected: bounding a posted
  `RevviewStarting` with a timer (more state for an event nobody should send).
- **The press-drop rule is pinned.** `dropped` keys on the internal `booting` flag, not on the phase or view alone;
  a test posts `RevviewStarting` after the boot and presses while the view is `starting` (mutating the rule to
  `board.phase === 'starting'` makes it fail).
- **r6b-01:** the push-to-talk refusal note ("Claude is still starting: push-to-talk not sent", constant
  `STARTING_PTT_NOTE`) is cleared by the reducer as soon as the selected session no longer shows STARTING (launch
  limit or first hook); other notes are untouched. Bench P20 holds as written.
- **r6b-02:** a quiet placeholder that vanishes while selected gets "`<repo>` ended" even when it was the only
  session (the rule used to need other sessions). The owned poll logs `owned sessions: window of session <id>
  (<name>) disappeared (Claude exited or the window was closed)`; a key-on start that fails because tmux says the
  window or server is gone logs "Claude exited at once, its window disappeared before it could be set up" and the
  note is "Key-on session ended at once: see the server log". Not done: Claude's exit status or last stderr line
  (needs `remain-on-exit`, more machinery); the log says that it exited, not why.
- **r6b-03:** New session refused while locked: "New session not started: data locked, insert the key stick".
- **r6b-07:** UNKNOWN with no session at all (`voice` no-session) shows the note as the first line and leaves the
  fixed "Not known until Claude's next step" out; with a session present nothing changes.
- **Docs and installer.** REVOKE (c) step 3 adds the new key with `--pbkdf pbkdf2 --iter-time 500`, as
  `data-setup.sh` does for its key slot (from memory, not checked on a device) and asks the owner to write the slot
  numbers down (r6b-04). Updating in `pi/README.md` says to re-run `data-setup.sh` without `--format` after a change
  to the `pi/data.mjs` templates, with the order (update with the stick in, reboot without it, set-up, reboot with
  it); `install.sh` does not refresh those files (simpler and safe: it never touches an open data partition). The
  second bench series is `S4B-1..S4B-19` (r6b-05); the README says the repository is public and clones without a
  sign-in (not checked from the VM). `install.sh` ends with "not done: some files were refused" instead of "done.
  Next: reboot" when it will exit 1, and a dangling `~/.claude` link is described as what it is (r6b-06).

## 2026-11-23: QA round 7 (the owner's walk-through, fresh Pi to first drive)

- **The owner's dongle ids and key map live in `/etc/revview/buttons.json` (r7-03).** `pi/setup.mjs` creates it once
  from `config/buttons.json` (create-only, like `server.env`) and never overwrites it; the unit's `--input` reads it.
  `pi/70-revview-dongle.rules` is now a template (`@VENDOR@`, `@PRODUCT@`): the installed rule is regenerated on every
  run from the ids in the `/etc` file (4 hex digits, lowercased). A symlinked file, bad JSON or bad ids: the rule is
  refused (left byte-identical, install exit 1, the message names the file). When the `/etc` file differs from the
  repo default the installer prints one `note:` line with the `diff` command; it does not merge (an update that
  changes the shipped key codes must be copied over by the owner). Rejected: keeping the repo copy as the place (lost
  by the documented "copy over /opt/revview" update, and it blocks `git pull`); a separate ids file (two places
  again). Tested on a fake root: edit, re-run, the edit and the rule stay (`tests/unit/pi-install.test.js`). Not run
  on a Pi. A `device` with neither
  vendor nor product (name or path only, valid for `src/input/keymap.js`) is not an error: the installer prints a
  `note:`, writes no rule and exits 0; one id without the other, or a bad id, is refused as before (exit 1). A
  symlinked `/etc/revview` directory is refused for the read too (same `linkedComponent` check as the write). The
  file is root-owned, mode 0644 (the kiosk user only reads it): edit it with `sudoedit`; the README and the
  installer's closing message say so.
- **Voice set-up and the first drive (r7-02).** `pi/README.md` ends with "First drive (parked)". Checked in the
  installed Claude Code 2.1.330 (its strings; docs sites unreachable): `/voice [hold|tap|off]`, default hold; it
  writes user settings (`voiceEnabled`, `voice.enabled`, `voice.mode`); default binding `space` -> `voice:pushToTalk`;
  tap mode is "tap to start, tap to stop+submit"; needs a claude.ai sign-in; recording needs SoX (its own hint:
  "Ubuntu/Debian: sudo apt-get install sox"). So `sox` is added to the installer's packages (the package name on
  Raspberry Pi OS is taken from that hint, not checked on a Pi) and bench P21 checks it. From memory: the tmux detach
  keys; nothing is known about the Pi's audio stack. `/voice tap` is run inside the revview tmux session so it lands
  in the settings the sessions read (`CLAUDE_CONFIG_DIR` after the data set-up).
- **r7-01:** the last session's end says "`<repo>` ended: open the menu for New session" (repo cut to 80 characters);
  with others left it stays "`<repo>` ended". The key-on session (`RevviewLaunching` with `keyon`, from `--boot`)
  whose window vanishes while still launching gets "Key-on session ended at once: see the server log" (the same text
  as a start that failed at once). A push-to-talk tap with no session selected applies the internal
  `RevviewNoSessionPress` (403 over HTTP), which clears only these ended notes so "Push-to-talk does nothing: no
  revview session" shows. The allow rule and the press-drop rule are unchanged.
- **Bench document (r7-04..08).** README "On the Pi" gives the reading order. BENCH-TEST starts with "First
  afternoon" (18 ordered ids with what each needs); the rest is reference. The Stage 2 series is renamed HW1-HW7
  (Honest states keep H1-H10; H8-H10 moved there); the new dongle item is D13 (D7 was taken). Duplicates are kept and
  marked "superseded by X"; P13, P17, V3, V10 and HW7 say what the software does today; user-unit commands in the
  items; a "stop the service first" note for hand-started servers; script paths `/opt/revview/pi/...`. No item was
  deleted (149 rows before, 151 now, P21 and D13 new); all stay `untested`.

## QA round 7b

- **r7b-01:** the First afternoon list never starts a server by hand. S1 and S3 now use a session of the running
  service (key-on from `REVVIEW_START`, or New session; attach with `tmux -L revview attach`), so port 8138 and the
  dongle are never contested and the service is not stopped. S3's hook install is dropped: HW1 did it (the path there
  is `/opt/revview/hooks/install.mjs`). The "stop the service first" note stays for the reference items that do start
  one by hand. All ids stay unique and present.
- **r7b-02:** the normal end of a drive (the last session ends after hooks) gets the same note as r7-01:
  "`<repo>` ended: open the menu for New session", replacing "Voice input goes nowhere" on the ENDED screen (note2);
  the same push-to-talk tap clears it. Rule: set for the last session only when revview runs sessions
  (`owned !== null`: only then the menu has New session); the quiet-placeholder case is as before; without
  `--sessions` the old behaviour stays (no note). While the data is locked the view drops this note (INSERT KEY shows
  its own line; New session would be refused, r6b-03) and it shows again after unlock. The board cannot know whether
  New session would fail for another reason (no start folder, tmux gone): then the tap says so, as before. Fit: emulator
  test with an 80-character repo (1280x400, no overflow); no gallery shot covers it (the `ended` fixture has no note).
  The allow rule and the others-left wording are unchanged.
- **r7b-03:** `pi/README.md` says P1-P21. Older "P1-P14" texts in DECISIONS, JOURNAL, STATE and old issues are history
  and stay.

## 2026-11-23: Emulator on your laptop 1 (`emulator/run.sh`)

- **Key map:** `config/buttons.laptop.json` (dev bridge only; `config/buttons.json` unchanged): arrows, Enter = press,
  Backspace = back (hold = home), Space = push-to-talk, R = read aloud (hold = stop), Esc = cancel (long hold),
  N = deny, M = menu; no spare. The keymap parser now also accepts Up/Down/Left/Right/Enter/Backspace/Space/Esc and
  letters A-Z (Linux codes from input-event-codes.h, browser codes ArrowUp/KeyM/...).
- **Option:** server `--dev-keys <file>`, an error (exit 2) without `--dev-bridge`; the bridge then gets its own
  pipeline from that file. `GET /dev/keys` (registered only with the dev bridge, like `POST /dev/key`) lists the
  bound browser codes; `devkeys.js` prevents their default action unless Ctrl/Alt/Meta is held (browser shortcuts
  keep working). Without `--dev-bridge` nothing changes; the 403 rules and `pi/` are untouched.
- **Scale:** `--scale S` adds `--force-device-scale-factor=S` and keeps `--window-size=1280,400`. Chromium's
  `--window-size` is in device-independent pixels (seen in headless Chromium: width 1920 at factor 1.5 gave
  innerWidth 1920), so the window is S times bigger on screen and the page keeps its 1280x400 CSS viewport (the fit
  logic sees the panel size). Without `--scale` no factor is forced (a HiDPI laptop keeps its own).
- **Port:** the server starts on port 0 and the script reads the real port from its `view:` line (no race);
  `--port N` fixes it. 127.0.0.1 only, as always.
- **Browser order:** `REVVIEW_BROWSER`, else chromium, chromium-browser, google-chrome, google-chrome-stable,
  microsoft-edge, microsoft-edge-stable; its own `mktemp` profile (`--user-data-dir`), removed by the trap. If the
  browser returns within `REVVIEW_QUICK_EXIT_SECS` (default 3 s), the script says the window may be in another
  instance (or names the failure status) and keeps serving until Ctrl+C. No browser: prints the URL and serves.
- **WSL2 (from memory, untested):** detected by `WSL_DISTRO_NAME` or "microsoft"/"wsl" in the kernel release. A Linux
  browser is used if found and WSLg is there (`WAYLAND_DISPLAY` or `DISPLAY`); else Windows Chrome/Edge under
  `/mnt/c/Program Files...` with URL host `localhost` (WSL2 localhost forwarding) and a profile under the Windows
  `%TEMP%` (`cmd.exe` + `wslpath`).
- **Tests:** the shell test of `run.sh` is a node:test file (`tests/unit/emulator-run.test.js`, stand-in browser) so
  it runs in the existing unit step; `tools/check` is unchanged; its lint step shellchecks `emulator/run.sh` as a
  tracked `.sh` file.
- **Server and browser (fix round):** the script watches the server as well as the browser; if the server dies while
  the window is open (or while only serving) it prints "the server stopped" with the log tail, closes the browser,
  cleans up and exits 1. The browser runs in its own process group (`setsid`, else `pkill -P`) and the whole group is
  stopped on exit, so its children go too (a process that leaves the group itself could survive). The traps are set
  before `mktemp -d`; the port probe no longer silences stderr for the rest of the script.

## 2026-11-23: Emulator on your laptop 2 (demo mode)

- **Player beside the server, keys through it:** `emulator/demo/player.js` is its own process that POSTs to `/event`
  like a hook script would. The page's dev key forwarder (`devkeys.js`, unchanged) already sends every key to
  `POST /dev/key`; with the new server flag `--dev-demo` (an error without `--dev-bridge`) the demo codes (Digit1-9,
  KeyP, BracketLeft, BracketRight, `DEMO_CODES`) are not fed to the bridge but written to `GET /dev/demo`, an SSE
  stream (at most 2 clients) the player listens on. Without `--dev-demo` nothing changes; reducer and view are untouched.
  127.0.0.1 and the origin rules as always. None of the codes is bound in `config/buttons.laptop.json` (a test checks).
- **Scenes only from what the product has:** Claude events from the real recordings, re-addressed per session (as in
  `emulator/wb4/recipes.js`); offline and insert key by `RevviewNetwork` / `RevviewDataLock`, the events the product's
  own monitors send (accepted over POST under the dev bridge). The permission prompt is finished from its recording
  before "done", and all three sessions end for "ended", because the bar shows the neediest session and "ended" only
  when the last one goes. **Compaction (added later, keys 8 and 9):** the bar shows
  "Compacting context" in the tool slot while a session compacts (state `compacting`). Scene 8 = recording events 0-8 (auto compaction
  mid-turn: WORKING), scene 9 = events 9-20 (it ends, the turn ends, `/compact` at the prompt: DONE), one extra session `demo<loop>-compaction`
  (repo revview). Originally the keys were 1-7 and 8 and 9 did nothing.
- **Loop and jumps:** a loop ends with SessionEnd for its sessions and both overlays cleared; the next loop uses fresh
  session ids (`demo<loop>-<repo>`: ended ids are remembered by the board). A jump to N does the same, then posts
  everything up to scene N's target at once and paces on from there; a generation counter drops the old run's steps.
- **Timing:** the player takes an injected clock (`setTimeout`/`clearTimeout`); default 1.5 s between events, 5 s hold
  on each scene, speeds 0.25-4x. Tests drive a fake clock; no test waits on wall time for pacing.
- **Default and `--live`:** `run.sh` plays the demo unless `--live` is given ("a real session is asked for": no player,
  no `--dev-demo`, the server waits for real hook events). `--demo --live` is exit 2.
- **Lifetime:** the player exits when its `/dev/demo` stream closes or a POST cannot connect (the server went away);
  `run.sh`'s EXIT trap kills and waits for it. If it dies alone, `run.sh` says so once and keeps serving.
- **Not proven:** nothing has run on a real laptop (bench L3, L4). Speech in demo mode needs espeak-ng or Piper on the
  laptop (no variable: the server uses `config/speech.json` by default); run.sh installs nothing.

## 2026-11-23: Emulator on your laptop 3 (the guide, the key sheet, aliases, stop)

- **Where gesture labels come from:** what a tap, hold or long hold DOES is in code only as if-chains (`reduceNav` in
  `src/state/board.js`, `dispatch` in `src/sessions/actions.js`), not as an action table, so nothing could be derived
  from there. The words are one `LABELS` table in `emulator/keys-sheet.js`, beside the map's reader. The sheet is
  generated from `config/buttons.laptop.json` (keys, buttons, which have a hold or long hold) and `emulator/demo/scenes.js`
  (the scene names). `buildSheet()` throws, naming the button and gesture, when a mapped one has no label, and a test
  also checks every mapped button and gesture is in the output and that it fits 22 lines of 80 columns (a 24-row terminal keeps its prompt and the first line). A label can still
  be WRONG if the code changes; the test does not run the keys through the real actions. `run.sh --keys` just runs the module.
- **Stop (pid file, fixed after review):** the first version wrote `/tmp/revview-emu-<uid>-<pid>.pid` and identified the
  process by `emulator/run.sh` in `/proc/<pid>/cmdline`. Both were wrong: a planted symlink with that guessable name was
  followed, and a run started as `cd emulator; bash run.sh` (or any process with that text in its command line) was
  mistaken. Now `run.sh` writes `<pid>.pid` holding `pid start-time` (field 22 of `/proc/<pid>/stat`, after the last `)`)
  into a private directory: `$XDG_RUNTIME_DIR/revview-emu` when that is a writable directory, else
  `${TMPDIR:-/tmp}/revview-emu-<uid>`, else `/tmp/revview-emu-<uid>`; the directory is made mode 700 and must be a real
  directory (not a symlink) owned by the user with no group or other access, otherwise the next place is tried; the file
  is written with noclobber and mode 600. If no place works it prints `run.sh: no pid file; --stop will not find this
  run` and runs on. `--stop` (before the Node check, so it works without Node) looks in the same three places, reads only
  regular files it owns (a symlink or a FIFO is skipped and left, so a FIFO cannot hang it), signals a pid only when the
  live process has the recorded start time, removes a stale file, never removes the file of a live matching process
  (the run removes its own; one that does not stop in 5 s is exit 1), and says `stopped (pid N)` for EVERY run it
  stopped. Nothing running is exit 0. Linux `/proc` only. A run stopped before its pid file is written is not found.
  `REVVIEW_EMU_FALLBACK_TMP` replaces `/tmp` in the third place; only the tests set it, so they never touch the real
  `/tmp`; every test of `run.sh` also gets a private `XDG_RUNTIME_DIR`. The third place is the real `/tmp` for a user:
  a `--stop` there can still see a run that fell back to it.
- **Aliases:** `--print-aliases` only prints (a test points `HOME` at a temp dir and checks nothing is written; the comment
  line is fixed text, without the path, so a newline in the path cannot leave the comment). The path is
  quoted twice, with `printf %q` and then for the alias's single quotes; a test sources a block made for a path with a space
  and a quote. No alias or file is installed for the user.
- **No install needed:** `run.sh`, the server, the player and the sheet import only `node:` modules; checked from a copy of
  the tree without `node_modules`. The guide says so; `npm ci` is for the developer tests.
- **Untested:** nothing has run on a real laptop (bench L5) or on WSL2 (bench L6); the guide's WSL2 section and the
  tiling window manager advice are from knowledge and marked so. The guide's cheatsheet and alias block are checked
  against the real output by a test, but the text around them is not.

## 2026-11-23: Emulator on your laptop 3: review round 2 (`--stop`, wording)

- **Three stand-in browsers outlived every unit-test run (a test leak, not a run.sh bug):** the first three `emulator-run` tests end with run.sh still up and their cleanup SIGKILLed only run.sh's process group, but run.sh starts the browser with `setsid`; `finish()` now also kills what has the run's private dir on its command line, and an `after` guard fails the file if any process with one of those dirs is left.
- **`--stop` scans every place a run can have written to,** not only the ones its own environment names: a run started in
  a desktop shell (`XDG_RUNTIME_DIR=/run/user/<uid>`) was "not running" for a `--stop` from an ssh or WSL shell where it
  is unset, and the reverse, and likewise for a different `TMPDIR`. Now: `$XDG_RUNTIME_DIR/revview-emu` (if set),
  `/run/user/<uid>/revview-emu`, `${TMPDIR:-/tmp}/revview-emu-<uid>` and `/tmp/revview-emu-<uid>`, deduplicated, each
  only after the same `pid_dir_safe` checks. The writer's order is unchanged (it never writes to `/run/user/<uid>`
  unless that is `XDG_RUNTIME_DIR`).
- **Pid files:** a pid that is not `[1-9][0-9]{0,9}` or is <= 1 (0, 1, negative, leading zero, junk) is never signalled;
  the file is removed like a stale one (so it cannot sit there). The start time needs the same shape.
- **`--stop` goes through all files:** one run that does not stop within 5 s (its file stays, it is live) no longer ends
  the loop; the message is printed, the others are stopped, exit 1 at the end. `REVVIEW_EMU_STOP_WAIT_SECS` (test only)
  shortens the 5 s; a test uses a stand-in that traps TERM.
- **`REVVIEW_EMU_FALLBACK_TMP`** (test only) is kept for the real `/tmp`, and `REVVIEW_EMU_FALLBACK_RUN` (test only) now
  stands in for the real `/run/user/<uid>`, so every test of `run.sh` and `--stop` uses private directories only and can
  never see or stop another agent's run. **Untested:** the two real hard-coded paths themselves (`/run/user/<uid>` and
  `/tmp` as written in the script, without the test variables), and the foreign-owner checks (`-O` on the directory and
  on the file), which need a second user. Left as is: a run whose `run.sh` was killed with `kill -9` leaves the server
  and demo player running and `--stop` says "not running" (no pid of theirs is recorded); the guide says how to find them.
- **Wording:** the sheet footer and the guide said both "R only logs the gesture" and "R speaks on any machine with
  espeak-ng or Piper". Truth: R reads aloud only after a session was chosen with Left/Right (else "no session selected"),
  and Piper counts only when installed as `config/speech.json` says (`/opt/piper/piper`, the lessac voice, `aplay`). The sheet
  is 23 lines now; the limit is 24 lines of 80 columns (was 22).

## 2026-11-23: Emulator on your laptop 4 (`--live`: real sessions)

- **Decision:** `bash emulator/run.sh --live [DIR]` now starts a real Claude Code session and the laptop keys act on it.
  The old `--live` (no demo, server only waits for hook posts that nothing set up) is replaced. It reuses the Pi's sessions
  runner (`--sessions --start DIR`) with two new server flags, `--tmux-socket <path>` and `--claude-settings <file>`.
- **Per-run settings file, not an install:** the hooks come from a file made by `hooks/install.mjs --settings <file>` in
  run.sh's private temp directory and given to `claude --settings`. So `run.sh` never writes `$HOME/.claude`,
  `~/.claude.json` or a project's `.claude/settings*.json`, and removing the temp directory removes every trace.
- **Private tmux socket per run:** `<work dir>/tmux.sock`, so stopping kills exactly that tmux server (and its Claude)
  and cannot touch the user's own tmux or the Pi's `-L revview` server. The `attach:` line prints the exact command.
- **Port chosen before start:** the hooks must know where to post, so run.sh picks the port first and sets
  `REVVIEW_PORT`; the server, tmux, Claude and the hooks inherit it.
- **Why:** the demo cannot show what Enter, N, Esc and Space really do; a real session on the owner's laptop can,
  without a Pi, and with the same code path as the bar uses.
- **Risks:** `--settings` ADDS to the user's own settings, so their hooks still load, and revview's hooks installed
  globally would post twice (documented). Claude Code still keeps its usual files; run.sh only does not write them.
  A `kill -9` of run.sh leaves the private tmux server behind (the guide gives `tmux -S <socket> kill-server`). The
  session has the user's account and runs tools in DIR. `tmux` and `claude` are checked first (exit 1 if missing).
- **Unproven:** all of it with a real signed-in Claude Code (hooks firing from `--settings`, permission prompts, the key
  presses landing, Space as push-to-talk and voice input with a microphone, WSL2). Tested only with a stand-in claude:
  start, Enter allows and N denies through the dev bridge's `POST /dev/key`, every stop path leaves no tmux server,
  server or stand-in, an unrelated tmux server survives, `HOME/.claude` untouched. Bench items L7-L13.
- **Key sheet:** the footer now says nothing is sent to a Claude in the demo, and with `--live` Enter allows, N denies, Esc and Space are sent
  (24 lines, the limit).

## 2026-11-23: QA round 9 (--live: r9-01 .. r9-06)

Tested with the stand-in claude only; nothing here ran with a real Claude Code.

- **r9-01:** `run.sh --live` gives the server a projects list so menu -> New session works: the owner's
  `REVVIEW_PROJECTS` if set (the server already reads it; no new flag), else `--projects <work>/projects.json`
  written by run.sh with just DIR. The second session uses the same tmux socket and settings file. Documented in the
  guide and `emulator/README.md`. New session needs a row, so with a custom list DIR is only there if the owner puts it in.
- **r9-02:** the leftover-process pattern is `tmux .*revview-emu\.|src/server/index.js` (the private tmux server's argv is
  `tmux -f /dev/null -S <sock> ...`); a test reads the pattern out of the guide, checks it is in BENCH L11 and matches the
  real command lines of a run.
- **r9-03:** if the server dies while starting and its log shows the tmux failure, run.sh says "Claude exited at once"
  and how to see claude's own message (run it in a normal terminal; the tmux window closes with it, so there is nothing
  cheap to capture). Exit 1 stays. Guide entry added.
- **r9-04:** a DIR (given or the current directory) with `#` or a control character is refused in run.sh, exit 2.
- **r9-05:** the guide explains "Too early: press again" (1.5 s, `MIN_SHOWN_MS`). Not on the `--keys` sheet: it is at
  its 24-line limit. UNKNOWN, not STARTING: the --live first session is started by `--start` without `--boot`, a path
  that never marks `RevviewLaunching`, so it shows UNKNOWN until its first hook. That differs from the QA round 6 part D
  rule (which covers key-on and New session); not changed (the fix is in the server start order, not small, and `--boot`
  would change failure behaviour); the guide now says UNKNOWN. A session started with New session does show STARTING.
- **r9-06:** `--stop` keeps its search places and its pid + start-time check; it does NOT look under other TMPDIRs
  (scanning for them cannot be proven safe). When nothing is found it says so on stderr: it looked only under this
  shell's TMPDIR. The pid directory is removed on exit when it is empty (`rmdir`).

## 2026-11-23: Pi facts inventory (backlog f59dbf), part A only

The owner asked for the Pi set-up's from-memory facts to be checked against the real Raspberry Pi OS packages before
the bench. Both archives were unreachable from the VM this cycle: `deb.debian.org/debian/dists/trixie/Release` and
`archive.raspberrypi.com/debian/dists/trixie/Release` gave 403 from the proxy. No other route was tried (charter).
So nothing was checked and nothing in `pi/` changed.

- **One table, `docs/PI-FACTS.md`.** Every package name, path, config key, raspi-config function, Chromium flag,
  systemd/udev/logind detail and cryptsetup/lsblk option the set-up relies on, with where it is used (file:line, test,
  fixture), how to check it (which index, which `.deb` and which file inside it, or "only on the Pi" with the bench
  item) and a status. Every status is `from memory`. Facts nobody had flagged are in it too: package names other than
  the installer's six, the `/boot/firmware` path, the stock `cmdline.txt`/`config.txt`/`lightdm.conf` fixture content,
  udev rule ordering, user-unit and linger layout, group names, `/etc/profile.d` for desktop terminals.
- **Things to look at first when the archives open** (suspicions, not findings): whether `raspi-config nonint
  do_overlayfs` installs the `overlayroot` package or rebuilds the initramfs (it would then need a network at
  `readonly.sh enable` time; PI-FACTS O05); whether Pi OS's labwc session reads `~/.config/labwc/autostart` at all and
  whether it replaces the system one (L06); whether the Chromium package/binary is `chromium` or `chromium-browser`
  on Trixie (P01, P02); which package ships the `cryptsetup` command (P08).
- **Stale text left as it was:** DECISIONS "stage 4A" lists the packages without `sox` (added later, see QA round 7)
  and the WB5 espeak-ng pinning names Debian 12, not Trixie. Both are history; PI-FACTS has the current list.

## 2026-11-24: Live emulator gaps (cycle 36)

Both gaps from QA round 9 closed. Tested with stand-in `claude` programs and a real tmux only; nothing here ran with a
real Claude Code (bench L7-L15 stay `untested`).

- **STARTING for the first session.** `src/server/index.js` started the `--start` sessions straight on the runner, so
  nothing marked them. The CLI now remembers their ids and, once the server is up, calls `live.launched(id)`: the same
  function the menu's New session uses (`RevviewLaunching`, `launchLimitMs` = 30 s, then `RevviewLaunchExpired`). No second
  mechanism. This is only the non-`--boot` branch. The Pi's key-on path (`--boot`: `RevviewBootBegin`/`RevviewBootDone`,
  `bootSessions`, its 60 s limit, `launched(id, true)` with the key-on mark and its notes) is not edited; the existing
  `bootSessions` tests pass unchanged, and `tests/unit/server-cli-start-marks.test.js` runs the real CLI both ways (a real
  tmux and a hookless stand-in): without `--boot` it shows STARTING, with `--boot` it still shows STARTING with the boot line.
  The guide, BENCH L7, L14 and the r9-05 note above now say STARTING (the r9-05 text about UNKNOWN is history).
- **Claude exits early.** After the server answers, `run.sh --live` checks (`tmux has-session`, every 0.2 s in the loops it
  already has, with or without a browser) for the first 10 s (`claude_window`). If the Claude session is gone it prints
  "run.sh: Claude exited within 10 s of starting, so there is no session. Run `claude` once ..." and exits 1 through the
  normal clean-up (tmux server, browser, server, work dir, pid file and directory all gone). 10 s catches a first-run quit or a crash after start
  (QA round 10 found that a not-signed-in Claude does not end, see below), yet is short enough that a session the user ends on purpose is not an error.
  After the window nothing is checked: the run behaves as before (a Claude that ends later leaves the server and the bar
  up; Ctrl+C or the window ends the run, exit 0). Exit status 1, as for "Claude exited at once" (r9-03).
  Tests: stand-in that exits after 1.5 s, one killed after 1.5 s (both with and without a browser), and one that ends
  after 12 s (no message, run still up, clean stop).

QA round 10 (a real Claude 2.1.331 on the build VM, headless page; nothing on a laptop) found four small things, fixed on
the same branch:

- **r10-01 trust question.** A folder Claude has not opened asks "trust this folder?" in the tmux window; no hook fires, so
  the bar goes STARTING then UNKNOWN, and the default answer "No, exit" ends Claude. The guide (Live, Troubleshooting) now
  says to attach and answer; `run.sh` prints one more line after `attach:` ("if the bar stays on STARTING, attach ...");
  both early-exit messages now say "not signed in, or a first-run or trust question answered with exit?". Nothing
  answers the question automatically.
- **r10-02 permission mode.** 2.1.330/2.1.331 started in auto mode and showed no prompt; after Shift+Tab ("manual mode on")
  prompts came. Guide, L7, L8, L14 say how to get a prompt, without claiming what a user's own Claude starts in.
- **r10-03 not signed in.** The real not-signed-in Claude stayed up (WAITING, then "Turn failed: authentication failed").
  The 10 s message is for a Claude that really ends (seen: the trust question's "No, exit"; a crash; a first run that
  quits was not tried). Guide, L15 and the sentence above are corrected.
- **r10-04 late exit.** run.sh returns up to ~0.7 s before its Claude has ended. Wording only (guide, L11): wait a second
  before the `ps` check; no clean-up code changed.
- **Tests.** `REVVIEW_EMU_CLAUDE_WINDOW` (default 10) exists only so the "ends later than the window" test can use a 3 s
  window against a 12 s stand-in; it is not a user option. The 1.5 s stand-ins accept either exit message (a slow server
  can hit "exited at once"); a new test ends a stand-in 1 s after the server is up and requires the within-window message.

## 2026-11-24: Compaction note (cycle 38)

A long session compacts its context; the bar said WORKING for a minute or two with nothing changing, which looks like a
hang. Now the tool line says "Compacting context". Proven in the emulator and the unit suite only; nothing on a Pi
(BENCH C1).

- **Recording.** The existing `fixtures/sessions/compaction.jsonl` (Claude Code 2.1.330) was enough; no new recording.
  The installed 2.1.331 binary has the same schemas (`PreCompact {trigger: manual|auto, custom_instructions}`,
  `PostCompact {trigger, compact_summary}`). What it shows: a real compaction is `PreCompact`, then the summariser's own
  `SubagentStop` (its `last_assistant_message` is the `<analysis>` summary), `SessionStart {source: "compact"}`,
  `PostCompact`, and the turn goes on. Two of the five `PreCompact`s (one mid-turn, one just before `Stop`) were **not**
  followed by any compaction: the next events were simply `PreToolUse` and `Stop`. There is no failure or interrupt
  event; a compaction that does not happen just leaves the `PreCompact` alone. Durations (transcript timestamps from
  the tool result to the `compact_boundary`): 7.0 s, 6.1 s auto, 5.4 s manual, at ~35k tokens with haiku.
- **Mark.** The reducer keeps `compacting` per session. `PreCompact` (either trigger) sets it and changes nothing else.
  Every other Claude hook event clears it, also those it otherwise ignores (`SessionStart` compact, `PostCompact`,
  permission `Notification`s), **except `SubagentStop`** (the summariser's arrives mid-compaction), **any event
  carrying `agent_id`** (a background subagent still running during a main-thread compaction; recorded only on
  `SubagentStop`, so the recording is unchanged) and **an `idle_prompt` Notification** (a long `/compact` typed at an idle
  prompt). The mark cannot stick: the main thread's next event, PostCompact, SessionStart compact or the limit clear it.
  `RevviewInterrupted` (Esc
  sent by revview) and `RevviewStarting` clear it. `PreCompact` and `PostCompact` keep `failed` (a `/compact` after a
  failed turn does not redo it). A `PreCompact` of a session the board does not know makes no session.
- **Time limit: 180 s.** The server starts a per-session timer on each POSTed `PreCompact` after which the board's
  session really is compacting, and clears it as soon as the session no longer is (any clearing event, SessionEnd,
  close) (`COMPACT_LIMIT_MS`, option
  `compactLimitMs`); when it runs out it applies the internal `RevviewCompactExpired`, which clears a mark still set
  (not POSTable). The recorded 5-7 s were with a tiny context; the owner sees 1-2 min in long sessions, so 180 s
  covers a real one and bounds a lost end event (the hook failing, the server restarting).
- **No new main state.** `boardView` gains `compacting` (true only with no pending prompt, no failed turn, and activity
  working, waiting or done). Mid-turn auto compaction: WORKING + "Compacting context". A manual `/compact` at the prompt
  (the recording: after `Stop`): the session stays DONE (or WAITING) and shows the same line until `PostCompact`. The
  four main states are untouched; PERMISSION always shows its prompt.
- **View.** The words take the tool slot (same size, `data-compacting`), the file slot is empty, diff, command and
  output stay. Also under OFFLINE over those three activities. They outrank the "Denied:/Allowed:" word (that call is
  old news during a compaction). Not in the list or menu (they hide the tool line). Emulator fixture `compacting`
  (recording events 0-8, `EXTRA_FIXTURE_IDS`), screenshot `shots/compacting.png`; `emulator/tests/compacting.spec.js`
  checks that the line fits with every worst case over working/done/waiting/offline, alone and with the multi-session
  extras.
- **Hooks.** `hooks/settings.json` registers PreCompact and PostCompact (event.mjs). `event.mjs` drops
  `compact_summary` and `custom_instructions` before posting (large and private); no RevviewContext follows them.
- **Demo.** Keys 8 (`compaction`: events 0-8, WORKING + the line) and 9 (`compact-cmd`: events 9-20, the compaction ends,
  Stop, `/compact`: DONE + the line), in one extra session `demo<loop>-compaction`. The `--keys` sheet stays at 24 lines.

## Pi leftovers (cycle 39)

Tested in the unit suite only; nothing run on a Pi.

### data.mjs exit codes

- `pi/data.mjs` now uses the codes of `pi/setup.mjs` (QA round 6): 0 done; 4 refused (devices not acceptable, a file
  refused or skipped, an untrusted path to `unlock.sh`); 2 bad arguments; 3 an unexpected error, including an uncaught
  exception or unhandled rejection (handlers added; a one-line message, no stack). Before, refusal and crash were both 1,
  which is also node's own code for an import or syntax error, so a caller could not tell them apart.
- Callers: only `pi/data-setup.sh` runs it. It keeps its own codes: the two pre-flight runs (`check`, `write --dry-run`)
  fail with its exit 2 for any non-zero code (nothing changed yet, as before); the real `write` makes 4 and 3 both exit 1,
  now with a message that says "refused" or "failed (exit N)". `install.sh`, `unlock.sh`, `readonly.sh`, `lib.sh` do not
  call it. The table of all codes is in `pi/README.md`.
- Not tested: an unhandled rejection is tested with a preload that rejects after the handlers are installed, not from a
  real code path (none is known).

### Key map merged on update (buttons.json)

- Before: `/etc/revview/buttons.json` was written only if missing, and a `note:` pointed at `diff`. Now `pi/setup.mjs`
  merges three versions per key on parsed JSON: base (the shipped file recorded at the last run), new (`config/buttons.json`)
  and the owner's file. An array (the `buttons` list) is ONE value, so a changed key list is taken or kept whole, never
  woven. Owner unchanged: follows the update (added, changed, removed). Owner changed: kept. Same change on both sides: no
  conflict. Both changed differently, or removed upstream but edited by the owner (or the reverse): conflict, nothing is
  written for the key map, exit 4 (install.sh: 1) with the keys and the `diff` command; the other files are still done.
- Base: `/var/lib/revview/buttons.shipped.json` (root-owned, 0644), not beside the owner's file, so the owner's `/etc/revview`
  holds only what they may edit. Written after every successful merge and on a first install; left alone on a conflict.
  There is no uninstall script; the README's undo list names it (and the backups) for removal by hand.
- Formatting: JSON has no comments, so a rewrite uses the shipped layout (`serializeButtons`, tested to reproduce the
  shipped file byte for byte) and the owner's own layout is lost; values are not. When the merge result equals the owner's
  file semantically it is not rewritten. Before a rewrite the old file is copied to `buttons.json.revview-backup-<UTC
  stamp>` (newest 3 kept, older deleted: bounded, so repeated updates cannot fill the SD card), the write is atomic
  (temp file in the same directory, rename), mode 0644. Symlinks anywhere in either path, an unparsable owner file or an
  unparsable base: refused or ignored with a note, never written through.
- No recorded base (an install from before this): file equal to the new default -> the base is recorded; otherwise the file
  is kept and a note gives the diff command and two ways out: `install.sh --adopt-buttons-base` (keep the file, record the
  current default as its base) or copy the default over it. The flag is the owner's statement that their edits are theirs.
- The dongle rule is derived from the merged file (in a dry run from the text that would be written).
- Not proven: any of it on a Pi (fake root only); `--adopt-buttons-base` through a real `install.sh` run is tested on the
  fake root only. BENCH PL-2.

### Why the session ended

- **Capture.** `remain-on-exit on` is set in the same tmux command line that creates the window (`new-session ... ; set-option -g
  remain-on-exit on`), so even a Claude that dies at once leaves its window. The server's owned poll (5 s) calls `runner.reap()`:
  for each dead pane it runs `capture-pane -p -J -S -100`, then `kill-window`. Captured with scrollback because the first lines of a
  short run are already in history when the pane dies (seen on the installed tmux 3.4). tmux's own line "Pane is dead (status N,
  ...)" is dropped. Dead windows therefore live at most one poll interval and cannot pile up; the `--live` cleanup still ends
  with `kill-server`, which removes whatever is left.
- **Log.** Up to the last 20 cleaned lines go to stderr (the journal), under one header line with the id, name and exit status.
  The README of `src/sessions` and `pi/README.md` say that the journal then holds screen text. Untrusted: ANSI escapes and control
  characters are removed in the runner, again in the reducer; the bar sets note text with `textContent` only.
- **Bar.** New internal event `RevviewEndReason {session_id, text}`; the reducer keeps at most 8 reasons (`board.endReasons`) and
  makes the end note "Session ended: <line>" (line cut at 80 characters with an ellipsis; an empty screen gives "Session ended:
  no output"). If the end note was already made (a SessionEnd came first), the reason replaces it. It replaces the KEYON "ended at
  once" text too when a reason is known; the old texts stay when none is. A tap with no session clears it like the other ended notes.
- **On purpose.** No menu action stops a session today. `runner.stop(id)` kills a live window, which is never reaped, so no reason
  and no alarm. A Claude that ends itself (`/exit`, exit 0) gets the reason note too: the owner has no keyboard to ask why.
- **Emulator.** `emulator/run.sh --live` used `has-session` to notice a Claude that died at once; a kept dead window made that
  true, so it now looks for a live pane (`pane_dead` 0). The messages and exit codes are unchanged.
- **Not proven:** anything on the Pi (its tmux may be another version: BENCH PL-3), that the systemd journal shows the lines as expected.

### Review round (cycle 39)

- **Exit status of a dead pane.** tmux 3.4 shows `pane_dead=1` before `pane_dead_status`, and in about 3 of 8 runs side by side
  the status never came (probe: `1|` for 3 s). `reap` asks again (3 times, 100 ms), then leaves the pane for the next poll and
  reports status `null` only once the pane has been seen dead for 1.5 s. So the status is best effort (log header only); the bar
  never depends on it. Because of that wait the bar shows the reason about 10 s after the exit (a poll to see the window, a
  poll to report it); not shortened: the poll is also what the two-listing rule of `RevviewOwned` follows.
- **One reap at a time** (a queue): a second caller waits and then looks again. A capture that fails with the window gone is
  dropped, not reported as an empty screen. The server drops a reaped id from its "disappeared" log.
- **remain-on-exit stays global** (tmux cannot target the window just made in the same command line: tested, `set-option -w`
  there hits another window). So a dead window without `@revview_id` (opened by hand) is killed, unreported, once it has
  been seen dead for 1.5 s (never at the first sight: `start()` tags the window a moment after creating it).
- **End reason belongs to its session:** `board.endNoteFor` says whose end note is on the bar; a late reason replaces only that.
- **Key map:** keys are compared with `Object.hasOwn` and results built with `defineProperty`, so `__proto__` and `constructor`
  are ordinary keys (kept, added, removed). `--adopt-buttons-base` is refused (exit 4) when a valid base exists. Backups are ordered
  by file time (the Pi has no real-time clock) and the one just written is never pruned.
- **Second review:** the missing status is a lost SIGCHLD (the pane stays a zombie, 4 of 12 side by side, none came in 20 s);
  `reap` now runs `run-shell true` once per reap when a status is unknown, which makes tmux collect it (4 of 4), so the real-tmux test expects status 3 strictly (56/56 runs, 4 in parallel; 6/24 fail without it); `null` stays the fallback.
- **Hangs and odd names:** every tmux command times out after 5 s (child killed, an error for every caller, `has-session` too); the server runs one owned refresh at a time (callers meanwhile share one later run); a backup-named entry that is not a regular file (`lstat`) is noted and left alone.

## Thermal and power mark (cycle 40)

Tested in the unit suite only; nothing run on a Pi.

- **Option `--thermal`, poll every 5 s.** Sources: `vcgencmd get_throttled` (default) and `/sys/class/thermal/thermal_zone0/temp`;
  overridable with `REVVIEW_THERMAL_VCGENCMD`, `REVVIEW_THERMAL_THROTTLED` and `REVVIEW_THERMAL_TEMP`. `pi/revview.service` has it.
- **HOT** = throttle bits 2 or 3 ("now": throttled, soft temperature limit) OR CPU temperature >= 80 C, with hysteresis: it stays until the CPU is below 75 C.
- **LOW POWER** = bit 0 (under-voltage now).
- **Bit 1 (ARM frequency capped) does not make HOT.** From memory it is also set by under-voltage, so a weak adapter would
  show HOT and blame the wrong cause; bit 1 alone shows no mark. Unproven; bench PT-3 asks.
- **Never stuck.** `vcgencmd` is killed with SIGKILL on its 3 s timeout; every source read is also raced against a 4 s timer,
  and a read that gives no answer counts as unreadable (marks clear after the hold, polling goes on). A source with a read still
  stuck is not read again, and its late result is ignored.
- **Installer adds group `video`** (`vcgencmd` talks to `/dev/vcio`; from memory), next to `input` and `audio`.
- **Fullest band.** With NEEDS PERMISSION + 9+ + voice mark + NO BUTTONS, LOW POWER, then HOT, can be absent.
- **No mark for "has occurred".** Bits 16-19 show nothing: the bar says what is true now. They are logged once, so the journal
  keeps the history.
- **Hold of 10 s.** A mark that turns off stays 10 s, so a short dip is seen. Events are posted only when the marks change.
- **Quiet when unreadable.** A missing or garbage source gives one log line and no mark.
- **Board-level, not per session.** The marks are quiet outline tags in the band beside the other marks. Never a main state,
  never replace the state word. `RevviewThermal` is an internal event and is refused over HTTP.
- **Why.** A throttled or under-powered Pi makes Claude and the bar slow with no visible cause; the mark says the box, not Claude,
  is the problem. 80 C because the Pi 4B starts soft-limiting about there (from memory).
- **Not proven:** the sources, the bit meanings and that the service user may call `vcgencmd` (the unit is a user unit; `video`
  group is added by the installer, from memory). BENCH PT-1 to PT-3; `docs/PI-FACTS.md` X08-X10.
