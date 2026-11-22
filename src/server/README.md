# Live server

`src/server/index.js` receives Claude Code hook events, runs them through the pure state core
(`src/state`), and pushes the resulting state to the page over Server-Sent Events. It also serves the
view (`src/view/`). Node standard library only. It holds one **board** (`initialBoard()`, one entry per Claude
session, see `src/state/README.md`), reduces every event with `reduceBoard` and sends `boardView(board)` to the page.
No persistence: a fresh or restarted server shows `unknown` (a restored state could not be trusted, and hooks
posted while the server was down are lost).

Run: `npm start` or `node src/server/index.js [port]` (default **8138**, or env `REVVIEW_PORT`).
It binds to **127.0.0.1 only**; there is deliberately no way to change the host from the CLI.
Open `http://127.0.0.1:8138/`.

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

## Security notes

- Loopback only, so nothing on the network can reach it.
- Any request with an `Origin` header that is not `http://127.0.0.1:<port>` or `http://localhost:<port>`
  gets 403, so a web page open in the browser cannot POST events. curl sends no `Origin` and is allowed.
- Any request whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` gets 403 (DNS rebinding).
- Stream errors and bad requests never crash the process; a throwing reducer answers 500 and leaves `seq` and the state unchanged.
- At most **8** SSE clients (`MAX_SSE_CLIENTS`); the ninth `GET /events` gets 503. A client whose unread backlog
  passes 256 KiB (it never reads) is dropped.

Programmatic use (tests): `startLiveServer({ port: 0, viewDir, reduce })` (`reduce` is a test seam for a failing state core; there is no host option) resolves to
`{ url, port, close(), state() }` (`reduce` is `(board, event) => board`, default `reduceBoard`; `state()` returns `boardView(board)`).
