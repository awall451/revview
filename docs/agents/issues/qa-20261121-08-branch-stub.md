---
id: qa-20261121-08
title: A long branch name is cut to "feature/…", which hides the only part that tells branches apart
severity: minor
area: view
how to reproduce: |
  POST RevviewContext `{cwd: "/home/user/src/revview", branch: "feature/very-long-branch-name-for-refund-flow-fix-2026"}`, then any working event.
evidence: |
  Emulator band: `WORKING   revview · feature/…` (/tmp/qa-shots/qa-008-009-long-path-and-branch.png).
  The "under about 8 characters" stub rule does not trigger (17 characters are visible), yet every
  `feature/...` branch looks the same. The file path gets a middle cut; the branch gets an end cut.
  Bench item 10 expects "the view shows the repository and that branch".
---
