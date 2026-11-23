---
id: qa-20261123-r7-07
title: No reading order for the owner: the top-level README does not mention pi/README.md, and BENCH-TEST's 149 items are in build order (the first Pi set-up item, P1, is item ~120 of the file) with no "do these first" list or dependencies
severity: major
area: README.md, docs/BENCH-TEST.md structure, pi/README.md intro
how to reproduce: open README.md as the owner with a fresh Pi; `grep -n "pi/README\|REVOKE\|hooks/README\|BUTTONS" README.md`; `grep -c "untested" docs/BENCH-TEST.md`; `grep -n "^## " docs/BENCH-TEST.md`
evidence: README.md links only docs/DESIGN.md and docs/BENCH-TEST.md (grep: no match for the others); 149 rows marked untested, 0 tested; sections in order 1-39, WB2, WB3, Honest states, Several sessions, WB4, WB6, WB5, Stage 2, Stage 4A, Stage 4B
---

## Seen

- The top-level README is the charter text, the checks and `npm start`. The appliance's entry point
  (`pi/README.md`) is not linked from it; neither are `docs/REVOKE.md`, `hooks/README.md` or `docs/BUTTONS.md`.
  The owner finds pi/README only through BENCH P1 or by browsing.
- BENCH-TEST is ordered by when the team built things. At the bench the owner needs the reverse: install (P1),
  screen and rotation (P3, P4, P5, P6), service (D1), dongle ids and codes (D5, D6, W1/27; every button item
  depends on them), mic and voice (P14, S1), hooks and a real task (H1 Stage 2, P13), permission by button (S3), and
  only later the data set-up (S4B-9 before S4B-4..8, 11, 12, 15, 17-19) and the overlay (S4B-1, which every later
  item then runs under; pi/README says "run last"). None of these dependencies is written; item 11/18/26 (sizes)
  and 12/16/17/26/V8 (in the car) are scattered.
- About 11 items stand between the flash and a first useful drive (P1, P4, P5, D1, D5, D6, W1, P14, S1, P13,
  S3); with the overlay for key-off power cuts (S4B-1) and the in-car glance (26) about 13. The other ~136 can wait,
  but the document does not say so.

## Expected

README "On the Pi" section: read pi/README.md (set-up), then BENCH-TEST "first afternoon" list; REVOKE.md if the
Pi or the stick is lost. At the top of BENCH-TEST, a short ordered "first afternoon" list of ids with what each
depends on, and a note that the remaining sections are reference. No item needs to move; the ids stay.
