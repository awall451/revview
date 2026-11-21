---
id: qa-20261121-01
title: After a server restart the view says STARTING "Not ready for voice yet" until the next hook, though Claude is ready
severity: major
area: server, state
how to reproduce: |
  1. `node src/server/index.js 18138`; open http://127.0.0.1:18138/ at 1280x400.
  2. POST SessionStart, UserPromptSubmit, Pre/PostToolUse Bash, Stop, Notification idle_prompt
     (`curl -s -X POST --data-binary @- http://127.0.0.1:18138/event`). View: WAITING FOR ME.
  3. Kill the server (SIGTERM), start it again on the same port, post nothing.
evidence: |
  Emulator, gate/main fedb689. 3 s and 23 s after the restart the page shows
  `[starting link=up seq=0] STARTING / "Not ready for voice yet"` (screenshot kept by QA:
  /tmp/qa-shots/qa-001-starting-after-server-restart.png). The server keeps state in memory only and
  starts at `initialState()` (DECISIONS "a restarted server starts at starting"). Claude Code is in fact
  waiting for the driver, and it sends no hook until the driver speaks, so the screen tells the driver
  NOT to speak for as long as the driver obeys it: a deadlock in practice. The charter's first item is
  "state first"; here the state shown is wrong with no end. BENCH item 21 only checks that the page
  "follows events again", which hides this. Possible directions (for the team to decide): persist the
  last state, or show an "unknown / link restored" state rather than claiming "not ready for voice".
---
