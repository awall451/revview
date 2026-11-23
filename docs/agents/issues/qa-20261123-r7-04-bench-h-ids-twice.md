---
id: qa-20261123-r7-04
title: BENCH-TEST still has duplicate ids: H1 to H7 exist twice ("Honest states" and "Stage 2: hook wiring"); r6b-05 fixed only the B series
severity: minor
area: docs/BENCH-TEST.md ids, pi/README.md ("D/W/R/H items"), item 10 ("see H1")
how to reproduce: `grep -oE "^\| [A-Z0-9-]+ \|" docs/BENCH-TEST.md | sort | uniq -d`
evidence: output `| H1 |` .. `| H7 |`; line 86-92 (Honest states H1-H7) and line 183-189 (Stage 2 H1-H7); H8-H10 sit in the "Several sessions" table (lines 108-110), not with the other H items
---

## Seen

r6b-05 point 2 (B1-B7 twice) held: the second series is now S4B-1..S4B-19. But the same problem exists for H:
"H4 failed" can mean "server stopped, page reload" (Honest states) or "server stopped, Claude turn with tools"
(Stage 2), which are also nearly the same test, the second still written with the old `sudo systemctl stop
revview`. Item 10 says "see H1" (meant: Stage 2 H1, the hook install). pi/README lists "D/W/R/H items" for the owner.
H8-H10 are in a different section from H1-H7.

## Expected

Unique ids across the file (e.g. rename the Stage 2 series HW1-HW7), fix the "see H1" cross-reference, move
H8-H10 under Honest states. See r7-05 for merging the near-duplicates.
