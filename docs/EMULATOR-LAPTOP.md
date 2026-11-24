# The emulator on your laptop

This is the guide from a fresh clone to a window with the bar in it. The bar is the 1280x400 strip that Revview
draws on the Pi's screen. On your laptop it opens in its own browser window, and your keyboard plays the wheel
buttons.

**What is proven and what is not.** `emulator/run.sh` is tested on the build VM only, with a stand-in browser and with
headless Chromium (`tests/unit/emulator-run.test.js`, `tests/unit/emulator-keys-sheet.test.js`, the Playwright
tests). Nobody has run it on a real laptop. The WSL2 parts below are written from knowledge and were **never run**:
they are marked **untested (WSL2)**. The bench items are L1-L6 in `docs/BENCH-TEST.md`.

## What you need

- `git`.
- Node 22 or newer (`node --version`).
- Chromium, Google Chrome or Microsoft Edge. `run.sh` looks for `chromium`, `chromium-browser`, `google-chrome`,
  `google-chrome-stable`, `microsoft-edge` and `microsoft-edge-stable` on your `PATH`. Firefox is not used.
- A desktop session (X11 or Wayland) to open the window in.
- **WSL2 (untested):** Windows 11 with WSLg, so a Linux browser inside WSL2 can open a window. Or no Linux browser
  at all: then `run.sh` tries Chrome or Edge installed on Windows (see "WSL2" below).

You do **not** need `npm install` or `npm ci`. The server, the demo player and the key sheet use only what comes
with Node 22 (checked: they run from a fresh clone with no `node_modules` folder). `npm ci` is only for the
developer tests (Playwright, ESLint). `run.sh` installs nothing.

## From clone to window

    git clone git@github.com:awall451/revview.git
    cd revview
    bash emulator/run.sh

If you have no SSH key set up for GitHub, clone with https instead:

    git clone https://github.com/awall451/revview.git

A window opens, with no address bar, 1280x400 pixels, showing the bar. The terminal prints a `view:` line with
the address (`http://127.0.0.1:<port>/?devkeys=1`); you can open that address in any browser too. The script keeps
running until you close the window or press Ctrl+C in the terminal.

## Options

`bash emulator/run.sh [options]` (the same list as `--help`):

| Option | What it does |
|---|---|
| `--port N` | Listen on this loopback port (default: a free one). |
| `--no-browser` | Only serve: print the address and keep serving until Ctrl+C. Open the address yourself. |
| `--scale S` | Make the window S times bigger on screen (a positive number, e.g. `1.5`). The page keeps its 1280x400 layout. |
| `--demo` | The default. Play a looping demo of the bar's states (see below). |
| `--live [DIR]` | No demo. Starts a real Claude Code session in DIR (default: the current directory), in a private tmux server of this run, and the keys act on it. Needs `tmux` and `claude` on your `PATH`. See "Live: a real Claude Code session" below. Not together with `--demo`. |
| `--keys` | Print the key cheatsheet (below) and exit. |
| `--print-aliases` | Print a block of shell aliases for your `~/.bashrc` (below) and exit. It only prints. |
| `--stop` | Stop EVERY `run.sh` of yours that is running, from another terminal. Prints `stopped (pid N)` for each, or `not running`; exits 0 either way (1 if one did not stop within 5 seconds). |
| `--help`, `-h` | The usage text and exit codes. |

Environment variables:

- `REVVIEW_BROWSER`: the path or command of the browser to use, for example
  `REVVIEW_BROWSER=/usr/bin/google-chrome-stable bash emulator/run.sh`.
- `REVVIEW_QUICK_EXIT_SECS`: a browser that exits sooner than this (default 3) is taken to have handed the address
  to a browser that was already running. The server then keeps going.
- `TMPDIR`: where the browser profile and the server log are made. They are removed when the script ends.

Exit codes: 0 after the window closed or after Ctrl+C / TERM / HUP; 1 when it could not start (Node too old, the
server did not start) or the server stopped while running; 2 for a bad option.

## What you see

By default you see the **demo**. A small player (`emulator/demo/player.js`) feeds the server the recorded Claude Code
sessions from `fixtures/sessions/`, shown as three sessions called revview, garden and notes. It loops through seven
scenes, and the terminal prints a `demo: N scene` line for each:

1. working  2. permission  3. done  4. waiting  5. offline  6. insert-key  7. ended

What each scene puts on the screen (the big state word of the bar):

| Scene | The screen shows |
|---|---|
| working | WORKING |
| permission | NEEDS PERMISSION |
| done | DONE |
| waiting | WAITING FOR ME |
| offline | OFFLINE |
| insert-key | INSERT KEY (the data is locked: insert the key stick) |
| ended | CLAUDE EXITED (no Claude Code session is running) |

The digit keys jump to a scene; P pauses; `[` and `]` slow down and speed up (the cheatsheet lists them).

With `--live` there is no demo. `run.sh` starts a real Claude Code session and the bar shows that session (see
"Live: a real Claude Code session" below). Until its first hook arrives the bar shows STARTING (the
same as a session started from the menu: at most 30 s, then UNKNOWN, "No events from this session yet", if no hook came).
If the bar stays on STARTING or falls to UNKNOWN, attach with the printed `attach:` line: Claude may be asking whether
you trust the folder (or another first-run question), and it waits for your answer there.

**Nothing is sent to a Claude, ever, in demo mode.** No real session is behind the demo, so only some keys do
anything you can see:

- **They change the screen:** Left and Right switch between the three sessions; Up and Down open the session list
  and move in it; M opens the menu (M again, or Backspace, closes it); Backspace **held** goes "home": it picks the
  session that needs you most (permission first, then waiting, then done, then working; the oldest first) and closes
  the list or menu. Backspace **tapped** only does something inside the list or the menu (it steps back); on the
  plain bar it does nothing.
- **They do nothing you can see:** on the permission scene Enter (allow), N (deny) and Esc (cancel, Esc held = Ctrl+C),
  and on the done scene Space (talk) and R (read aloud). The bar logs the gesture (the server's `GET /buttons` lists
  them), but nothing on the screen changes. To see them take effect you need a real Claude Code session: run with
  `--live` (below), where they are sent to it.
- **In the menu** of the demo, "New session" shows "No projects: add paths to the projects file", and Projects and
  Settings lead nowhere useful: there are no projects configured and nothing to start. Enter picks a row in the
  session list, which is useful.
- **Read aloud** (R) needs two things. A session must have been chosen first with Left/Right: before that the server
  says "no session selected" and nothing is spoken. And a speech engine must be installed by you, with no setting:
  the server reads `config/speech.json` by default, which uses Piper only when it is at `/opt/piper/piper` with the
  lessac voice and `aplay` exists, else espeak-ng. Without an engine it does nothing. `run.sh` installs nothing.

## The keys

`bash emulator/run.sh --keys` prints this sheet. It is generated from `config/buttons.laptop.json` (which key is which
button, which buttons have a hold or a long hold) and from the demo scenes, so it cannot list a key that is not
mapped. Click the window first so it gets the keys.

```
Click the window first. Tap = press and release; hold = 0.4 s, long hold = 1 s.
KEY       BUTTON        TAP             HOLD         LONG HOLD
Up        up            list / up
Down      down          list / down
Left      left          prev session
Right     right         next session
Enter     press         allow / choose
Backspace back          back            home
Space     push-to-talk  talk
R         read-aloud    read aloud      stop speech
Esc       cancel        Esc to Claude                Ctrl+C
N         deny          deny
M         menu          menu

Demo keys (demo mode only; the demo player takes them, not the bar):
  1-7  jump: working, permission, done, waiting, offline, insert-key, ended
  P  pause / continue          [  slower          ]  faster
In the demo these change the screen: Left, Right, Up, Down, M, Backspace held
(go to the session that needs you most). Enter picks a row in a list or menu.
Enter, N, Esc, Space on a permission or done screen only log the gesture
in the demo: nothing is sent to a Claude. With --live they go to the run's
own Claude: Enter allows a shown permission, N denies, Esc and Space are sent.
R reads aloud only after Left/Right has chosen a session, and only with
espeak-ng, or Piper installed as config/speech.json says.
```

## Shortcuts for your shell

`bash emulator/run.sh --print-aliases` prints a block with the real path of your clone filled in. It does not edit
any file. Paste it into `~/.bashrc` yourself. With the clone in `~/revview` it looks like this (yours shows the
full absolute path, quoted if it has spaces):

```
# revview emulator
alias revview='bash ~/revview/emulator/run.sh'
alias revview-keys='bash ~/revview/emulator/run.sh --keys'
alias revview-stop='bash ~/revview/emulator/run.sh --stop'
```

Open a new terminal (or `source ~/.bashrc`), then `revview` starts the window, `revview-keys` shows the sheet,
and `revview-stop` stops a running one from another terminal.

How `--stop` works: a running `run.sh` writes its pid and its process start time to `<pid>.pid` in a private
directory of yours (mode 700): `$XDG_RUNTIME_DIR/revview-emu` when that variable names a writable directory, else
`${TMPDIR:-/tmp}/revview-emu-<uid>`, else `/tmp/revview-emu-<uid>`. A directory that is a symlink, not yours, or open
to others is not used. If none can be had, `run.sh` says `run.sh: no pid file; --stop will not find this run` and
keeps running (stop it with Ctrl+C in its terminal). The file is removed when the script ends.

With `--live`, `run.sh` can return up to about a second before its Claude process has ended (QA round 10 saw 0.5 to
0.7 s). If you check for leftovers with `ps`, wait a second first, then look. A `claude` still listed right after the
stop is not a leak.

`--stop` stops EVERY `run.sh` of yours that is running (they may have different ports). It looks in ALL of
`$XDG_RUNTIME_DIR/revview-emu` (when set), `/run/user/<uid>/revview-emu`, `${TMPDIR:-/tmp}/revview-emu-<uid>` and
`/tmp/revview-emu-<uid>`, so it finds a run started in another shell (a desktop terminal and an ssh or WSL shell
differ in `XDG_RUNTIME_DIR` and maybe `TMPDIR`). It reads only plain files of yours in those directories (each
directory under the same checks as above), skips a file with a nonsense pid (0, 1, negative, a leading zero) and
removes it, and sends TERM to a pid only when that process still has the start time in the file, so
a pid that was reused by something else is never signalled (the stale file is just removed). The script then stops
the browser, the demo player and the server and removes its temp files; `--stop` waits up to 5 seconds for each. If one does not stop it says so, goes on with the others and exits 1 at
the end.
It works from any directory, however `run.sh` was started.

## Live: a real Claude Code session

**Nothing of this has been run on a laptop.** It is tested with a stand-in `claude` (a small script) on the build VM.
QA round 10 also ran it on the build VM with a real, signed-in Claude Code 2.1.331 (it started as 2.1.330 and updated
itself), with the page in a headless browser, not a real window. Treat it as untested on a laptop until the bench items
in `docs/BENCH-TEST.md` ("Emulator on your laptop 4") are done.

What you need, besides the list at the top: `tmux`, and Claude Code (`claude`) installed and signed in. `run.sh --live`
checks both are on your `PATH` before it starts anything; if one is missing it says which and exits 1.

```
bash emulator/run.sh --live              # a session in the current directory
bash emulator/run.sh --live ~/some/project
```

What it does:

- Picks a free loopback port (or your `--port`) before anything starts, so the hooks know where to post.
- Writes a settings file with revview's hooks (made by `hooks/install.mjs --settings <file>`) in the run's own private
  temp directory (mode 700, removed when the run ends).
- Starts the server with the sessions runner, which runs plain interactive `claude --settings <that file> --session-id
  <uuid>` in DIR, inside a private tmux server whose socket is `<temp dir>/tmux.sock`. It is not your default tmux
  server and not the Pi's `-L revview` one. `REVVIEW_PORT` is set for the server, so tmux, Claude and the hooks inherit it.
- Prints the line to look at and type in the session:

```
attach: tmux -S <socket> attach -t revview
```

Run that in another terminal and you are in the Claude session: type to it as usual, detach with Ctrl-b d (that leaves
it running). If you are already inside tmux, run it outside tmux, or prefix it with `TMUX=`.

**A folder Claude has not opened before.** Claude Code may ask "Is this a project you created or one you trust?" in the
tmux window and wait. No hook fires until you answer, so the bar shows STARTING and after 30 s UNKNOWN. Attach with the
`attach:` line and answer there (the highlighted default is "No, exit", which ends Claude). `run.sh` does not answer it
for you. Another first-run question looks the same.

**The keys act on that session.** Enter (a tap) answers a shown permission prompt with allow, N denies it, Esc sends
Escape to Claude (held long: Ctrl+C), and Space (push-to-talk) sends its key to Claude. Whether voice input works
depends on Claude Code and a microphone; this is unproven. Up, Down, Left, Right, M, Backspace and R work as on the
Pi. In demo mode nothing is sent to a Claude.

**Permission prompts depend on Claude's permission mode.** There is a prompt for Enter and N only when Claude asks. In
QA round 10, Claude Code 2.1.330/2.1.331 on the build VM started in "auto mode" (footer "auto mode on (shift+tab to
cycle)"), and Write, `cat`, `echo` and `date` ran with no prompt and no NEEDS PERMISSION. After one Shift+Tab in the
attached window the footer said "manual mode on" and the same kind of command showed NEEDS PERMISSION. QA saw the cycle
auto, manual, accept edits, plan, auto. Which mode your own Claude starts in is not known here: to try Enter and N,
attach and press Shift+Tab until the footer says "manual mode".

**"Too early: press again".** A button answers a permission prompt only after the bar has shown it for 1.5 seconds
(and 1.5 seconds after Left or Right switched to it), so a tap that comes sooner does nothing to Claude and the bar says
`Too early: press again`. It is not a lost key: wait a moment and press again.

**New session.** Menu (M), Enter on New session, Enter on a row starts a second real Claude session in that folder, in
the same private tmux server and with the same settings file; Left and Right then switch between the sessions. The
rows come from a projects file: `run.sh --live` writes one in the run's temp directory that holds just DIR. To offer
other folders, make your own file and give it as `REVVIEW_PROJECTS=<file>`; it is then used instead:

```
{ "projects": ["/home/me/one", "/home/me/two"] }
```

(absolute paths, no `#`, up to 32). Example: `REVVIEW_PROJECTS=~/projects.json bash emulator/run.sh --live ~/one`.
If you set your own list and want DIR in it, put DIR in the file too.
DIR itself must not contain `#` or a control character (the server refuses such a folder): `run.sh` says so and exits 2
before it starts anything.

**Stopping.** Closing the window, Ctrl+C, TERM or HUP on `run.sh`, or `run.sh --stop` from another terminal stop the
server and kill exactly that private tmux server, so the Claude in it ends. Nothing else is touched (your own tmux
sessions stay). `--stop` only looks under the `TMPDIR` (and `XDG_RUNTIME_DIR`) of the shell you run it from: if the run
was started with another `TMPDIR`, it says `not running` (and, on stderr, where it looked) while the run, its tmux server
and your Claude are still alive. Run `--stop` with the same `TMPDIR` as the run.

**Isolation, and what it does not do.**

- `run.sh` does not write `$HOME/.claude`, `~/.claude.json` or any project's `.claude/settings*.json`. The hooks come
  only from the per-run settings file passed with `--settings`.
- `--settings` ADDS to your own settings: your user and project settings, and their hooks, still load. If you once
  installed revview's hooks globally with `hooks/install.mjs`, each hook would post twice (once from there, once from
  the run's file). Remove the global ones, or expect doubled events.
- Claude Code itself still keeps its usual files (session history, `~/.claude.json`) as in any `claude` run. `run.sh`
  only guarantees it does not write them itself.
- The Claude session runs with your account and can use tools in DIR like any Claude session: pick DIR with that in mind.

## How it differs from the Pi

- **Keys instead of wheel buttons.** The Pi reads real buttons from a device (`config/buttons.json`). The laptop
  uses `config/buttons.laptop.json`, a keyboard map read through the page ("dev bridge", loopback only).
- **No device grab.** The laptop map has `grab: false` and nothing opens `/dev/input`. Your keyboard keeps working
  everywhere else. On the Pi the buttons are grabbed so they do not type into anything.
- **The fonts of your machine.** The Pi's fonts may look and measure differently. This does not show how the panel
  looks, its brightness or daylight; those are Pi bench tests. The 1280x400 window is not the panel's physical
  size either (`emulator/README.md`, "Developer page", shows that).
- **It is a browser window, not the kiosk.** There is no autostart, no rotation, no read-only root, no data lock
  that is real, and (in demo mode) no Claude Code session that revview started. Offline and insert-key are scenes of the demo,
  not real network or key-stick checks.
- **Demo data is recorded data.** In `--live` mode the bar shows a real Claude Code session that `run.sh` started
  (below); the Pi's own services and its tmux server are not involved.
- **Speech** needs espeak-ng, or Piper installed as `config/speech.json` says, installed by you (no setting).

## Troubleshooting

**`--stop` says "not running" but the bar is still being served.** If `run.sh` itself was killed with `kill -9` (or
its terminal was closed in a way that sends KILL), it could not stop what it started: the server and the demo
player keep running, and `--stop` has no pid file for them any more. List them with
`pgrep -u "$(id -u)" -af 'src/server/index.js.*--dev-bridge|emulator/demo/player.js'` and stop the ones shown
(`kill <pid> <pid>`; if no other emulator of yours is running, `pkill -u "$(id -u)" -f` with the same pattern does it).
The temp directory `revview-emu.XXXXXX` in your `TMPDIR` (or `/tmp`) was not removed either; delete it by hand.

**`--live` says `tmux` or `claude` was not found.** Install it, or put its folder on the `PATH` of the shell you run
`run.sh` from. Nothing was started; the exit code is 1.

**`--live` says `Claude exited at once` or `Claude exited within 10 s of starting`.** `claude` started and ended within
a moment (the first before the page was up, the second in the first 10 s after), so there is no session (exit 1,
everything cleaned up). Ending the only Claude yourself in the first 10 s is reported the same way. A Claude that you end
yourself later is not an error: the run goes on as it did before. This is for a Claude that really ends. Seen on the
build VM (QA round 10): answering the folder-trust question with its default "No, exit". Not tried: a first run that
quits. A Claude that is not signed in did not end there: it stayed up, the bar showed WAITING FOR ME and, after the first
prompt, "Turn failed: authentication failed" ("Not logged in"); a brand-new install that never finished onboarding was
not tried. Its own message is gone with the tmux window, so run `claude` once in a normal terminal, answer whatever it
asks (trust the folder, sign in), leave it, and run `run.sh --live` again.

**The bar stays on STARTING, then UNKNOWN, and nothing happens.** Claude is probably waiting for an answer (trust this
folder?) in the tmux window: attach with the printed `attach:` line and answer there.

**`--live` says DIR must not contain `#`.** The server refuses a folder with `#` or a control character in its path
(exit 2, nothing started). Use another folder, or a link to it without those characters (the current directory counts
too).

**`--live` says the tmux socket path is too long.** A unix socket path is limited to about 107 bytes; use a shorter `TMPDIR` (for example `TMPDIR=/tmp`). Nothing was started.

**A tmux server is left after `kill -9` of `run.sh`.** Like the case above, a KILL gives `run.sh` no chance to clean
up: the private tmux server (and the Claude in it) and the server can stay. Use the socket path that was printed in
the `attach:` line: `tmux -S <socket> kill-server`. Or find them with `ps -u "$(id -u)" -o pid,args | grep -E
'tmux .*revview-emu\.|src/server/index.js'` and stop them (the private tmux server's command line is
`tmux -f /dev/null -S <socket> ...`, so `tmux -S` alone would not match). The run's temp directory (it holds the socket) is left too; delete it by hand.

**Port busy.** Without `--port` a free port is chosen, so this should not happen. With `--port N` and N in use,
the server cannot start: `run.sh` prints `the server stopped while starting` with the last lines of the server log
and exits 1. Pick another port, or leave `--port` out.

**No browser found.** `run.sh` prints `no browser found (set REVVIEW_BROWSER, or install Chromium, Chrome or Edge)`
and the `view:` line, and keeps serving. Open that address in a browser yourself, or set `REVVIEW_BROWSER` to the
browser's path. A snap or Flatpak browser may need its full command in `REVVIEW_BROWSER`; this was not tried.

**The window did not appear and the script says the browser exited at once.** Chrome or Chromium probably handed
the address to a window that was already open. Look for the new window, or close that browser and run again.

**Node too old.** `run.sh: found Node v20.x, but Node 22 or newer is needed.` (exit 1), or `node not found`. Install
Node 22 or newer and put it on your `PATH` (for example with your distribution's packages or `nvm`).

**The window is not 1280x400 (tiling window managers).** `run.sh` asks for a 1280x400 window (`--window-size`).
A tiling window manager such as i3 or sway ignores that and fits the window to a tile, so the bar can look
cut off or scaled. Make the window floating in your window manager's rules, or use another desktop for this.
This is from knowledge, not tried.

**Keys do nothing.** Click inside the window first. The page must have focus. If you opened the `view:` address in
an ordinary browser tab, it must be the address with `?devkeys=1`.

## WSL2 (untested)

Everything in this section is **untested (WSL2)**: it was written from knowledge and never run on a real WSL2.

- **WSLg with a Linux browser.** Install Chromium or Chrome inside WSL2 and run `bash emulator/run.sh`. WSLg should
  open the window on the Windows desktop, and `127.0.0.1` inside WSL2 is where the server listens.
- **A browser on Windows.** If no Linux browser is found, or there is no `DISPLAY` / `WAYLAND_DISPLAY`, `run.sh`
  looks for Chrome or Edge under `/mnt/c/Program Files...` and starts it with the address `http://localhost:<port>/`.
  For that to work Windows must forward `localhost` to WSL2, which recent WSL versions do for a server on
  `127.0.0.1`, but this was not checked. The browser profile is made in the Windows `%TEMP%` and removed at the end.
  If the page does not load, copy the `view:` address into a Windows browser, or set `REVVIEW_BROWSER` to the
  browser's path under `/mnt/c/...`.
- **Closing the window.** For a Windows browser, whether closing the window ends the script (and removes the profile)
  is not known. `revview-stop` in a second WSL terminal is the way to be sure.
- WSL2's network mode ("NAT" or "mirrored") may change what `localhost` means for a Windows browser. If the
  page does not load, run with `--no-browser` and open the address by hand.

Bench item L6 in `docs/BENCH-TEST.md` asks someone to run this and write down what really happened.

## More

`emulator/README.md` (the panel emulator, the developer page at physical size), `docs/DECISIONS.md` ("Emulator on your
laptop 1, 2, 3 and 4"), `docs/BENCH-TEST.md` (L1-L6, and the live items of "Emulator on your laptop 4").
