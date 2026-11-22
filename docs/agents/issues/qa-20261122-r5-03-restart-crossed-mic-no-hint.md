---
id: qa-20261122-r5-03
title: After a restart with several revview sessions the bar shows one of them with a crossed mic and no word on why or what to do
severity: minor
area: board selection at boot / view note row
how to reproduce: three owned tmux windows, `kill -TERM` the server, start it again with `--sessions` (server log `selected: none`)
evidence: /tmp/qa5-shots/r1-02-after-restart.png, /tmp/qa5-shots/r1-03-list-after-restart.png
---

## Seen

UNKNOWN, crossed mic, "3/3", the third session's name, rows "Not known until Claude's next step" / "No events from
this session yet". `/state` `voice: none`. Push-to-talk did nothing (no byte reached any stand-in). The round 4
note "Push-to-talk goes nowhere: no session chosen" is not shown, because the quiet session's own note wins.

## Expected

r4-01 is fixed (list, left/right and home all reach the three sessions, see the round report), but the driver
only sees a crossed mic on a session that looks selected (it carries a position). Either select one (home order,
as with one window) or show the "no session chosen: press to choose" note.
