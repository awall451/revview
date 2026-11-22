---
status: closed (f6f7e46: U+2060 after hyphens, breaks at spaces)
id: qa-20261122-r3-09
title: Wrapped commands break after "--", so a flag reads as "run --" / "reporter=verbose"
severity: cosmetic
area: view (command wrapping)
how to reproduce: a Bash PreToolUse whose command is longer than one row and has --long flags
evidence: /tmp/qa-r3-shots/s02-wrap/00-cmd0-pre.png, gallery worst-over-limits.png ("git log --" / "oneline")
---

## Steps

`PreToolUse` Bash with `cd packages/frontend && pnpm exec vitest run --reporter=verbose --coverage ...`
(`/tmp/qa-r3-scen/s02-wrap.jsonl`, first shot).

## What happened

Row 1 ends with `vitest run --` and row 2 starts with `reporter=verbose`. In the gallery's worst-over-limits
shot, `git log --` / `oneline` is split the same way. The hanging indent works and the 6/5/3-row limits and the end
ellipsis were right in every case tried (150, 290 and 300+ characters, heredoc, emoji, CJK).

## Expected

Break at spaces first (`overflow-wrap: anywhere` plus the browser's break-after-hyphen rule causes this). Break
inside a token only when the token does not fit a row. STATE.md already lists this as a follow-up; filed so it is
tracked.
