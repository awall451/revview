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
- `send(key, id)` key is `Escape`, `C-c`, `Space` or `2` (plan approval, "2. Yes, manually approve edits") only (else it throws). Goes only to the re-verified window of
  `id`; no valid uuid gives `{ sent: false, reason: 'no session selected' }`.
- `capture(id, maxLines = 40)` the visible screen of the re-verified window (`capture-pane -p -J`, cleaned):
  `{ ok: true, lines }` or `{ ok: false, reason: 'no session selected' | 'selected session gone' | 'capture failed' }`.
- `stop(id)`, `killServer()`.
- `reap({ maxLines = 20 })` why a session ended. Every window is created with tmux `remain-on-exit on` (set in the
  same tmux command line as the window, so a Claude that dies at once is still kept). `reap` finds the windows whose
  Claude has exited (`pane_dead`), reads their last lines (`capture-pane -p -J -S -100`), kills the window (none piles
  up) and returns `[{ id, name, status, lines }]`; `lines` are at most 20, ANSI escapes and control characters removed
  (`cleanScreen`), tmux's own "Pane is dead" line dropped. `list()` does not list a dead window. A window `stop(id)`
  kills while it lives is never reaped, so a session stopped on purpose leaves no reason and no alarming note.

**The journal holds screen lines.** The server calls `reap` on every owned poll (5 s): for each ended session it logs
one header line (id, name, exit status) and at most 20 screen lines (`  | <line>`) to stderr, which is the journal under
the systemd user unit. That text is whatever Claude last showed (untrusted, and it can include file names or parts of
a conversation); keep it in mind when sharing a journal. The bar gets only the last non-empty line, as the note
"Session ended: <line>" (cut at 80 characters, control characters removed, no screen: "Session ended: no output");
the view sets it as text (`textContent`). The board keeps the reasons of at most 8 sessions.

`socket` is `{ name }` (`-L`) or `{ path }` (`-S`, for tests). Every call passes `-f /dev/null` (no user config).

## Projects (`projects.js`)

`loadProjects(file, { log })` -> `string[]` from `{"projects": ["/abs/path", ...]}` (see `config/projects.example.json`;
other keys are ignored). A missing file or malformed JSON gives `[]` and a log line: the bar still runs. At most 32
entries. An entry is kept only if it is a string of 1..4096 chars, absolute, normalized (`path.normalize(p) === p`
after one trailing `/` is stripped: no `..`, `.`, `//`) and has no `#` or control character. Refused entries are
logged with the reason. That the directory exists is `runner.start`'s check at start time. Server flag
`--projects <file>` (default env `REVVIEW_PROJECTS`).

## Actions (`actions.js`): one controller for every gesture

`createActions({ runner, registry, readAloud, getBoard, apply, projects, log, clock, ctrlCGapMs, timers, navTimeoutMs, onOwnedChanged })`
-> `handle(entry)` (one gesture at a time) and `close()`. `runner` may be `null` (no `--sessions`): keys, answers and
New session are refused with reason `no sessions`; navigation still works. Only `source` `device`/`bridge` and not
`dropped` act (a dropped or posted gesture changes neither nav nor selection). The board is read at the start of each
gesture.

- **A list or menu is open (`board.nav !== null`): navigation only.** No button sends a key or answers a permission
  request. Every gesture is applied as `RevviewNav`, except press tap in the New session list: the project is
  `projects[row]` (the controller's own validated list; refused if missing or different from the board's row label),
  the list closes, `runner.start({ cwd })` runs, then owned is refreshed (the new window goes on the board as a quiet
  placeholder) and the internal `RevviewSelect` selects it at once. A refused or failed start leaves the selection alone and sets
  a fixed board note ('project folder missing', 'see the server log' or 'no such project'), never the error text. A press/deny refused as `too-early` (the prompt is the one on the bar but has been shown under 1.5 s; the registry's reason, distinct from `not-shown-long-enough`, which is nothing shown, or a different prompt shown) sets the note 'Too early: press again'; no other refusal says anything. The allow rule is unchanged: a press answers only a request shown for at least 1500 ms, so a second fast press is refused again. The note is cleared by a `RevviewAnswered`, a button gesture, a selection change, or when the prompt the bar shows changes (the reducer compares it); it has no timer, so it stays while the same prompt stays shown.
- **Normal view:**
  - cancel tap = Escape, cancel long-hold = one Ctrl+C (refused for 5000 ms after one was sent: two Ctrl+C in that
    window exit Claude), push-to-talk tap = Space (tap mode only; refused with the note "Claude is still starting: push-to-talk not sent", reason `session starting`, no key sent, while the SELECTED session would show STARTING (the boot, or a session revview just started that has sent no hook yet); not refused with no selection, nor while the data is locked), all to `selectedKey(board)` (none: refused
    `no session selected`). A sent Escape/Ctrl+C then applies the internal `RevviewInterrupted`.
  - press tap: if NEEDS PERMISSION is shown (`shownPrompt(board) !== null`) it is an allow attempt ONLY (a refusal never
    falls through to opening the list); otherwise it opens the list. deny tap is the deny attempt only.
  - allow/deny: `runner.target(selectedKey)`, then the board is read AGAIN; a list opened or a selection change during
    the await refuses (`selection changed`); then `registry.answer(kind, shownPrompt(board), id)`; on ok
    `RevviewAnswered`.
  - **CLAUDE ASKS** (`boardView(b).view === 'asking'`, no list open; `shownAsk(board)` says what answers it). up/down move
    the highlighted choice (`RevviewNav`). The server's feed observes the shown ask for the registry's "shown long enough"
    clock (`observe(shownPrompt ?? shownAsk)`). Never a key for a question; only `2` for a plan.
    - press tap: `answer: 'terminal'` -> note 'Answer in the terminal when parked' (kind `terminal`), refused `answer in terminal`;
      `'pick'` -> `answerAsk('allow')`: `before = shownAsk(board)` at dispatch, `runner.target(id)` (null: note 'Not sent: not a
      session revview started'), then the board is read AGAIN: a list open, another selection, or a shownAsk that is not the
      same (session, agent, since, choice) refuses with 'Not sent: the question changed'. Then
      `registry.answer('allow', shown, id, { choice, label: ask.options[choice] })`; on ok `RevviewAnswered` (allow).
      `'plan'` -> `approvePlan()`: the same pre-checks, `registry.check(shown, id)`, `runner.capture(id)` must show a line
      with 'Would you like to proceed?' and the lines '2. Yes, manually approve edits' and '3. Tell Claude what to change'
      (fixtures/answers/pane-10-plan.txt; else note 'Not sent: the terminal does not show the plan'), the board is
      re-checked once more, and only then `runner.send('2', id)`; on sent `RevviewAnswered` (allow). The held hook request
      is not answered (a hook allow does not approve a plan in Claude Code 2.1.332; Claude ends the hook, the route's close
      handler removes it).
    - deny tap: a plan -> `answerAsk('deny', { plan: true })`; a pick or terminal question -> `answerAsk('deny')` (a hook
      deny cancels the whole call).
    - Refusal notes (kind 'ask', except too-early and the terminal texts, which are kind 'terminal'): `too-early` -> 'Too early: press again' (kind too-early);
      `not-shown-long-enough`, `label-changed` -> 'Not sent: the question changed'; `no-request` -> 'Not sent: the question
      is not waiting any more'; every other reason (unbound, ambiguous, no-input, not-one-question, multi-select, choice,
      needs-choice, session) -> 'Answer in the terminal when parked' ('Approve in the terminal when parked' for a plan).
      Every refusal is `done: false` with the reason. Push-to-talk stays refused.
  - up, down, left, right, menu, back (tap and hold) are `RevviewNav`. spare does nothing. A `menu` hold (400 ms; the shipped maps give `menu` a hold, so its tap fires on release) is the look toggle: the board flips day/night, nothing is sent, no note, and no list or menu opens, closes or moves (the nav timer is re-armed as for any gesture).
  - **read-aloud tap** speaks for `selectedKey(board)` through the `readAloud` object (`src/speech`); none selected:
    refused. **read-aloud hold or long-hold** stops speech, also with a list open. With no speech engine a tap puts the
    fixed note "Read aloud: no speech engine installed". Read aloud never sends a key and never answers a prompt.
  - **push-to-talk (any gesture)** awaits the speech stop BEFORE the Space key is sent, so the microphone does not
    hear the speaker.
- **Nav timeout:** after every accepted gesture, an open list/menu (re)arms ONE timer of `navTimeoutMs` (10 s) that
  applies `RevviewNav {button: 'timeout'}`; a closed one clears it.

Why a press never answers something the driver has not looked at for 1.5 s: `shownPrompt` is `null` while nav is open,
and the registry's prompt key includes the session. So a selection change, or a list that opened and closed (by hand
or by timeout), restarts the 1500 ms shown time of the prompt.

The server (`src/server/index.js`) wires it to every device/bridge gesture, `POST /permission` feeds the registry, and
applies `RevviewOwned` (from `runner.list()`; also at once when a key send fails with 'selected session gone') and `RevviewProjects`.

Read aloud is described in `src/speech/README.md`. It is tested with a stand-in engine only; nothing was heard.

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
`tests/unit/sessions-selection.test.js` (real board and registry, fake runner/clock/timers) and `sessions-projects.test.js`.
The tmux test fails, not skips, when tmux is missing.
