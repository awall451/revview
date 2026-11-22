---
id: qa-20261122-02
title: A permission prompt in one subagent is hidden as soon as a parallel subagent of the same session runs a tool
severity: major
area: state (per-session reducer ignores agent_id)
how to reproduce: |
  Live server + page at 1280x400; POST, all with session_id "k1", cwd "/home/user/src/revview":
  1. SessionStart; UserPromptSubmit
  2. PreToolUse Task tool_use_id T1; PreToolUse Task tool_use_id T2 (two parallel subagents)
  3. PreToolUse Bash {"command":"psql -f migrate.sql"} tool_use_id b1, "agent_id":"agent-a1"
  4. PermissionRequest Bash {"command":"psql -f migrate.sql"}, "agent_id":"agent-a1"; Notification permission_prompt
  5. PreToolUse Read {"file_path":"/home/user/src/revview/docs/DESIGN.md"} tool_use_id r1, "agent_id":"agent-a2"
expected: |
  NEEDS PERMISSION stays until agent-a1's tool is answered (its PostToolUse/PostToolUseFailure/PermissionDenied),
  whatever other subagents of the session do meanwhile.
evidence: |
  Emulator: after step 4 `NEEDS PERMISSION $ psql -f migrate.sql` (/tmp/qa2-shots/k-02-sub1-needs-permission.png);
  after step 5 `WORKING revview / Read docs/DESIGN.md / $ psql -f mig…` (k-03), and after agent-a2's Edit
  `WORKING ... +1 −1` (k-04). The prompt is still open in the terminal, Claude waits for the driver, the bar says
  working. The board keys sessions by session_id only and subagent events share it (DECISIONS "03": "Subagents
  are not separate sessions"), so one activity per session is overwritten by any subagent. Round 1 issue 03
  was exactly this across sessions; it is fixed across sessions but not inside one. Parallel subagents (several
  Task calls in one message) running while one waits for permission is how Claude Code behaves to my knowledge;
  not recorded here (needs an interactive recording with two parallel subagents, one of them hitting a prompt).
---
