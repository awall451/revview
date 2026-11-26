---
id: qa-20261126-r11-01
title: After the menu or the session list is opened and closed over CLAUDE ASKS, the hint row disappears and the question shrinks (8.28 mm to 5.48 mm) until the next change
severity: should fix
area: src/view/view.js (fit/layout of the asking view after nav closes)
reproduce: |
  Demo (emulator/run.sh --no-browser), Playwright 1280x400, ?devkeys=1. Key 0 (asking scene), wait 2.5 s, M, M.
  Or --live with a real question: M, M; or (multi-select ask) Down opens the list, Enter closes it.
evidence: |
  Before: "Which colour should the new file use?" 8.28 mm, hint row "Allow picks · Deny cancels" at y=273.
  100 ms, 1 s, 3 s and 8 s after closing the menu: question 5.48 mm (box 24,132,1232x41), no hint row in the DOM text;
  GET /state identical (choice 0, nav null, note null). A fresh page load or a Down tap restores it.
  Seen in the live trial too (Which fruit?, after M M; Which toppings?, after the list) - screenshot closed-100.png.
---
The hint row is the only thing on the bar that tells the driver what the buttons do under CLAUDE ASKS. A trip into the
menu (natural while a question waits: look at the session list / settings) silently removes it and shrinks the
question, while the state has not changed. Expected: the same layout as before the menu was opened.
