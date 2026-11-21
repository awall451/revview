---
id: qa-20261121-03
title: Two Claude sessions posting at once are merged into one state; one session's idle hides the other's permission prompt
severity: major
area: state
how to reproduce: |
  Session A (session_id aaaa, cwd /home/user/src/revview) and B (bbbb, cwd /home/user/src/other-project):
  SessionStart A, UserPromptSubmit A, PreToolUse A Bash; SessionStart B; UserPromptSubmit A and B;
  PreToolUse A Edit and PreToolUse B Bash in parallel; Stop B; Notification A permission_prompt;
  Notification B idle_prompt.
evidence: |
  Emulator: after B's Stop the view says DONE while A is still working; after A's permission_prompt
  and then B's idle_prompt it says `WAITING FOR ME` with `$ cargo build --release` (B's command); A's
  pending permission is not visible anywhere (/tmp/qa-shots/qa-003-permission-hidden-by-other-session.png).
  The repo label also switches to the last SessionStart's cwd. The reducer never reads `session_id`
  (src/state/reducer.js). Nothing in DESIGN/DECISIONS says only one session may exist; a second terminal,
  a resumed session or a `claude -p` job on the Pi all post to the same port. At minimum
  "needs permission" from any session should win, or the single-session assumption should be written
  down and enforced (e.g. ignore events from a session other than the current one).
---
