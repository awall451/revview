---
status: closed (2026-11-22, work/qa5-fixes: OFFLINE keeps the "Denied/Allowed: <tool>" row above "Claude: ...")
id: qa-20261122-r5-02
title: A button deny while OFFLINE gives no confirmation: the bar goes from NEEDS PERMISSION straight to OFFLINE "Claude: working"
severity: minor
area: view (offline view) / board `answered`
how to reproduce: /tmp/qa5-scripts/r5.mjs, case "edit" (dev server on 8310)
evidence: /tmp/qa5-shots/r5-offline-permission.png, /tmp/qa5-shots/r5-offline-after-deny.png
---

## Steps

1. Selected session with a pending Edit request (PreToolUse + `/permission` long poll), shown as NEEDS PERMISSION.
2. Post `{"hook_event_name":"RevviewNetwork","online":false}`: still NEEDS PERMISSION with the crossed mic and
   "No network: voice input will not work" (round 3 r3-04 fix holds).
3. After 2 s tap deny (F16). The poll returns the deny.

## Seen

Red OFFLINE, "Claude: working", `+1 −1`, "No network: voice input will not work". Nothing says the deny was sent;
`/state` `answered` is null (and would also be null by r5-01 here, since a Bash ran before).

## Expected

The driver has just answered a safety question; one glance should confirm it, also while offline (e.g. the
"Denied: Edit" row kept under OFFLINE, as the prompt itself was kept under it by the r3-04 fix).
