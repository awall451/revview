---
id: qa-20261121-02
title: A lost link to the server is drawn exactly like a real STARTING, with the text "Not ready for voice yet"
severity: major
area: view
how to reproduce: |
  Open the live page, drive it to any state (e.g. WAITING FOR ME), stop the server, wait 1.5 s, screenshot.
evidence: |
  Emulator: `[starting link=down] STARTING / "Not ready for voice yet"`; pixel-identical to the
  `starting` fixture except for `html[data-link]`, which the driver cannot see. view.js `down()` calls
  `render({ view: 'starting' })`. The README calls this honest ("a stale WORKING would be a lie"), but
  "Not ready for voice yet" is also a claim about Claude Code that the page cannot know: Claude may be
  working or waiting and voice may work fine; only the display lost its feed. The driver cannot tell a
  display fault (which will not fix itself if the server crashed for good) from a normal boot. A distinct
  word/shape (e.g. "NO LINK" / "display not updating") would be honest; DESIGN's state list does not
  cover this case, so it needs a decision.
---
