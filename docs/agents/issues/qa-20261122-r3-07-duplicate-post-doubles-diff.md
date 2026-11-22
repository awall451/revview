---
status: closed
id: qa-20261122-r3-07
title: A duplicated PostToolUse (same tool_use_id) during a turn doubles the diff and shows it as exact
severity: cosmetic
area: state core (board diff counting)
how to reproduce: Edit PostToolUse posted twice with the same tool_use_id
evidence: /tmp/qa-r3-tools/dup.mjs output (state core replay)
---

## Steps

One session: `SessionStart`, `UserPromptSubmit`, `PreToolUse` Edit t1 (`old_string "a"`, `new_string "b\nc\nd"`),
`PostToolUse` Edit t1, and the same `PostToolUse` Edit t1 again. Script `/tmp/qa-r3-tools/dup.mjs` (replayView).

## What happened

The diff is `+3 −1` after the first Post (correct, worked out by hand) and `+6 −2` after the duplicate, with no `≥`.
The board already knows the id is closed (`open` no longer has t1). After `Stop` the same duplicate is handled
differently: it is treated as a late event and marks the diff `≥`.

## Expected

A Post whose `tool_use_id` was already closed by an earlier Post adds nothing, or at most marks the diff
uncertain. It should never count twice and be shown as exact. A duplicate delivery is possible if the hook
command is configured in two settings files, or if a hook script retries a POST.

## Resolution

Fixed in `src/state/board.js` (branch work/core-hardening), tests in `tests/unit/board-hardening.test.js`; see docs/DECISIONS.md "core hardening".
