---
status: closed (f6f7e46: view README, emulator README, BENCH H9 updated)
id: qa-20261122-r3-10
title: Docs still describe the pre-dense layout (no wrapping, MIN_MM 10.5/6.0, "line 3")
severity: cosmetic
area: docs
how to reproduce: grep the files below on gate/main 72a2d13
evidence: line numbers below
---

## What is stale

- `src/view/README.md:119` (Fitting): "Long values never wrap or overflow." The command now wraps over up to 6
  rows (same README, "Below row A").
- `emulator/README.md:47` (Millimetres): "the real thresholds are `MIN_MM` in `src/view/type.js`: 10.5 mm state
  word, 6.0 mm any text". `type.js` has no `MIN_MM`; it has `TYPE_MM` 6.05/3.55 and `RANGE_MM` 5.8-6.3 / 3.3-3.7.
  The same paragraph's example "at least 10.5 mm" is also old.
- `docs/BENCH-TEST.md:81` (H9): the repo "bold at the right end of line 3". It is row A now (`#session`), and
  under the dense layout the band has room for the repo even next to NEEDS PERMISSION +N. So `#session` did not
  show in any case QA tried (NEEDS PERMISSION +1 with a 45-character CJK/Latin repo and a long branch, NEEDS
  PERMISSION +7). STATE.md already notes that its test coverage was lost.

## Expected

Each statement matches the code on main, or is marked as history the way DECISIONS does it.
