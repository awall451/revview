---
id: qa-20261121-10
title: An event that arrives after Stop (out of order) turns DONE back into WORKING, and it stays WORKING
severity: minor
area: state
how to reproduce: |
  POST SessionStart, UserPromptSubmit, PreToolUse Bash `npm test`, Stop, then PostToolUse Bash for the
  same tool_use_id.
evidence: |
  Emulator: DONE after Stop, then `WORKING $ npm test / ok` and still WORKING 2 s (and indefinitely)
  later. Each hook is a separate `curl` process, so ordering is only as good as Claude Code waiting for
  every hook to finish (true for synchronous hooks, not for `async` ones or a retrying script). A
  PostToolUse whose tool_use_id has no open PreToolUse in the current turn, or any tool event after
  Stop in the same prompt_id, could be ignored. Low likelihood, but the effect is a lasting false WORKING.
---
