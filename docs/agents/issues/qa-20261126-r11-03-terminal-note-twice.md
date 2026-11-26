---
id: qa-20261126-r11-03
title: Pressing on a multi-select / several-questions ask prints "Answer in the terminal when parked" twice (hint row and note), and nothing on the bar says that deny cancels it
severity: small
area: src/view/view.js (hint row + note), src/sessions/actions.js TERMINAL_NOTE
reproduce: |
  --live, ask Claude for an AskUserQuestion with multiSelect true ("Which toppings?" Cheese/Ham/Olives), wait 2.5 s, Enter.
evidence: |
  bar text: "... 1 Cheese 2 Ham 3 Olives Answer in the terminal when parked Answer in the terminal when parked"
  (screenshot live-multi-press.png: two identical grey lines). N then cancelled it ("Question cancelled"), which the
  bar never told the driver.
---
Expected: the note is not repeated when it equals the hint, and the terminal-ask hint mentions "Deny cancels".
