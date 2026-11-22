# Sessions

revview's own Claude Code sessions, run in a PRIVATE tmux server (`tmux -L revview`), one window per session.
Design: `docs/BUTTONS.md` section 3. The wheel buttons type keys into the chosen session only.

## API (`runner.js`)

`createSessionRunner({ tmux, socket, claude, exec, newId, log })`

- `start({ cwd, name })` runs `[...claude, '--session-id', id]` in a new detached window (argv after `--`, no
  shell), tags it with the window option `@revview_id`, and makes it the chosen session.
- `list()` windows whose `@revview_id` is a uuid. `choose(id)` only for listed ids. `chosen()` is the
  remembered choice, not verified.
- `target()` re-verifies the choice now (looks the window up by `@revview_id`); gone means the choice is cleared.
- `send(key)` key is `Escape`, `C-c` or `Space` only (else it throws). Goes only to `target()`.
- `stop(id)`, `killServer()`.

`socket` is `{ name }` (`-L`) or `{ path }` (`-S`, for tests). Every call passes `-f /dev/null` (no user config).

## Why targeting is safe

- The socket is private: `-L` sockets live in `/tmp/tmux-UID/` (mode 0700), so only this user reaches the server.
- tmux window ids (`@N`) are never reused within one server lifetime, so a window id cannot silently come to
  mean another window.
- A target is always a window that carries the `@revview_id` revview set. The id is re-read before each send;
  a cached window id is never trusted. The window id must match `/^@\d+$/` before it is used.
- Keys are separate argv entries from a fixed list, never `-l` text, never a shell string.

## Tests

`tests/unit/sessions-runner.test.js` (fake exec, argv shapes) and `tests/unit/sessions-tmux.test.js` (real tmux
on a temp socket, with the stand-in `tests/unit/fixtures/sessions/fake-claude.js` that logs received bytes).
The tmux test fails, not skips, when tmux is missing.
