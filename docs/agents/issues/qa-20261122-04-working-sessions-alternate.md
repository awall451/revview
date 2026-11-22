---
id: qa-20261122-04
title: Two working sessions make the detail lines and the diff flip between repos on every event
severity: minor
area: state (shown session tie-break)
how to reproduce: |
  Sessions A (cwd /home/user/src/revview) and B (cwd /home/user/src/other-project): SessionStart and
  UserPromptSubmit for both, then alternate PreToolUse A Edit src/server.js (tool_use_id a0, a1, ...) and
  PreToolUse B Bash "cargo build --release" (b0, b1, ...).
expected: |
  A stable choice while both are working (e.g. keep the session shown until another one needs the driver more),
  so the repo, tool and +N −N on screen belong together for more than one event.
evidence: |
  boardView after each event (node, src/state/index.js): `revview Edit src/server.js`, `other-project Bash cargo
  build --release`, `revview Edit ...`, `other-project Bash ...` and so on, always `WORKING +1`. Ties go to the most
  recent event (DECISIONS "03"), so with two busy sessions the band's repo, line 2, line 3 and the diff count jump
  between two unrelated sessions several times a second; a glance gets whichever one posted last.
---
