---
id: qa-20261121-13
title: DECISIONS contrast table gives per-fixture minimums as per-state minimums (waiting 10.07, permission 10.59; really 8.32 when a diff is shown)
severity: polish
area: docs
how to reproduce: |
  Compute WCAG contrast of `#ff7a7a` (diff removed, src/view/view.css) on `#000`.
evidence: |
  Hand computation: #ff7a7a on black = 8.32:1, #b8b8b8 on black = 10.59:1, black on #c8a2ff = 10.07:1.
  The diff is shown in waiting and permission too (view.js hides it only for starting/insert-key), so the
  lowest text contrast in those states is 8.32:1, not 10.07 / 10.59 as the table "Lowest contrast of any
  text in that state (measured)" says; the fixtures for those states just have no diff. All values stay
  above the 7:1 floor; only the wording is wrong ("in that state's fixture").
---
