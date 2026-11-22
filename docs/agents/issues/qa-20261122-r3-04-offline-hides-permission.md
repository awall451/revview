---
status: closed (87c4235 + f6f7e46: needing the driver outranks OFFLINE, offline is a secondary row; decision in DECISIONS "QA round 3")
id: qa-20261122-r3-04
title: OFFLINE hides NEEDS PERMISSION; the prompt survives only as a 3.4 mm note
severity: minor
area: state core (overlay) / view
how to reproduce: a pending permission, then RevviewNetwork online false
evidence: /tmp/qa-r3-shots/s09-label/01-offline-over-permission.png
---

## Steps

Any session with a pending prompt (e.g. `/tmp/qa-r3-scen/s09-label.jsonl` up to the first shot), then POST
`{"hook_event_name":"RevviewNetwork","online":false}`.

## What happened

The band turns red: `✕ OFFLINE +1 customer-portal-backend · fix/session-timeout`. Row A says
`Claude: needs permission`, and the next row says `No network: voice input will not work`. The amber band, the triangle and the
tool, file and command of the request are gone, and 5 of the 7 rows are empty.

## Expected

The permission dialog is local. Claude is blocked on the driver, and answering it (terminal now, wheel buttons
later) works without a network. At a glance the driver should still see that Claude needs them. For example,
keep the NEEDS PERMISSION look and show offline as a secondary mark, or keep the request's tool, file and
command in the free rows. As it stands, the most important state is reduced to small text.
The same holds less sharply for WAITING FOR ME under OFFLINE.
