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
| `--live` | No demo. The server waits for real Claude Code hook events posted to its port (the `view:` line shows it). Not together with `--demo`. |
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

With `--live` there is no demo. The bar stays on its empty state until real hook events arrive at the port.
Nothing sets those up for you on a laptop.

**Nothing is sent to a Claude, ever, in demo mode.** No real session is behind the demo, so only some keys do
anything you can see:

- **They change the screen:** Left and Right switch between the three sessions; Up and Down open the session list
  and move in it; M opens the menu (M again, or Backspace, closes it); Backspace **held** goes "home": it picks the
  session that needs you most (permission first, then waiting, then done, then working; the oldest first) and closes
  the list or menu. Backspace **tapped** only does something inside the list or the menu (it steps back); on the
  plain bar it does nothing.
- **They do nothing you can see:** on the permission scene Enter (allow), N (deny) and Esc (cancel, Esc held = Ctrl+C),
  and on the done scene Space (talk) and R (read aloud). The bar logs the gesture (the server's `GET /buttons` lists
  them), but nothing on the screen changes. To see them take effect you need a real Claude Code session: `--live`,
  and hook events from it, which this guide does not set up.
- **In the menu** of the demo, "New session" shows "No projects: add paths to the projects file", and Projects and
  Settings lead nowhere useful: there are no projects configured and nothing to start. Enter picks a row in the
  session list, which is useful.
- **Read aloud** (R) speaks on any machine that has espeak-ng or Piper installed, with no setting: the server reads
  `config/speech.json` by default. Without either, it does nothing. `run.sh` installs nothing.

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
Enter, N, Esc, Space, R on a permission or done screen only log the gesture: no
real session is behind them (needs --live). Nothing is sent to a Claude.
R speaks on any machine that has espeak-ng or Piper installed.
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

`--stop` stops EVERY `run.sh` of yours that is running (they may have different ports): it reads only plain files of
yours in those directories, and sends TERM to a pid only when that process still has the start time in the file, so
a pid that was reused by something else is never signalled (the stale file is just removed). The script then stops
the browser, the demo player and the server and removes its temp files; `--stop` waits up to 5 seconds for each.
It works from any directory, however `run.sh` was started.

## How it differs from the Pi

- **Keys instead of wheel buttons.** The Pi reads real buttons from a device (`config/buttons.json`). The laptop
  uses `config/buttons.laptop.json`, a keyboard map read through the page ("dev bridge", loopback only).
- **No device grab.** The laptop map has `grab: false` and nothing opens `/dev/input`. Your keyboard keeps working
  everywhere else. On the Pi the buttons are grabbed so they do not type into anything.
- **The fonts of your machine.** The Pi's fonts may look and measure differently. This does not show how the panel
  looks, its brightness or daylight; those are Pi bench tests. The 1280x400 window is not the panel's physical
  size either (`emulator/README.md`, "Developer page", shows that).
- **It is a browser window, not the kiosk.** There is no autostart, no rotation, no read-only root, no data lock
  that is real, and no Claude Code session that revview started. Offline and insert-key are scenes of the demo,
  not real network or key-stick checks.
- **Demo data is recorded data.** In `--live` mode the hooks of a real Claude Code can post to the port; setting
  that up is not covered here.
- **Speech** needs espeak-ng or Piper installed by you (no setting; the server reads `config/speech.json`).

## Troubleshooting

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
laptop 1, 2 and 3"), `docs/BENCH-TEST.md` (L1-L6).
