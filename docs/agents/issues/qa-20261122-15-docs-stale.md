---
id: qa-20261122-15
title: BENCH items 20-22, the view README and STATE.md still describe STARTING / the old behaviour
severity: polish
area: docs, bench-test
how to reproduce: |
  Read docs/BENCH-TEST.md items 20-22, src/view/README.md "Input", docs/agents/STATE.md on gate/main 0f38005.
expected: |
  Each says what the code does now.
evidence: |
  - BENCH 20: "The page goes from STARTING to the posted state"; the page now shows NO LINK, then UNKNOWN, then the
    state (emulator a-00, c-01, c-02). The "Honest states" section says it replaces 21 and 22 but not 20, and 21/22
    still read STARTING in the table the owner will follow.
  - src/view/README.md: "Before the first message it shows `starting`. If the link is down (also before the first
    message) it shows `no-link` (... never `starting`)": the two sentences contradict; the code shows no-link.
  - docs/agents/STATE.md: "Updated 2026-11-21", "QA issues (round 1 ...) all OPEN", "Open points: SessionEnd is
    ignored", while 0f38005 closes them. Round-1 issue 15 (STATE.md stale) is back.
---

## Status (work/view-polish-2)

FIXED on this branch: BENCH-TEST 20-22 (NO LINK / UNKNOWN instead of STARTING), src/view/README.md (the `starting` /
`no-link` contradiction, N <= 7, `+? −?`, `9+`). STILL OPEN: docs/agents/STATE.md (the lead's file, not touched here).
