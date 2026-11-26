---
id: qa-20261126-r12-03
title: Night look - every state word is the same amber in the same place; band tints are near black, so NEEDS PERMISSION vs WORKING vs OFFLINE rests on a 40 px glyph and the word alone
severity: minor (owner judgment)
area: src/view/view.css (night palette), docs/DECISIONS.md "Night and day looks"
reproduce: |
  Gate gallery 864829f: compare working/permission/done/offline/asking/ended with their night-*.png.
  Contact sheet (day left, night right, top 100 px of each): /tmp/qa-r12-shots/bands.png
evidence: |
  Night --band-fg #d98a3a for every state; bands --b-working #0a1a2a, --b-permission #2e1c00, --b-offline #2a0a0a,
  --b-ended #1f1a0c, --b-asking #1c1f04, --b-done #07200f (all luminance <= 0.02, the doc's own limit).
  In the sheet NEEDS PERMISSION (#2e1c00) and CLAUDE EXITED (#1f1a0c) bands look the same brown; WORKING/OFFLINE/DONE
  bands read as "black". The shapes differ (circle, triangle, cross, tick) at about 40 px and drawn in the same amber.
  DECISIONS says a state is told "by shape, word and place": the word sits in the same place for every state, so "place"
  adds nothing.
---
What I did: put the day and night bands of 12 shots side by side and looked at them as a one-second glance.
What I saw: in day the colour alone says "needs me" (amber/red) vs "busy" (blue). In night, the most important
difference for a driver, needs permission vs working, is the triangle vs dot and reading the word; nothing about
NEEDS PERMISSION is brighter or bigger than WORKING. On an LCD whose backlight cannot be dimmed (N8, expected none),
the dark tints will likely disappear into the backlight glow, so the tint does not help either (not proven: bench N2).
The owner's brief asked "state still told by shape and place, not only colour" - this is met literally, so this is a
judgment call, not a bug.
What I expected (suggestion only): the states that need the driver (permission, asks, failed/offline) visibly stronger
at night, e.g. the band word in --strong or a framed band, while staying under the 0.25 area luminance limit; and the
"place" claim dropped from DECISIONS. Owner to judge on the bench (N2).
Severity: minor.
