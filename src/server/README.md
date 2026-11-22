# Live server

`src/server/index.js` receives Claude Code hook events, runs them through the pure state core
(`src/state`), and pushes the resulting state to the page over Server-Sent Events. It also serves the
view (`src/view/`). Node standard library only. It holds one **board** (`initialBoard()`, one entry per Claude
session, see `src/state/README.md`), reduces every event with `reduceBoard` and sends `boardView(board)` to the page.
No persistence: a fresh or restarted server shows `unknown` (a restored state could not be trusted, and hooks
posted while the server was down are lost).

Run: `npm start` or `node src/server/index.js [port] [--input [path]] [--dev-bridge] [--sessions] [--start dir]... [--projects file] [--speech file] [--boot] [--netmon]` (port default **8138**, or env `REVVIEW_PORT`).
`--input` reads the wheel buttons in this process (config `config/buttons.json`, or the path given); a bad config or
unknown flag prints the message to stderr and exits with code 2 before listening. `--dev-bridge` (or `npm run start:dev`) turns on `POST /dev/key`. SIGTERM and SIGINT close the server (stopping the grab helper) and exit 0.
It binds to **127.0.0.1 only**; there is deliberately no way to change the host from the CLI.
Open `http://127.0.0.1:8138/`.

## Key-on on the Pi: `--boot` and `--netmon`

`--boot`: the bar shows STARTING from the first moment until a session is on the board. After the server is
listening (so Claude's SessionStart hook reaches it) `bootSessions` looks at the tmux windows: none (the power was
cut, tmux is gone) starts one session per `--start` directory, or the one in env `REVVIEW_START` when no `--start`
was given (only used with `--sessions`), and selects the last; exactly one window (a service restart) selects it
and starts nothing; several select none. A failure here is logged and never stops the bar. Without `--boot`,
`REVVIEW_START` is ignored and `--start` works as before.

`--netmon`: "online" means a default route on any interface (`/proc/net/route`, `/proc/net/ipv6_route`, so the
phone hotspot over Wi-Fi counts) plus a TCP connect to the Claude API host (`api.anthropic.com:443`; env
`REVVIEW_NETMON_HOST` = `host` or `host:port` changes it, a bad value exits with code 2). It checks every 10 s
(every 5 s while offline). Two failures in a row make the bar show OFFLINE; one success brings it back. Without
a default route nothing is sent at all. Nothing depends on Ethernet. Code: `src/server/netmon.js`.

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
`dropped` is true when the view was `starting` (presses then are dropped, not queued). `onGesture(entry)` is called
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
