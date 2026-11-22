---
id: qa-20261122-07
title: On an UNKNOWN or STARTING board, the SessionEnd of a session the board never saw shows CLAUDE EXITED "No Claude Code session running"
severity: minor
area: state (board)
how to reproduce: |
  Restart the server (board UNKNOWN), POST {"session_id":"u1","cwd":"/home/user/src/revview","hook_event_name":"SessionEnd","reason":"prompt_input_exit"}.
  Same after {"hook_event_name":"RevviewStarting"} with SessionEnd of id "zz".
expected: |
  The board did not know which sessions exist, so one SessionEnd proves only that this one ended: stay UNKNOWN
  (or say that one session ended) rather than claim no Claude is running.
evidence: |
  Emulator: /tmp/qa2-shots/e-00-unknown-then-sessionend.png and e-03-starting-then-sessionend-unknown-id.png both
  show `CLAUDE EXITED / No Claude Code session running / Voice input goes nowhere`. Case: two terminals open, the
  server restarts (power blip of the server only, or a crash with restart-on-failure as DECISIONS asks), the driver
  closes one; the other still takes voice, the bar says voice goes nowhere. This contradicts the honest-states
  principle "a state is shown only when the events prove it". (With exactly one session it is right.)
---
