---
status: closed (2026-11-23, work/qa7-bench: see DECISIONS "QA round 7"; not yet re-run by QA)
id: qa-20261123-r7-01
title: When the only session ends the bar says just "<repo> ended": no next step for the driver, a push-to-talk tap then gets no feedback, and a key-on Claude that dies after ~1 s gets no pointer to the log
severity: minor
area: board note on owned-window loss (src/sessions owned poll, board.js note), view unknown with voice no-session; BENCH P17
how to reproduce: stand-in `claude` = `sleep 1; echo auth expired >&2; exit 1` first on PATH; private `TMUX_TMPDIR`; `REVVIEW_START=<existing folder> node src/server/index.js 8373 --dev-bridge --sessions --boot --projects <file>`; wait 7 s; screenshot at 1280x400; then F13 (push-to-talk) via POST /dev/key, read /state; then F22 (back), read /state
evidence: /tmp/qa-r7-shots/r7-02A.png ("alpha ended"), /tmp/qa-r7-shots/r7-02B.png ("Key-on session ended at once: see the server log"), /tmp/qa-r7-shots/r7-02-after-gesture.png; /state and log below
---

## Seen (a85c6bf)

- 0-4 s STARTING alpha; then `view unknown, voice no-session, note "alpha ended"`. The bar: UNKNOWN (cyan),
  crossed mic, "alpha ended". Log: `owned sessions: window of session ... (alpha) disappeared (Claude exited or the
  window was closed)`. r6b-02 is fixed as decided.
- Push-to-talk tap now: log `action push-to-talk: not done (no session selected)`, `/state` unchanged: note still
  "alpha ended". The line that would tell the driver the tap went nowhere ("Push-to-talk does nothing: no revview
  session") is hidden behind the note until some other gesture clears it (after F22 it shows).
- Same cause, two texts by timing: a Claude that exits at once gives "Key-on session ended at once: see the server
  log"; one that exits after ~1 s (realistic: sign-in check, update failure) gives "alpha ended" with no hint that
  the key-on start failed or where the reason is.

## Expected (driver's view)

The driver's question at that moment is "what now?". The boot path already answers it ("No session yet: open the
menu for New session"). When the last session is gone the note should say the same kind of thing, e.g. "alpha
ended: open the menu for New session", and a push-to-talk tap with no session should replace the note with the
"does nothing" line (as other refusals do). For a key-on session that ends within the launch limit, the note could
be the "Key-on session ended at once: see the server log" one. BENCH P17 still expects "Push-to-talk does nothing:
no revview session" for this case (see r7-05).
