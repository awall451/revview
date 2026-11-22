---
id: qa-20261122-10
title: Every load of the live page paints an empty grey band first; the boot hand-over is not "no flash"
severity: polish
area: view
how to reproduce: |
  Open boot.html from file:// with no server, record painted frames (CDP Page.startScreencast), start the server.
expected: |
  Boot NO LINK straight to the first real state (DECISIONS: "The boot page and the live page both start at NO
  LINK, so the hand-over shows no flash").
evidence: |
  Painted frames (/tmp/qa2-shots/cast/f000-f002.png): boot NO LINK, then a frame with the band in `#b0b0b0` grey and
  no word or shape at all (f001, about 33 ms here), then UNKNOWN. The DOM also passes through the live NO LINK
  with "Display lost the revview server" for about 17 ms. The grey comes from `--band: #b0b0b0` in view.css before
  view.js (a module that awaits `document.fonts.ready`) renders. On the Pi 4 this lasts longer (slower CPU, cold
  cache); a grey band with no word is a state the driver has never seen. Not on BENCH-TEST.
---
