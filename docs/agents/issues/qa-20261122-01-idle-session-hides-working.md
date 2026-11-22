---
id: qa-20261122-01
title: An idle or just-opened second session outranks the working one; the bar says WAITING FOR ME +N while the driver's Claude works
severity: major
area: state (board priority)
how to reproduce: |
  `npm start`; open http://127.0.0.1:8138/ at 1280x400; POST (curl -s -X POST --data-binary @- http://127.0.0.1:8138/event):
  1. {"session_id":"aaaa-1111","cwd":"/home/user/src/revview","hook_event_name":"SessionStart","source":"startup"}
  2. {"session_id":"aaaa-1111","cwd":"/home/user/src/revview","hook_event_name":"UserPromptSubmit","prompt":"refactor the server"}
  3. {"session_id":"aaaa-1111","cwd":"/home/user/src/revview","hook_event_name":"PreToolUse","tool_name":"Grep","tool_input":{"pattern":"listen"},"tool_use_id":"a-s1","agent_id":"agent-x1"}
  4. {"session_id":"bbbb-2222","cwd":"/home/user/src/other-project","hook_event_name":"SessionStart","source":"startup"}
  Then (three sessions): A Stop + idle_prompt, B Stop + idle_prompt, C (cwd /home/user/src/notes) SessionStart,
  UserPromptSubmit "summarise", PreToolUse Write summary.md.
expected: |
  The bar should show what the session the driver is talking to is doing (WORKING, Write summary.md). A session
  resting at its prompt is not asking the driver for anything new; it can be counted in +N.
evidence: |
  Emulator (QA screenshots /tmp/qa2-shots/d-05-B-start.png, d-18-B-post-Bash-approved.png, d-23-C-pre-Write.png):
  - after step 4: `WAITING FOR ME +1`, lines 2 and 3 empty, while A's subagent is working;
  - d-18: `WAITING FOR ME +2` with both detail lines empty (C only sent SessionStart);
  - d-23: the driver has just spoken to C (UserPromptSubmit, PreToolUse Write) and the bar says
    `WAITING FOR ME +2` with B's old `$ npm run migrate -- --env staging` / `migrated 3`.
  Cause: `PRIORITY = { permission: 4, waiting: 3, working: 2, done: 1 }` in src/state/board.js, and SessionStart
  and idle_prompt both make `waiting`. Every finished session becomes `waiting` about a minute after Stop
  (idle_prompt, bench 8), so any second terminal left open hides all work in the active one for as long as it stays
  open. A driver who just dictated and reads WAITING FOR ME will think the dictation was lost and repeat it.
  DECISIONS "03, sessions" chose this order on purpose ("the session that most needs the driver"); this finding
  says the order is wrong for `waiting` that only means "idle at the prompt".
---
