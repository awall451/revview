---
status: closed
resolution: owned windows are on the board at once as quiet placeholders (RevviewOwned), so a restart selects a real target
id: qa-20261122-r4-01
title: After a server restart the running revview sessions are invisible and unreachable; the log says one is "selected" but push-to-talk goes nowhere
severity: major
area: sessions / board selection (boot path, `want`)
how to reproduce: see Steps (dev server, real tmux on a private TMUX_TMPDIR, stand-in claude)
evidence: /tmp/qa-wb4-shots/s9-01-after-restart-4-owned.png, /tmp/qa-wb4-shots/s9-02-list-after-restart.png, /tmp/qa-wb4-shots/s9-03-settings-after-restart.png, /tmp/qa-wb4-shots/s10-01-restart-one-owned.png
---

## Steps

Branch `work/wb4-selected` (2d9178e). A stand-in `claude` first on PATH (logs argv and received bytes),
`TMUX_TMPDIR` set to a private dir so `-L revview` is isolated. Driver scripts: `/tmp/qa-wb4-shots/scripts/`.

1. `node src/server/index.js 8140 --dev-bridge --start <dirA> --start <dirB> --projects <file>`; post hook events
   for both; start two more sessions with menu > New session. 4 windows in `tmux -L revview` with `@revview_id`.
2. Leave the sessions idle (Stop already posted: they are waiting for the driver). Stop the server (SIGTERM) and
   start it again with `--sessions` (the README: "sessions outlive a restart").
3. Open `/?devkeys=1`, press F21 (press), F23 (menu) > Settings, F20 (right), F13 (push-to-talk).
4. Repeat with only ONE window left (`kill-window` the other three), restart: the server prints
   `sessions: private tmux server (-L revview), selected: 2a977df0-...`. Tap F13.

## What I saw

- Four running revview sessions; the bar shows UNKNOWN with a crossed mic and "Push-to-talk goes nowhere: no session
  chosen". The list says "No sessions". Settings says "Sessions: 0 on the bar, 4 started by revview". Left/right and
  home do nothing.
- One window case: the server log says `selected: 2a977df0-...`, but `/state` has `voice: none`, the bar shows
  the same UNKNOWN look, and push-to-talk logs `action push-to-talk: not done (no session selected)`; the stand-in got
  no Space.

The selection is only a `want` until the session's next hook event, and a session that is waiting for the driver
sends no hook event until the driver speaks to it. So the driver cannot talk to any of the sessions that survived
the restart: a deadlock that only a keyboard at the Pi breaks.

## What I expected

Windows in `owned` that are not on the board should be listed and selectable (at least by left/right and in the
list, shown as "state not known"), and the single surviving session should really be selected so push-to-talk
reaches it. The boot log should not say "selected" when it is only wanted.

The README line "else exactly one existing revview session is selected" (src/server/README.md) is not what
happens for a driver. Neither the emulator tests nor `docs/BENCH-TEST.md` cover "revview restarts while its sessions
keep running" (bench item 21 is about the page only).
