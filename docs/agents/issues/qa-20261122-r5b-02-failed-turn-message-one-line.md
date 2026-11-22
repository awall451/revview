---
status: closed (2026-11-22, work/core-small-14: the failed-turn message wraps over the free rows; not yet re-run by QA)
id: qa-20261122-r5b-02
title: Failed turn: the error message is cut to one line with an ellipsis although the rows below are empty, so the decisive part ("ECONNREFUSED") is lost
severity: polish
area: view (failed turn output rows)
how to reproduce: replay fixtures/sessions/hook-wiring/events-stop-failure-interactive.jsonl without its SessionEnd (new session id) against the live server, select that session, 1280x400 (script /tmp/qa5b-scripts/f1.mjs, f2.mjs)
evidence: /tmp/qa5b-shots/f2-waiting.png
---

## Seen

Header "WAITING FOR ME" (purple), then bold "Turn failed: server error", then one line
"API Error: Connection refused — a firewall or proxy may be blocking it (E…", then the grey non-revview note.
Four more rows of the 400 px screen are empty. `/state` `failed.message` is the full text ending in "(ECONNREFUSED)".

The glance check itself holds: the first body row says in bold words that the turn failed (the header stays
WAITING FOR ME by decision, DECISIONS "failed turn").

## Expected

Let the message wrap onto the free rows (the Bash command already wraps to five lines in the same layout), so the
driver or a passenger can read the cause, e.g. a missing network versus a rate limit.
