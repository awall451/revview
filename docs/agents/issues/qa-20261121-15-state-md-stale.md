---
id: qa-20261121-15
title: STATE.md says the glance view is "ON BRANCH work/glance-view (not merged yet)" but it is on gate/main
severity: polish
area: docs
how to reproduce: |
  `git show gate/main:docs/agents/STATE.md`, section "Milestone 1"; `git log gate/main --oneline -5`.
evidence: |
  gate/main fedb689 contains src/view, src/server and emulator/tests/live.spec.js (commits 448bc73,
  961824b, 7ae2423, fedb689), while STATE.md still lists them as not merged and "Next 2. Merge
  work/glance-view".
---
