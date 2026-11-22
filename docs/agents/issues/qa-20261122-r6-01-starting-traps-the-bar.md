---
id: qa-20261122-r6-01
title: With --boot and no key-on session (REVVIEW_START unset, wrong, or claude fails) the bar stays STARTING forever and drops every button, so the menu can never start a session
severity: major
area: server --boot / board `starting` (gestures dropped) / pi/README step 8, DECISIONS "stage 4A"
how to reproduce: no `revview` tmux windows; `node src/server/index.js 8320 --dev-bridge --sessions --boot` with REVVIEW_START unset, or `REVVIEW_START=/tmp/qa6-run/repos/does-not-exist`, or `relative/dir`, or with a `claude` on PATH that exits 1 at once; then tap menu, press and up (F23, F21, F17 through /?devkeys=1)
evidence: /tmp/qa6-shots/r6-01-start-missing.png, /tmp/qa6-shots/r6-05-starting-20s.png; GET /buttons and the server log (below)
---

## Steps

1. No revview tmux server (what a power cut leaves). Start the server as the Pi unit does (`--sessions --boot`, here
   plus `--dev-bridge`), with each of these, one at a time:
   - `REVVIEW_START` unset (this is the installed default: `/etc/revview/server.env` has it commented out);
   - `REVVIEW_START=/tmp/qa6-run/repos/does-not-exist` (a typo, or a repo moved);
   - `REVVIEW_START=relative/dir`;
   - `REVVIEW_START` valid, but `claude` on PATH exits 1 at once (e.g. not signed in).
2. Open the page, tap menu, press, up. Wait 20 s.

## Expected

pi/README step 8: "Without it, start one from the bar's menu (New session) once you are parked." DECISIONS "stage
4A": "Without `REVVIEW_START` and with no surviving window the bar says STARTING until the driver starts a session."
So the menu should open, or at least the bar should say what is wrong and what to do.

## Seen

All four cases: `/state` `view: starting`, `voice: no-session`, for as long as I watched (20 s+, nothing changes it).
The bar: STARTING, crossed mic, "Not ready for voice yet". Every tap is dropped:

    GET /buttons: {"button":"menu",...,"dropped":true},{"button":"press",...,"dropped":true},{"button":"up",...,"dropped":true}
    server log:   action ignored: not done (dropped)   (x3)

Log lines for the failing cases: `boot sessions: cwd is not an existing directory: /tmp/qa6-run/repos/does-not-exist`;
for the failing claude `boot sessions: Command failed: tmux ... set-option -w -t @0 @revview_id ...` then
`no server running on ...`. None of this reaches the bar.

So on the default install (no REVVIEW_START) the driver can never start a session from the car: the bar is stuck on
STARTING until someone SSHes in. The same happens after any key-on failure (bad path, Claude sign-in expired, tmux
error). The "documented" way out (the menu) does not exist while STARTING, because presses during STARTING are dropped
by design (src/server/README: "`dropped` is true when the view was `starting`").

Not covered by BENCH-TEST either: P2 and P13 only run with a valid `REVVIEW_START`.
