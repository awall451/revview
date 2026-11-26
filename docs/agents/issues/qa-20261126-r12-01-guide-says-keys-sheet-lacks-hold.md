---
id: qa-20261126-r12-01
title: Laptop guide says the --keys sheet does not list the menu hold; the sheet (and the copy of it in the same guide) does list it
severity: minor
area: docs/EMULATOR-LAPTOP.md ("Night look" bullet)
reproduce: |
  bash emulator/run.sh --keys | grep '^M '
  Read docs/EMULATOR-LAPTOP.md, "What you see", the "Night look" bullet.
evidence: |
  The guide: "The `--keys` sheet does not list the hold: `emulator/keys-sheet.js` is at its line limit and was not changed."
  The sheet on d8c49e7 prints: "M         menu          menu            day/night"
  The sheet block in the same guide (section "The keys") matches `--keys` byte for byte (diff: same) and shows that row.
---
What I did: followed the guide's "Night look" steps, then printed `--keys`.
What I saw: the hold is listed (HOLD column "day/night") in the sheet and in the guide's own copy of it.
What I expected: the sentence removed (or saying the sheet shows it). As written the owner is told something false
about the tool and may think the sheet is out of date.
Severity: minor (doc only; the behaviour is right).
