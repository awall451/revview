status: closed (2026-11-22, work/qa5-fixes: note "<repo> ended" when the selected session ends)
---
id: qa-20261122-r5-04
title: When the selected session ends, the selection moves to another session with no note; push-to-talk now goes there
severity: minor
area: board selection (`selected` falls to `homeKey`) / view note
how to reproduce: /tmp/qa5-scripts/r2.mjs (alpha selected, list open on beta, alpha's window killed and its SessionEnd posted); also seen in r1a.mjs
evidence: /tmp/qa5-shots/r2-01-cursor-on-beta.png, /tmp/qa5-shots/r2-02-after-row-above-ended.png, /tmp/qa5-shots/r1-01-before-restart.png
---

## Seen

`alpha-service` (WORKING, selected, 1/3) ends: the band now shows `beta-web` WAITING FOR ME, 1/2, normal mic, note
null. Nothing says the session the driver was talking to has gone. The same with the list closed (r1a: beta-web
selected, its SessionEnd -> alpha-service shown at 1/1, no note).

## Expected

BUTTONS.md says the selection falls to the neediest; that is fine, but the list case got a note ("Highlighted
session ended: list closed") and this one did not. A short note ("<repo> ended") for the next glance would stop
the driver from speaking the next instruction into another project.
