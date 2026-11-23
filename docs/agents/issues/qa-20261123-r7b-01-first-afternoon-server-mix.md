---
status: closed (2026-11-23, work/qa7b-fixes: see DECISIONS "QA round 7b"; not yet re-run by QA)
id: qa-20261123-r7b-01
title: First afternoon mixes two ways to run the server: S1 and S3 want a hand-started server with the service stopped, HW1/P13 and README 'First drive' use the service; S3 still says 'node hooks/install.mjs' (relative) and 'writes hooks/settings.json'
severity: minor
area: docs/BENCH-TEST.md First afternoon items 13, 14, 15, 16; S1, S3; pi/README First drive
how to reproduce: read First afternoon steps 13-16 in order, then rows S1 (line 106) and S3 (line 108); grep -n 'node hooks/install' docs/BENCH-TEST.md
evidence: docs/BENCH-TEST.md lines 16-39, 106, 108; pi/README.md First drive step 1
---

## Seen

- First afternoon 13 (S1) says to run `node src/server/index.js --input --start <repo>` by hand, with the service stopped (top note). Item 14 (HW1) and 15 (P13) then need the service again (key-on from `REVVIEW_START`). Item 16 (S3) again says "run a session started by `--start`" (hand-started). The list never says "stop the service" at 13 and 16, nor "start it" at 14/15; the owner has to link the top note to the item numbers (the note names ids 20, 21, 28, 32, S1, W3, W5, not S3).
- pi/README "First drive (parked)" does it the other way: `tmux -L revview attach` to the service's own session, no hand-started server. S1's "(stop the service first ...)" and the README disagree on how to do the same step.
- S3 still starts "install the hooks (`node hooks/install.mjs`, which writes `hooks/settings.json` ...)": a repo-relative path (the r7-08 kind) and a step that HW1 (item 14) already did earlier in the list.

## Expected

In First afternoon: mark 13 and 16 as "service" (use the service; `--start` is not needed, `REVVIEW_START` and attach as in README) or "hand-started: stop the service, start it again", and S3's hook install as "done in HW1". Use `/opt/revview/hooks/install.mjs` if kept.
