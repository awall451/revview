---
status: closed
resolution: not-owned sessions show the crossed mic and the note "Buttons do nothing here: not a revview session"; home ranking is unchanged (design question left)
id: qa-20261122-r4-06
title: Sessions the buttons cannot drive are not marked in the list (plain mic on their row), home jumps to them, and the note only mentions push-to-talk
severity: minor
area: view (list rows) / board home ranking
how to reproduce: dev server with 4 revview sessions plus 4 hand-started ones (hook events with ids that are not tmux windows of revview)
evidence: /tmp/qa-wb4-shots/s6-02-list-8.png, /tmp/qa-wb4-shots/s6-04-home-8.png, /tmp/qa-wb4-shots/s6-05-press-on-hand-prompt.png, /tmp/qa-wb4-shots/s11-02-after-row-above-ended.png
---

## Steps

1. 4 revview sessions (alpha, beta, gamma, delta) and 4 hand-started ones (`hand-one`..`hand-four`, the only
   permission prompt is in `hand-three`).
2. Open the list (F21). Then close it and hold back (home). Wait 2 s, tap press, tap push-to-talk.
3. Separately: select the hand-started `xray` and open the list.

## What I saw

- In the list, `hand-one`..`hand-four` look exactly like the revview rows (chip, name, state word). `/state` has
  `voice: false` for them but nothing on screen shows it; you only learn after choosing one.
- With `xray` (not owned) selected, the band shows the CROSSED mic but its list row shows a PLAIN mic (s11-02).
- Home goes to `hand-three` (NEEDS PERMISSION, crossed mic, 7/8). Press does nothing (correct), with no message.
  The note says "Push-to-talk goes nowhere: not a revview session"; it does not say that allow, deny and cancel do
  nothing either, so the driver presses again and again on an amber prompt.

## What I expected

A crossed mic (or another shape) on list rows the buttons cannot drive, the same glyph in the list as in the band,
and a note that names all buttons ("Buttons do nothing here: not a revview session"). Whether home should prefer a
session the buttons can answer is a design question; at least the driver should not land on one silently.
