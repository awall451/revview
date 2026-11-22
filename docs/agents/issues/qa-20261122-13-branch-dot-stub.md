---
id: qa-20261122-13
title: When the repo nearly fills the band the branch becomes a bare "·…"
severity: polish
area: view (fitWhere fallback)
how to reproduce: |
  Session with cwd "/home/user/src/会計システム" and RevviewContext branch "機能/返金フローの修正-第二版", one other
  session live (+1), then any working event.
expected: |
  Either the repo alone or the repo with a readable piece of the branch; never a dangling separator.
evidence: |
  Emulator band: `WORKING +1  会計システム ·…` (/tmp/qa2-shots/g-cjk-03-working-edit-+1.png). `fitWhere` returns null when
  4 graphemes of branch do not fit and view.js falls back to the CSS end cut of the whole "repo · branch" string.
  Same with Latin names: `customer-billi…` (g-long-03), where the end cut hides the branch entirely, which is fine.
---
