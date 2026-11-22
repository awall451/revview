# Sessions

revview's own Claude Code sessions, run in a PRIVATE tmux server (`tmux -L revview`), one window per session.
Design: `docs/BUTTONS.md` section 3. The wheel buttons type keys into the selected session only.
The selection lives on the board (`board.selected`, `selectedKey(board)`): the runner remembers nothing.

## API (`runner.js`)

`createSessionRunner({ tmux, socket, claude, exec, newId, log })`

- `start({ cwd, name })` runs `[...claude, '--session-id', id]` in a new detached window (argv after `--`, no
  shell), tags it with the window option `@revview_id`, returns `{ id, window, cwd }`. It selects nothing. `cwd` and
  `name` with `#` or a control character are refused (`isUnsafeText`, exported).
- `list()` windows whose `@revview_id` is a uuid.
- `target(id)` re-verifies `id` now (looks the window up by `@revview_id`); `id` must be a uuid string, else `null`.
- `send(key, id)` key is `Escape`, `C-c` or `Space` only (else it throws). Goes only to the re-verified window of
  `id`; no valid uuid gives `{ sent: false, reason: 'no session selected' }`.
- `stop(id)`, `killServer()`.

`socket` is `{ name }` (`-L`) or `{ path }` (`-S`, for tests). Every call passes `-f /dev/null` (no user config).

## Projects (`projects.js`)

`loadProjects(file, { log })` -> `string[]` from `{"projects": ["/abs/path", ...]}` (see `config/projects.example.json`;
other keys are ignored). A missing file or malformed JSON gives `[]` and a log line: the bar still runs. At most 32
entries. An entry is kept only if it is a string of 1..4096 chars, absolute, normalized (`path.normalize(p) === p`
after one trailing `/` is stripped: no `..`, `.`, `//`) and has no `#` or control character. Refused entries are
logged with the reason. That the directory exists is `runner.start`'s check at start time. Server flag
`--projects <file>` (default env `REVVIEW_PROJECTS`).

## Actions (`actions.js`): one controller for every gesture

`createActions({ runner, registry, getBoard, apply, projects, log, clock, ctrlCGapMs, timers, navTimeoutMs, onOwnedChanged })`
-> `handle(entry)` (one gesture at a time) and `close()`. `runner` may be `null` (no `--sessions`): keys, answers and
New session are refused with reason `no sessions`; navigation still works. Only `source` `device`/`bridge` and not
`dropped` act (a dropped or posted gesture changes neither nav nor selection). The board is read at the start of each
gesture.

- **A list or menu is open (`board.nav !== null`): navigation only.** No button sends a key or answers a permission
  request. Every gesture is applied as `RevviewNav`, except press tap in the New session list: the project is
  `projects[row]` (the controller's own validated list; refused if missing or different from the board's row label),
  the list closes, `runner.start({ cwd })` runs, then the internal `RevviewSelect` makes the board select the new
  session when its first hook event arrives, and owned is refreshed. A refused start leaves the selection alone.
- **Normal view:**
  - cancel tap = Escape, cancel long-hold = one Ctrl+C (refused for 5000 ms after one was sent: two Ctrl+C in that
    window exit Claude), push-to-talk tap = Space (tap mode only), all to `selectedKey(board)` (none: refused
    `no session selected`). A sent Escape/Ctrl+C then applies the internal `RevviewInterrupted`.
  - press tap: if NEEDS PERMISSION is shown (`shownPrompt(board) !== null`) it is an allow attempt ONLY (a refusal never
    falls through to opening the list); otherwise it opens the list. deny tap is the deny attempt only.
  - allow/deny: `runner.target(selectedKey)`, then the board is read AGAIN; a list opened or a selection change during
    the await refuses (`selection changed`); then `registry.answer(kind, shownPrompt(board), id)`; on ok
    `RevviewAnswered`.
  - up, down, left, right, menu, back (tap and hold) are `RevviewNav`. read-aloud and spare do nothing.
- **Nav timeout:** after every accepted gesture, an open list/menu (re)arms ONE timer of `navTimeoutMs` (10 s) that
  applies `RevviewNav {button: 'timeout'}`; a closed one clears it.

Why a press never answers something the driver has not looked at for 1.5 s: `shownPrompt` is `null` while nav is open,
and the registry's prompt key includes the session. So a selection change, or a list that opened and closed (by hand
or by timeout), restarts the 1500 ms shown time of the prompt.

The server (`src/server/index.js`) wires it to every device/bridge gesture, `POST /permission` feeds the registry, and
applies `RevviewOwned` (from `runner.list()`) and `RevviewProjects`.

## Why targeting is safe

- The socket is private: `-L` sockets live in `/tmp/tmux-UID/` (mode 0700), so only this user reaches the server.
- tmux window ids (`@N`) are never reused within one server lifetime, so a window id cannot silently come to
  mean another window.
- A target is always a window that carries the `@revview_id` revview set. The id is re-read before each send;
  a cached window id is never trusted. The window id must match `/^@\d+$/` before it is used.
- Keys are separate argv entries from a fixed list, never `-l` text, never a shell string.
- A session revview did not start (no `@revview_id` window) is never a target: a key sends nothing to it.

## Tests

`tests/unit/sessions-runner.test.js` (fake exec, argv shapes), `tests/unit/sessions-tmux.test.js` (real tmux
on a temp socket, with the stand-in `tests/unit/fixtures/sessions/fake-claude.js` that logs received bytes),
`tests/unit/sessions-wb4.test.js` (real board and registry, fake runner/clock/timers) and `sessions-projects.test.js`.
The tmux test fails, not skips, when tmux is missing.
