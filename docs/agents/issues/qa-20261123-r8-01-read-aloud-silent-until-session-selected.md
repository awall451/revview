---
id: qa-20261123-r8-01
title: Demo: R (read aloud) is silent until a session was selected; guide says it "speaks on any machine with espeak-ng or Piper"
severity: minor
area: docs/EMULATOR-LAPTOP.md, emulator demo
---
Reproduce (fresh clone, espeak-ng on PATH, `bash emulator/run.sh --no-browser`, Playwright on the page):
open the view address, click, press 3 (done scene), P, then R tap.
Seen: nothing is spoken; server log says `action read-aloud: not done (no session selected)`.
After Left then Right (any navigation) and R: espeak-ng is started with `-v en-us -s 165` and gets "The command printed." on stdin.
Expected: guide ("R speaks on any machine that has espeak-ng or Piper installed") and sheet either say a session must be
picked first (Left/Right/Enter), or the demo selects one. The owner will press 3 then R and hear nothing.
Also: Piper only counts if it is at /opt/piper/piper with the lessac voice and `aplay` exists (config/speech.json,
itself marked "from memory and untested"); "any machine that has ... Piper installed" overstates this.

Status: fixed in 55e4728
