---
status: closed
resolution: list highlight is a session id (nav.id) that follows its session; a list whose session ended closes with a note
id: qa-20261122-r4-02
title: The list cursor is a row number; when a session above it ends while the list is open, press chooses a different session than the one the driver highlighted
severity: major
area: board nav (`reduceNav`, list rows) / actions
how to reproduce: see Steps (dev server on 8140, page `/?devkeys=1`)
evidence: /tmp/qa-wb4-shots/s11-01-cursor-on-xray.png, /tmp/qa-wb4-shots/s11-02-after-row-above-ended.png, /tmp/qa-wb4-shots/s11-03-chosen.png (script /tmp/qa-wb4-shots/scripts/s11.mjs)
---

## Steps

1. Three sessions on the board in this order: `alpha-service` (selected, working), `xray` (waiting), `yankee` (working).
2. Press (F21): the list opens with the cursor on row 0 (`alpha-service`). Down (F18): cursor on `xray`.
3. While the list is open, `alpha-service` ends (`SessionEnd` posted, as Claude Code does when the session exits).
4. Press (F21).

## What I saw

After step 3 `/state` shows `nav list:1`, rows `xray, yankee`: the highlight jumped from `xray` to `yankee` with no
gesture. Step 4 selected `yankee` (`position 2/2`), not `xray`, which the driver had highlighted and was reading.

## What I expected

The cursor stays on the same session (`xray`) when rows above it go away, or the list closes when its rows change.
DECISIONS "wheel buttons 4" says the selection changes "Never by another session's events"; here another session's
event decides which session the driver's press selects, i.e. where push-to-talk and cancel go next. The window is
short (a session must end within the 10 s the list is open), but nothing on the bar tells the driver it happened.
