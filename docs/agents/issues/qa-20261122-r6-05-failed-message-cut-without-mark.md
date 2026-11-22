---
status: closed (2026-11-22, work/qa6-fixes: a cut failed-turn message is 199 code points plus an ellipsis; not yet re-run by QA)
id: qa-20261122-r6-05
title: The failed-turn message is cut at 200 characters in the middle of a sentence with no ellipsis
severity: cosmetic
area: src/state/reducer.js `failedOf` (slice 0..200) / view failed-turn rows
how to reproduce: /tmp/qa6-scripts/r1.mjs (dev server on 8320): StopFailure `error: rate_limit` with a 330-character `last_assistant_message`
evidence: /tmp/qa6-shots/r1-03-failed-turn-long.png
---

## Seen

The r5b-02 fix holds: the message wraps over three rows under "Turn failed: rate limit". It ends "... You can see the
response" and stops: the reducer keeps the first 200 code points and the view shows them as if that were the whole
message. Nothing tells the driver it was cut.

## Expected

A cut message ends with "…" (as command and output rows do elsewhere), or is cut at a word/sentence end.
