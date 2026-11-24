# Live server

`src/server/index.js` receives Claude Code hook events, runs them through the pure state core
(`src/state`), and pushes the resulting state to the page over Server-Sent Events. It also serves the
view (`src/view/`). Node standard library only. It holds one **board** (`initialBoard()`, one entry per Claude
session, see `src/state/README.md`), reduces every event with `reduceBoard` and sends `boardView(board)` to the page.
No persistence: a fresh or restarted server shows `unknown` (a restored state could not be trusted, and hooks
posted while the server was down are lost).

Run: `npm start` or `node src/server/index.js [port] [--input [path]] [--dev-bridge [--dev-keys file] [--dev-demo]] [--sessions] [--start dir]... [--projects file] [--speech file] [--boot] [--netmon] [--thermal] [--data-lock [dir]]` (port default **8138**, or env `REVVIEW_PORT`).
`--input` reads the wheel buttons in this process (config `config/buttons.json`, or the path given); a bad config or
unknown flag prints the message to stderr and exits with code 2 before listening. `--dev-bridge` (or `npm run start:dev`) turns on `POST /dev/key`. SIGTERM and SIGINT close the server (stopping the grab helper) and exit 0.
It binds to **127.0.0.1 only**; there is deliberately no way to change the host from the CLI.
Open `http://127.0.0.1:8138/`.

## Key-on on the Pi: `--boot` and `--netmon`

`--boot`: the bar shows STARTING from the first moment until the boot is done (see below). After the server is
listening (so Claude's SessionStart hook reaches it) `bootSessions` looks at the tmux windows: none (the power was
cut, tmux is gone) starts one session per `--start` directory, or the one in env `REVVIEW_START` when no `--start`
was given (only used with `--sessions`), and selects the last; exactly one window (a service restart) selects it
and starts nothing; several select none. Every start revview makes (`bootSessions`, and the actions' New session) marks the session launching (`live.launched(id)`, internal, no HTTP route: board event `RevviewLaunching`) and arms a timer of `launchLimitMs` (default 30000; option of `startLiveServer`, with the injected `timers`) that applies `RevviewLaunchExpired`; both events are refused over HTTP with 403, `close()` clears the timers. Until its first hook the session shows STARTING (not UNKNOWN "No events from this session yet"); presses are NOT dropped then (only the boot STARTING drops them), so the menu and list work. A failure here is logged and never stops the bar. Each POSTed `PreCompact` (re)arms a per-session timer of `compactLimitMs` (default 180000) that applies the internal `RevviewCompactExpired` (403 over HTTP; `close()` clears these timers too). `bootSessions` always ends the boot
STARTING (`live.bootDone(note)`, internal, no HTTP route; the board events `RevviewBootBegin` and `RevviewBootDone` are refused over HTTP with
403), after any select, so the bar's buttons work and New session is reachable: nothing to start and no window ->
note "No session yet: open the menu for New session"; a start folder that is not absolute is refused before trying
(`REVVIEW_START must be an absolute folder, got <dir>` in the log; never resolved against the service's cwd) ->
"Key-on session not started: start folder must be an absolute path"; the runner's "cwd is not an existing
directory" -> "...: start folder missing"; any other failure -> "...: see the server log". If the boot has not
finished within `bootLimitMs` (default 60000, with injectable `timers`) the STARTING ends with "Key-on session is
slow to start: see the server log" and the start goes on (a later success still selects the session). With a data lock
the limit starts after the unlock. `--boot` without `--sessions` ends STARTING at once, with no note. Without `--boot`,
`REVVIEW_START` is ignored and `--start` works as before.

Session lost (r7-01): the owned poll logs `owned sessions: window of session <id> (<name>) disappeared ...` and the bar
says "<repo> ended" (other sessions left) or "<repo> ended: open the menu for New session" (none left). The key-on
session (`live.launched(id, true)`, board field `keyon`) that vanishes while still STARTING gets "Key-on session
ended at once: see the server log" instead. A push-to-talk tap with no session selected applies the internal
`RevviewNoSessionPress` (403 over HTTP), which clears such a note so the view's "Push-to-talk does nothing" line shows.

`--netmon`: "online" means a default route on any interface (`/proc/net/route`, `/proc/net/ipv6_route`, so the
phone hotspot over Wi-Fi counts) plus a TCP connect to the Claude API host (`api.anthropic.com:443`; env
`REVVIEW_NETMON_HOST` = `host` or `host:port` changes it; a bad value is logged (`REVVIEW_NETMON_HOST must be host or host:port, got <v>; using api.anthropic.com:443`) and the default is used, the server still starts; `netmonTarget` parses it). It checks every 10 s
(every 5 s while offline). Two failures in a row make the bar show OFFLINE; one success brings it back. Without
a default route nothing is sent at all. Nothing depends on Ethernet. Code: `src/server/netmon.js`.

## Heat and weak supply: `--thermal`

`--thermal` polls every 5 s and posts the internal `RevviewThermal` (`hot`, `lowPower`; 403 over HTTP) only when
a mark changes. HOT = throttle flags "throttled now" or "soft temperature limit now"
(bits 2, 3; bit 1 is not used, under-voltage is thought to set it too), or a temperature of 80 C or more (stays until below 75 C). LOW POWER = "under-voltage now" (bit 0).
A mark that goes off stays for 10 s so a short dip is still seen. The "has occurred since boot" bits (16-19) show no
mark; they are logged once per distinct value (`thermal: since boot: ...`).

Sources: the temperature from `/sys/class/thermal/thermal_zone0/temp` (env `REVVIEW_THERMAL_TEMP` = another file);
the flags from `vcgencmd get_throttled` (env `REVVIEW_THERMAL_VCGENCMD` = command path, 3 s timeout) or, with env
`REVVIEW_THERMAL_THROTTLED` = a file holding the value (`throttled=0x50005`, `0x50005` or decimal), from that file.
A source that is missing or unreadable (no `vcgencmd` off a Pi) or gives garbage is logged once
(`thermal: <source> not readable (<why>); no mark from it`), gives no mark, and never stops the server. The sources
are written from memory and are unproven on hardware. Code: `src/server/thermal.js`.

## Locked data on the Pi: `--data-lock [dir]`

`--data-lock [dir]` (or env `REVVIEW_DATA_MOUNT=dir`; default `/srv/revview-data`; the path must match
`^/[A-Za-z0-9._/-]+$`, else exit 2) makes the server watch the encrypted data partition. The data counts as unlocked
when the topmost mount on `dir` is ext4 from `/dev/mapper/revview-data`, as `/proc/self/mountinfo` says. The server
reads it at start, every 3 s, and when poked. While locked the bar shows INSERT KEY, the key-on session (`--boot`)
waits, and New session from the menu is refused; the bar, the buttons, the menu and read aloud keep working. When the
data unlocks, the key-on session starts once and the boot STARTING ends as above. Code: `src/server/datalock.js`.
`pi/data-setup.sh` writes `/etc/revview/data.env` with the variable; the unit reads it.

**The poke rule.** With `--data-lock`, a posted `RevviewDataLock` does NOT set the lock: its `locked` value is
ignored, the server re-reads the mount table and answers 204. Any local process may POST to 127.0.0.1, so a posted
value must not be able to fake an unlock. `pi/unlock.sh` posts the poke so the bar changes at once. Without
`--data-lock` (development, the emulator) the event is applied as before. Not checked on a Pi (`docs/BENCH-TEST.md`,
stage 4B).

## POST /event

Body: one raw hook JSON object. Content-Type is ignored. A Claude Code command hook gets exactly this
JSON on stdin, so the hook command can be:

    curl -s -X POST --data-binary @- http://127.0.0.1:8138/event

The synthetic `Revview*` events (see `src/state/README.md`) are POSTed the same way.

| Status | Meaning |
| --- | --- |
| 500 | the state core threw: event ignored, `seq` and state unchanged, the server keeps serving |
| 204 | accepted: `seq += 1`, state reduced, message sent to every SSE client (even if the state did not change) |
| 400 | empty body, malformed JSON, or JSON that is not a plain object; state unchanged |
| 403 | bad `Origin` or `Host` header |
| 405 | wrong method for a known path |
| 413 | body larger than `MAX_BODY_BYTES` (1 MiB = 1048576 bytes); not buffered, connection closed (see below) |

An oversize body is still answered 413 and closed, but the first 64 KiB are kept. If that prefix is a
`PostToolUse` (`"hook_event_name"` read with a strict regex) whose `tool_name` is a diff tool (Edit, Write,
MultiEdit) or cannot be found, a diff count was lost, so the server feeds
`{hook_event_name: 'RevviewDropped', session_id}` to the board (`session_id` read from the prefix with a strict
regex, omitted if not found): `seq += 1`, broadcast, and that session's diff becomes a lower bound (`≥`).
Anything else (no hook event name, or a huge Bash/Read output, a PreToolUse) counts no diff and changes nothing.
When only `Content-Length` is over the limit, the server
reads up to 64 KiB of the body (waiting at most 2 s) to get the prefix, then answers 413; memory stays bounded.

## POST /permission (the PermissionRequest hook's long poll)

Body (same 1 MiB limit): a JSON object with `hook_event_name === 'PermissionRequest'`, a non-empty string `session_id` and a
string `tool_name`, else 400. The event is applied like a `/event` one (the bar shows the prompt, `seq += 1`). The request is
then bound to the board entry **this event created** (same `session_id`, agent = `agent_id` or none, `since === board.tick`);
if there is none (e.g. nothing was added) it is bound to nothing and no button can ever answer it (logged). Without
`sessions`: 204 at once. Else it waits: 200 `application/json` `{"behavior":"allow"}` or `{"behavior":"deny","message":...}` when a
wheel button answers it, 204 when the prompt is gone (answered in the terminal, interrupted, timeout `permissionWaitMs`,
default 540 s, or server close). 503 when 16 are already waiting. A client that disconnects is forgotten. There is no route that
answers a request and the client cannot pass an id: only the buttons act (see `src/sessions/README.md`). After every
board change the registry drops requests whose prompt left the board and notes which prompt the bar shows.

## GET /events (SSE)

Headers: `content-type: text/event-stream`, `cache-control: no-store`. The stream starts with
`retry: 1000`, then immediately the current state, then one message per accepted POST:

    retry: 1000

    data: {"seq":3,"state":{...}}

A comment `: ping` is sent every 15 s to detect dead sockets. `seq` counts accepted events since the
server started.

## Other paths

- `GET /state`: `{"seq":n,"state":{...}}` (debugging, tests); `state` is `boardView(board)`, the same object as in SSE.
- `GET /sw.js`: the view's service worker (a static file, scope `/`). It only answers page and script requests from its cache when the server does not answer (see `src/view/README.md`); `/event`, `/events` and `/state` are never touched.
- `GET`/`HEAD` of any other path: static file from the view dir (`/` is `index.html`), `cache-control: no-store`,
  404 if missing, path traversal refused (403/404).
- Any other method on a known path: 405. Unknown API paths: 404.

## Wheel buttons (gestures)

With `--input` the device reader (`src/input`) runs inside the server. Its presence becomes the internal event
`{hook_event_name:'RevviewInput', present}` (only counted when it changed; the page shows the quiet NO BUTTONS tag).
Gestures (`tap`, `hold`, `long-hold`) are kept in an in-memory log of the last 32, **not** in the board: `seq` and the
state do not change for them. Each entry is `{button, gesture, source: 'device'|'bridge'|'post', at, dropped}`;
`dropped` is true while the boot STARTING lasts (board flag `booting`, set by the server's own boot via the internal `RevviewBootBegin`, and view `starting`; presses then are dropped, not queued; a POSTed `RevviewStarting` does not set it, so it never drops presses). Under INSERT KEY or after the boot is done presses are not dropped. `onGesture(entry)` is called
for each (a throwing callback is caught and logged).

- `GET /buttons`: `{"buttons": "unknown"|"present"|"missing", "gestures": [oldest first]}`, `no-store`.
- `POST /event` with `{hook_event_name:'RevviewButton'|'RevviewInput', ...}` is accepted **only with `--dev-bridge`**. Otherwise it
  answers 403 (`... is not accepted over HTTP (dev bridge only)`), nothing is logged and the board is unchanged: any local
  process without an Origin header could otherwise forge a press or fake NO BUTTONS. With the bridge, `RevviewButton` takes the
  normal path (204, `seq += 1`, the board ignores it) and, when `button` matches `/^[a-z][a-z0-9-]{0,31}$/` and `gesture` is one
  of the three, is also logged with source `post`.
- `POST /event` with `RevviewInterrupted`, `RevviewAnswered`, `RevviewSelect`, `RevviewNav`, `RevviewOwned`, `RevviewProjects` or `RevviewNote` is refused with
  **403 always**, even with `--dev-bridge`: they are the board's internal events (what revview itself sent or chose, the selection, the
  list/menu, the owned sessions, the projects). Only `actions.js` and the server itself apply them; there is no HTTP route for `select`.
- Gestures with source `device` or `bridge` (never `post`, never `dropped`) always go to the actions (`src/sessions/README.md`), with or
  without a runner. A list or menu open on the board means navigation only. Normal view: cancel tap = Escape, cancel long-hold = one
  Ctrl+C (not twice within 5 s), push-to-talk tap = Space, to the board's selected session only (re-verified for each); press tap =
  allow when NEEDS PERMISSION is shown (it never opens the list then), else opens the list; deny tap = deny. Without a runner keys and
  answers are refused (`no sessions`) and `owned` stays `null`.
- With `--input` and `--dev-bridge` together the bridge shares the device's detector (dev only; sources are told apart per key event).
- `--dev-keys <file>` (needs `--dev-bridge`, else exit 2): the bridge gets its own key map from that file (e.g. `config/buttons.laptop.json`, ordinary laptop keys) instead of sharing the device's. `GET /dev/keys` (dev only, same gating) returns `{codes: [...]}`, the browser codes of the bridge's bound keys; the page prevents their default action (not with Ctrl/Alt/Meta held).
- `--dev-demo` (needs `--dev-bridge`, else exit 2; option `devDemo`): for the laptop demo player (`emulator/demo/player.js`). `GET /dev/demo` (dev only) is an SSE stream
  (at most 2, else 503) of `{"code": "Digit3"}` for each key-down (not a repeat) of `DEMO_CODES` (Digit1-Digit9, KeyP, BracketLeft, BracketRight) that `POST /dev/key` receives;
  those codes are then NOT fed to the bridge (204). Without the flag the route does not exist and those codes behave as before.
- `POST /dev/key` (**dev only**): body `{code, type: 'down'|'up'|'lost', repeat?}` (`code` is a `KeyboardEvent.code`; `lost` = the
  page lost focus, like a vanished device). It feeds the same detector as the device (the one from `--input` when given,
  else one built from `config/buttons.json`). 204; unmapped code: 204 and ignored; bad body 400; over 1 KiB 413.
  Gating: the route is only registered with `--dev-bridge` / `devBridge: true`; otherwise it is an unknown path.
  It is still loopback only and subject to the Origin/Host checks. The page sends keys only when loaded with `?devkeys=1`.

## Read aloud (`src/speech`)

With a speech config the server can read aloud (`src/speech/README.md`). `--speech <file>` (default env `REVVIEW_SPEECH`,
else `config/speech.json`) is loaded at start. A bad config is logged and the server runs without speech. The log says
`read aloud: <name> (...)` or `read aloud: no speech engine found (tried piper, espeak-ng): the read-aloud button does nothing`.
- Hook events POSTed to `/event` feed a small memo of each session's last Stop message (kept in the server, not in the board).
- The gestures go through the actions: read-aloud tap speaks for the selected session, hold stops, push-to-talk stops first.
- With `speakOnStop` in the config, the closing text is spoken when the SELECTED session stops (not while background subagents keep it working).
- **No route speaks or stops speech.** `RevviewButton` and the internal events stay refused over HTTP as before.
- `close()` kills any speech. Untested with a real engine or audio device.

## Security notes

- Loopback only, so nothing on the network can reach it.
- Any request with an `Origin` header that is not `http://127.0.0.1:<port>` or `http://localhost:<port>`
  gets 403, so a web page open in the browser cannot POST events. curl sends no `Origin` and is allowed.
- Any request whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` gets 403 (DNS rebinding).
- Stream errors and bad requests never crash the process; a throwing reducer answers 500 and leaves `seq` and the state unchanged.
- At most **8** SSE clients (`MAX_SSE_CLIENTS`); the ninth `GET /events` gets 503. A client whose unread backlog
  passes 256 KiB (it never reads) is dropped.

`--sessions` makes the session runner on the private tmux socket (`-L revview`); at boot `--start <dir>` (repeatable, implies `--sessions`) starts `claude` there and the last one started is selected
(through `select(id)`); else exactly one existing revview session is selected (it is on the board at once as a quiet placeholder). The boot log says 'selected' only when the board did select it, else 'wanted'. `--projects <file>`
(default env `REVVIEW_PROJECTS`) is the New session project list (`src/sessions/README.md`, applied at start as `RevviewProjects`, with `missing` = the paths that are not directories; checked again on every owned refresh, and re-applied only when that set changes).
With a runner, `RevviewOwned` (the ids of `runner.list()`) is applied at start, after every session start and every `ownedPollMs`
(default 5000; an unref'd timer; a failing `list()` is logged and the last value kept). The tmux server is never killed by the live server (sessions outlive a restart).

Programmatic use (tests): `startLiveServer({ port: 0, viewDir, reduce, input, devBridge, inputDeps, inputRetryMs, onGesture, sessions, speech, clock, permissionWaitMs, minShownMs, projects, timers, navTimeoutMs, ownedPollMs })`
(`speech` is a read-aloud object from `src/speech` (default none); `sessions` is a runner (`list/target/send/start`), `clock`/`permissionWaitMs`/`minShownMs` go to the permission registry, `projects` is the
validated path list, `timers`/`navTimeoutMs` go to the actions; `permissionsWaiting()` is a test seam)
(`input` is a parsed config, `inputDeps`/`inputRetryMs` go to the device reader; `gestures()` returns a copy of the log) (`reduce` is a test seam for a failing state core; there is no host option) resolves to
`{ url, port, close(), state(), select(id) }` (`select(id)` is the internal `RevviewSelect` for the boot path) (`reduce` is `(board, event) => board`, default `reduceBoard`; `state()` returns `boardView(board)`).
