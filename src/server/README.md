# Live server

`src/server/index.js` receives Claude Code hook events, runs them through the pure state core
(`src/state`), and pushes the resulting state to the page over Server-Sent Events. It also serves the
view (`src/view/`). Node standard library only; no persistence (state starts as `initialState()`, view
`starting`).

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
| 204 | accepted: `seq += 1`, state reduced, message sent to every SSE client (even if the state did not change) |
| 400 | empty body, malformed JSON, or JSON that is not a plain object; state unchanged |
| 403 | bad `Origin` or `Host` header |
| 405 | wrong method for a known path |
| 413 | body larger than `MAX_BODY_BYTES` (1 MiB = 1048576 bytes); not buffered, connection closed |

## GET /events (SSE)

Headers: `content-type: text/event-stream`, `cache-control: no-store`. The stream starts with
`retry: 1000`, then immediately the current state, then one message per accepted POST:

    retry: 1000

    data: {"seq":3,"state":{...}}

A comment `: ping` is sent every 15 s to detect dead sockets. `seq` counts accepted events since the
server started.

## Other paths

- `GET /state`: `{"seq":n,"state":{...}}` (debugging, tests).
- `GET`/`HEAD` of any other path: static file from the view dir (`/` is `index.html`), `cache-control: no-store`,
  404 if missing, path traversal refused (403/404).
- Any other method on a known path: 405. Unknown API paths: 404.

## Security notes

- Loopback only, so nothing on the network can reach it.
- Any request with an `Origin` header that is not `http://127.0.0.1:<port>` or `http://localhost:<port>`
  gets 403, so a web page open in the browser cannot POST events. curl sends no `Origin` and is allowed.
- Any request whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` gets 403 (DNS rebinding).
- Stream errors and bad requests never crash the process; a throwing reducer leaves the state unchanged.

Programmatic use (tests): `startLiveServer({ port: 0, host, viewDir })` resolves to
`{ url, port, close(), state() }`.
