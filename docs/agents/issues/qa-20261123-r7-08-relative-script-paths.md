---
status: closed (2026-11-23, work/qa7-bench: see DECISIONS "QA round 7"; not yet re-run by QA)
id: qa-20261123-r7-08
title: REVOKE (c) step 4 and some bench items give script paths relative to the repo (`pi/readonly.sh`, `pi/data-setup.sh`, `pi/install.sh`) while pi/README uses `/opt/revview/pi/...`
severity: polish
area: docs/REVOKE.md (c) step 4, docs/BENCH-TEST.md D1, the Stage 4A intro, P1, S4B-1, S4B-9 (lines 140, 193, 206, 236, 244)
how to reproduce: `grep -n "bash pi/" docs/REVOKE.md docs/BENCH-TEST.md`
evidence: REVOKE (c) 4: "`sudo bash pi/readonly.sh disable` ... `sudo bash pi/data-setup.sh --user NAME ...`"; pi/README always "`sudo bash /opt/revview/pi/...`"
---

## Seen

REVOKE (c) is read in a stressful moment (stick lost), likely from a home-directory shell on the Pi's keyboard
(SSH keys do not work while locked, as the step says). `sudo bash pi/readonly.sh` then fails with "No such file".
Same in the bench items listed.

## Expected

`/opt/revview/pi/...` everywhere, as in pi/README.
