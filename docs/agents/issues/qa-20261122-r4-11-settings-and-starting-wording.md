---
status: closed
resolution: Settings voice row says "needs tap mode" (a requirement, not detected); STARTING shows one note row
id: qa-20261122-r4-11
title: Settings presents "Voice: tap mode" as a fact though it is a fixed string; STARTING says "no session chosen" while a session is wanted
severity: cosmetic
area: board (settings rows) / view (notes)
how to reproduce: menu > Settings; POST `RevviewStarting` with a session selected
evidence: /tmp/qa-wb4-shots/s4-04-settings.png, /tmp/qa-wb4-shots/s7-05-starting.png
---

## What I saw

- Settings (read only), row 1: "Voice: tap mode, set in Claude Code". It is a constant in `src/state/board.js`
  line 586; revview never reads Claude Code's voice setting. Next to "Wheel buttons: not known" (which IS measured)
  it reads as a detected fact. If the owner set hold mode, the screen would still say tap mode.
- STARTING after `RevviewStarting`: two note rows, "Not ready for voice yet" and "Push-to-talk goes nowhere: no
  session chosen". The board keeps the selection as `want` and re-selects it when its events return (s7-06 shows
  alpha-service selected again), so "no session chosen" is not what the driver should take away; the first row
  already says it.

## What I expected

"Voice: tap mode is required (set /voice tap in Claude Code)" or similar wording that is true; one note row on
STARTING.
