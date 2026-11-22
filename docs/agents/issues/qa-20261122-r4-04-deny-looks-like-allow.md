---
status: closed
resolution: RevviewAnswered stores the answer; the tool row says Denied: <tool> / Allowed: <tool> until the next call
id: qa-20261122-r4-04
title: After a wheel-button deny the bar looks exactly like after an allow, and then DONE shows the denied command as if it ran
severity: major
area: board (`RevviewAnswered`) / view
how to reproduce: see Steps (dev server on 8140, `/permission` long poll as the hook does it)
evidence: /tmp/qa-wb4-shots/s2-07-after-allow.png, /tmp/qa-wb4-shots/s3-08-A-prompt-2s-before-deny.png, /tmp/qa-wb4-shots/s3-09-after-deny.png, /tmp/qa-wb4-shots/s4-00-A-done-after-deny.png
---

## Steps

1. Session `alpha-service` selected; replay `fixtures/sessions/permission-prompt.jsonl` lines 2-3 and POST line 4
   (PermissionRequest Bash `python3 -c "print('ok')"`) to `/permission`.
2. Wait 2 s, tap deny (F16). The long poll returns 200 `{"behavior":"deny","message":"Denied with the wheel button."}`.
3. POST `Stop` (the recorded WB3 deny sequence is PreToolUse, PermissionRequest, Stop: `fixtures/buttons/wb3/events-wb3-deny-main.jsonl`).
4. For comparison, do the same with press (allow) in another session (s2).

## What I saw

- After deny: blue WORKING, `Bash`, `$ python3 -c "print('ok')"` (s3-09). After allow: the same screen (s2-07).
- After the Stop: green DONE, `Bash`, `$ python3 -c "print('ok')"`, nothing else (s4-00). This reads as "the command
  ran and Claude finished". The only difference from an allowed command with no output is that there is no output row.

## What I expected

The driver has just made a safety decision with one button and has one glance to check it took. The bar should
show which answer was sent (e.g. "Denied" / "Allowed" on the tool row until the next event) and, after a deny, it
should not show the denied command as the last command without saying it was denied. This behaviour dates from
WB3 (`RevviewAnswered` keeps the entry's tool and command), but it is part of the button permission flow this
round covers.
