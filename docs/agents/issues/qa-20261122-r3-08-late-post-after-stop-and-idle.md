---
status: open
id: qa-20261122-r3-08
title: A late PostToolUse after Stop and idle_prompt flips WAITING FOR ME back to WORKING when the call was still open
severity: cosmetic
area: state core (board "finished" rule)
how to reproduce: Pre Bash t2, Stop, idle_prompt, Post Bash t2
evidence: /tmp/qa-r3-tools/dup.mjs output, steps 7-10 (state core replay)
---

## Steps

One session: `UserPromptSubmit`, `PreToolUse` Bash `pytest` t2 (no Post yet), `Stop`, `Notification`
`idle_prompt`, then `PostToolUse` Bash t2 with stdout `3 passed`. Script `/tmp/qa-r3-tools/dup.mjs`.

## What happened

done → waiting → **working**. `Stop` does not clear `open`, so after idle_prompt the session is "waiting with a
tool open" and counts as not finished. The late Post is then taken as new work.

## Expected

The state README says a turn has ended when it is `done`. After a Stop, a later idle_prompt should not reopen the
turn, so a late Post must keep WAITING FOR ME (it may still update the output, as it does at `done`). The "tool
open" exception is meant for an idle_prompt during an unanswered prompt, not after a Stop.
