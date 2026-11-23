---
status: closed (2026-11-23, work/qa7b-fixes: see DECISIONS "QA round 7b"; not yet re-run by QA)
id: qa-20261123-r7b-03
title: pi/README line 6 says part A items are 'P1-P14'; BENCH-TEST has P1-P21
severity: polish
area: pi/README.md line 6
how to reproduce: grep -n 'P1-P14' pi/README.md; grep -o '^| P[0-9]* ' docs/BENCH-TEST.md
evidence: pi/README.md:6; BENCH-TEST rows P15-P21 exist (P21 is in First afternoon)
---

## Expected

"P1-P21".
