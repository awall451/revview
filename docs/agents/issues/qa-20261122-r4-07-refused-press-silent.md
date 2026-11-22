---
status: open
id: qa-20261122-r4-07
title: A press that is refused (prompt shown under 1.5 s, after a switch, after the list closed) gives no sign; the driver cannot tell "too early" from "did not register"
severity: minor
area: actions / view
how to reproduce: dev server, permission prompt in session B while A is selected; hold back (home) then press within 0.5 s
evidence: /tmp/qa-wb4-shots/s2-05-home-to-B-permission.png, /tmp/qa-wb4-shots/s2-06-B-prompt-2s.png, /tmp/qa-wb4-shots/s3-02-after-press-right-after-switch.png
---

## Steps

1. Session B has a waiting `/permission` request; A is selected.
2. Hold F22 (home): the bar shows B's NEEDS PERMISSION. Tap F21 0.5 s later.
3. Also: tap left onto a prompt and press at once (s3); open and close the list, press at once (s8).

## What I saw

The safety rule works every time: no early press allowed (the long poll stayed open; the allow came only from a
press 2 s later, 5.2 s after the request). But the screen after the refused press is identical to before it
(s2-05 vs s2-06). The server log says `not done`; the driver sees nothing.

## What I expected

Some sign on the bar that the press was seen but held back (e.g. the prompt row shows "press again" for a moment,
or a short outline flash), so the driver knows to press again instead of wondering whether the pod works. The
1500 ms itself is not visible anywhere either.
