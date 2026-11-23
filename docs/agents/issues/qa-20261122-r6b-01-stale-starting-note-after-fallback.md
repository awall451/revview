---
status: closed (2026-11-23, work/qa6-fixes: see DECISIONS "QA round 6b"; not yet re-run by QA)
id: qa-20261122-r6b-01
title: After the 30 s fallback the bar still says "Claude is still starting: push-to-talk not sent" under UNKNOWN, while push-to-talk is now sent
severity: minor
area: board note (RevviewLaunchExpired does not clear the push-to-talk refusal note), view unknown; BENCH-TEST P20
how to reproduce: server `node src/server/index.js 8335 --dev-bridge --sessions --projects <file with two folders>` with a stand-in `claude` on PATH that never sends a hook (`exec sleep 600`); menu, press, press (F23, F21, F21 via POST /dev/key) starts a session; tap push-to-talk (F13) within 30 s; wait past 30 s; screenshot at 1280x400; tap F13 again
evidence: /tmp/qa6b-shots/r6b-new-ptt-refused.png (at 4 s), /tmp/qa6b-shots/r6b-new-expired.png (at 36 s); server log lines below
---

## Seen

- 0-30 s: STARTING, crossed mic, "Not ready for voice yet" and, after the tap, "Claude is still starting: push-to-talk
  not sent"; log `action push-to-talk: not done (session starting)`. This part is as decided.
- At 36 s: `/state` `view: unknown`, `voice: here` (mic not crossed), `note: "Claude is still starting: push-to-talk not
  sent"`. The bar reads: UNKNOWN / "Not known until Claude's next step" / "Claude is still starting: push-to-talk not
  sent". A tap now is sent (`action push-to-talk: done`).

So for a driver who tried to talk once during STARTING, the bar keeps saying push-to-talk is not sent after it already
works again, until some other gesture clears the note. The "No events from this session yet" note that DECISIONS
"QA round 6" part D and BENCH P20 promise after the fallback does not show (the board note takes its place:
`board.js` shows that text only when `b.note` is not a string).

## Expected

The refusal note belongs to STARTING: `RevviewLaunchExpired` (and the session's first hook) should clear it, as the
"Too early" note is cleared when the shown prompt changes. P20's expected result ("then UNKNOWN 'No events from this
session yet'") also asks for a tap during STARTING, so P20 as written would fail on this.
