---
status: closed (2026-11-23, work/qa6-fixes: see DECISIONS "QA round 6b"; not yet re-run by QA)
id: qa-20261122-r6b-08
title: Without --data-lock a posted RevviewDataLock shows INSERT KEY "Data locked" while New session still starts; a posted RevviewStarting with no session leaves STARTING up indefinitely
severity: polish
area: src/server/index.js postEvent (RevviewDataLock and RevviewStarting accepted over HTTP), board
how to reproduce: `node src/server/index.js 8331 --dev-bridge --sessions --boot` (REVVIEW_START missing folder, boot done); `curl -X POST -H 'content-type: application/json' --data '{"hook_event_name":"RevviewStarting"}' http://127.0.0.1:8331/event`; read /state; then `--data '{"hook_event_name":"RevviewDataLock","locked":true}'`; menu
evidence: /tmp/qa6b-shots/r6b-posted-datalock.png; /state values below
---

## Seen

What held (the point of the round): `RevviewBootBegin`, `RevviewBootDone`, `RevviewLaunching`,
`RevviewLaunchExpired` posted: 403 with and without `--dev-bridge`. A posted `RevviewStarting` after the boot: the
bar shows STARTING but presses are NOT dropped (`dropped: false`, the menu opens). During a real boot hold (slow tmux
wrapper, 1.5 s per call) a posted `RevviewStarting` did not end or extend the hold; the boot ended and selected its own
session. Under `--data-lock` a posted `{"locked":false}` is a poke only: still INSERT KEY, no session started.

What is left, all by a local process only:
- posted `RevviewStarting` with no session: `view: starting` and it stays (no 60 s bound applies, no hook will come).
  The driver sees STARTING for good (still `starting` after menu and back presses; I did not find in the code what would end it without a hook), though
  the buttons work.
- posted `RevviewDataLock {"locked":true}` on a server without `--data-lock`: `view: insert-key`, "Data locked"; New
  session is not guarded there, so it would start a Claude while the bar says the data is locked. A later
  `{"locked":false}` went back to the `starting` the earlier posted `RevviewStarting` had left (no session).

## Expected

Any local process can post fake hook events, so this is not a security hole; but these two events have no use over
HTTP on a real install (the boot and the lock come from the server itself). Refuse `RevviewDataLock` over HTTP when
there is no `--data-lock`, and give a posted `RevviewStarting` the same bound or ignore it with no sessions.
