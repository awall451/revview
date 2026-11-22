---
status: closed
resolution: the 8-session cap drops sessions revview does not own before its own
id: qa-20261122-r4-08
title: The 8-session cap drops a running revview session in favour of a hand-started one, so the driver can no longer reach it
severity: minor
area: board (`capSessions`)
how to reproduce: 4 revview sessions + 4 hand-started ones on the board, then a 9th hand-started session posts events
evidence: /tmp/qa-wb4-shots/s6-02-list-8.png, /tmp/qa-wb4-shots/s6-07-list-after-9th.png (script /tmp/qa-wb4-shots/scripts/s6.mjs)
---

## Steps

1. Board with 8 sessions: alpha-service, beta-web (both DONE, revview tmux windows), gamma, delta (revview, working),
   hand-one..hand-four (hand-started; hand-four selected).
2. A 9th hand-started session `hand-five` posts SessionStart, UserPromptSubmit, PreToolUse.
3. Open the list.

## What I saw

`beta-web` is gone from the list and from left/right; its tmux window is still running. `hand-five`, which the
buttons cannot drive, took its place. The selected session's position changed from 8/8 to 7/8 with no gesture.

## What I expected

When `owned` is known, the cap should drop sessions the buttons cannot drive before revview's own sessions, since
those are the ones the driver can act on. (Positions renumbering is documented as a residual risk; this is a
separate effect.)
