---
status: closed (f6f7e46: no diff under NEEDS PERMISSION; the Edit PermissionRequest payload is not recorded, see DECISIONS "QA round 3")
id: qa-20261122-r3-03
title: NEEDS PERMISSION for an Edit shows the turn's diff so far, which reads as the size of the asked edit; the rest of the view is empty
severity: minor
area: view / state core
how to reproduce: see Steps
evidence: /tmp/qa-r3-shots/s09-label/00-B-perm-edit-plus1.png
---

## Steps

Session B (cwd `/home/user/customer-portal-backend`), page open:

1. `SessionStart`, `UserPromptSubmit`
2. `PreToolUse` + `PostToolUse` Edit `src/auth/session.ts` `old_string "a\nb\nc"`, `new_string "x"` (counts +1 −3)
3. `PreToolUse` Edit `src/auth/middleware/refreshToken.ts` `old_string "a"`, `new_string "b\nc"`, then
   `PermissionRequest` with the same input

Scenario `/tmp/qa-r3-scen/s09-label.jsonl` (first shot).

## What happened

`NEEDS PERMISSION +1 customer-portal-backend` / `Edit src/auth/middleware/refreshToken.ts      +1 −3`, and six empty rows.
I worked out by hand: `+1 −3` is the earlier, already-applied edit. The edit being asked for is +2 −1, and that
number is shown nowhere. After the approval the bar shows +3 −4 (correct for the turn).

## Expected

In NEEDS PERMISSION the number next to the request should describe the request, or carry no number. Showing the
turn total there reads as "this edit is +1 −3". The request's own size is easy to count (`countDiff` on the
PermissionRequest's `tool_input`). The permission view also has 6 free rows. The requested change's size, and
for a subagent which agent asks, would fit there.
