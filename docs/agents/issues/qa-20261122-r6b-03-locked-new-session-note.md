---
id: qa-20261122-r6b-03
title: New session while the data is locked says "New session not started: see the server log", although the reason (data locked: insert the key) is known
severity: minor
area: src/sessions/actions.js (new-session refusal note), --data-lock guard in src/server/index.js
how to reproduce: `mkdir /tmp/qa6b-s/data` (nothing mounted there); `node src/server/index.js 8336 --dev-bridge --sessions --boot --data-lock /tmp/qa6b-s/data --projects <file>`; menu, press, press (F23, F21, F21)
evidence: /tmp/qa6b-shots/r6b-datalock-new-refused.png; server log `action new-session: not done (data is locked: insert the key stick)`
---

## Seen

INSERT KEY / "Data locked", menu and New session list work, no tmux server is created (good: no session starts),
`--boot` does not trap (view `insert-key`, presses not dropped). But the refusal note is the generic
"New session not started: see the server log", while the log has the exact reason.

## Expected

The driver is in the car and cannot read the server log. The note should say what to do, e.g. "New session not
started: data locked, insert the key stick". (The bar already shows INSERT KEY, so this is minor; but "see the server
log" is the one instruction the driver cannot follow.) pi/README "How the unlock works" says only "New session is
refused".
