---
id: qa-20261122-05
title: The branch of an ended session is shown next to other repos, even after RevviewStarting
severity: minor
area: state (board context fallback)
how to reproduce: |
  reduceBoard / live server, POST in order:
  1. {"hook_event_name":"SessionStart","session_id":"A","cwd":"/home/user/src/revview","source":"startup"}
  2. {"hook_event_name":"RevviewContext","session_id":"A","cwd":"/home/user/src/revview","branch":"fix/refund-flow"}
  3. {"hook_event_name":"SessionEnd","session_id":"A","cwd":"/home/user/src/revview"}
  4. {"hook_event_name":"RevviewStarting"}
  5. {"hook_event_name":"SessionStart","session_id":"B","cwd":"/home/user/src/other-project","source":"startup"}
  6. {"hook_event_name":"UserPromptSubmit","session_id":"B","cwd":"/home/user/src/other-project","prompt":"x"}
expected: |
  `other-project` with no branch (or its own branch once known).
evidence: |
  boardView after 5 and 6: `other-project · fix/refund-flow`. In the emulator: `WORKING +7  r8 · 機…-第二版`
  (/tmp/qa2-shots/g-cap-01-nine-working.png), where the branch belongs to an earlier session in another repo, and
  `DONE +1  x · featur…tial-captures` (g-cjk-10-done-+1.png). Cause: at the last SessionEnd the session's repo and
  branch are copied into `board.context`, RevviewStarting does not clear the context, and `boardView` uses
  `s.branch ?? b.context.branch` for every session without its own branch. A session-less RevviewContext does the
  same to every session. Bench item 10 expects "the repository and that branch"; this shows a wrong one.
---
