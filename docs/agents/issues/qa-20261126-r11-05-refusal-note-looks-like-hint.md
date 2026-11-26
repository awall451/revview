---
id: qa-20261126-r11-05
title: Refusal notes under CLAUDE ASKS use the same grey type as the hint row, so "Not sent" is hard to tell from the instructions in a glance
severity: small
area: src/view/view.js (note row style under the asking view)
reproduce: |
  --live, a question, Esc in the terminal, press on the bar (or ?state= with a note). Look at 1280x400.
evidence: |
  Hint "Allow picks · Deny cancels" and note "Not sent: the question is not waiting any more": both 4.86 mm,
  rgb(184,184,184) on black, one under the other (screenshots st-pick-note-long.png, live-notwaiting.png).
---
The highlighted option is clear (inverted lime block with a white frame, not colour alone: good). But the outcome of a
press (refused, too early) is a grey line that looks like one more hint line. Expected: a refusal stands out from the
hint (e.g. white or inverted), since it is the only feedback that nothing was sent.
