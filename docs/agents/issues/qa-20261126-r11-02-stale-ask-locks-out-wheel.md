---
id: qa-20261126-r11-02
title: A question that is no longer held (Esc in the terminal, or the 540 s hook timeout) leaves CLAUDE ASKS on the bar with no way out from the wheel: press/deny say "not waiting any more", push-to-talk says "Answer the prompt first"
severity: should fix
area: src/sessions/actions.js (askTarget/refuseAsk, push-to-talk refusal), board (pending entry of a dropped request), docs/BUTTONS.md section 10 "Not solved"
reproduce: |
  emulator/run.sh --live /tmp/qa11-proj (claude wrapper with --model haiku). Ask Claude to use AskUserQuestion
  ("Which tea?" Green/Black/Mint). When the bar shows CLAUDE ASKS, press Esc in the tmux pane. Then on the bar:
  Enter, Space, N; wait 90 s.
evidence: |
  pane: "Declined to answer Claude's questions", Claude idle at the prompt.
  bar: Enter -> "Not sent: the question is not waiting any more" (server log: action allow: not done (no-request));
  Space -> "Answer the prompt first" (action push-to-talk: not done (permission prompt shown));
  N -> "Not sent: the question is not waiting any more". After 90 s still CLAUDE ASKS, options and
  "Allow picks · Deny cancels" (no idle_prompt or other event came). Only a prompt typed in the terminal cleared it.
---
BUTTONS section 10 lists "a question dismissed with Esc stays on the bar until the next event" as not solved, but not
that it also blocks push-to-talk: the driver can neither answer, cancel nor speak, and the next event only comes
from the terminal. The server already knows at the press that the held request is gone (no-request).
In the 540 s timeout case (not tried: 9 minutes) the note "the question is not waiting any more" is also untrue: by the
design notes the picker would still wait in the terminal. Expected: after a no-request refusal the bar drops the
prompt (or at least lets push-to-talk through), and the timeout case says "Answer in the terminal when parked".
