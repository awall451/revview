---
id: qa-20261126-r11-06
title: Laptop guide: "nine scenes" (there are ten), the scene-10 taps do not show on a jump, the "sounds" log line is not where the owner can see it, and the "copy of the config" has no way named to use it
severity: small
area: docs/EMULATOR-LAPTOP.md (What you see, Sounds)
reproduce: Read the section "What you see"; run emulator/run.sh --no-browser; press 0.
evidence: |
  - "It loops through nine scenes" and the list 1-9, while the keys sheet and the next paragraph name scene 10 (key 0, asking).
  - "the scene taps Down, Down, Up by itself first": only in watched play; a jump with key 0 posts no key steps
    (player.js jumpTo skips them), so the owner pressing 0 sees option 1, not the movement.
  - "its log says `sounds: cues, no cue player found (silent)`": run.sh writes the server log into its temp dir
    (/tmp/revview-emu.XXXX/server.log, removed at exit) and prints only the view/attach lines; the terminal never shows it.
  - "or set "sounds": "off" in a copy of the config": the guide never says how run.sh uses a copy; REVVIEW_SPEECH works
    (tested: run.sh passes the environment to the server) but is only named in BENCH-TEST R12/HW6.
---
