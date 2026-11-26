---
id: qa-20261126-r12-00
title: QA round r12 (cycle 63) - gate/main d8c49e7: #29 how long and how far, #30 night and day looks
severity: report
area: band clock, QUIET mark and cue, tasks N/M, look day/night/auto, menu hold, laptop guide
---
Checkout: detached worktree /tmp/qa-r12 of gate/main d8c49e7, `npm ci` there (dev tools only); no full tools/check
(the gate ran it). Driven with Playwright headless Chromium at 1280x400; screenshots read by me.
Servers: `emulator/run.sh --no-browser --port 18601` (demo) and `node src/server/index.js 18602 --dev-bridge
--dev-keys config/buttons.laptop.json --quiet-minutes 0.1` (hand-posted hook events), plus short-lived ones for the
look config and the cue player. All stopped at the end.

## What was tested and seen

**#30 looks**
- Hold M 600 ms on CLAUDE ASKS (demo key 0): look day -> night, the question, highlight and hint stay (no answer, no
  menu). Hold M on NEEDS PERMISSION (posted /permission): flips, prompt stays.
- Timing: M held 300 ms and 380 ms = tap (menu opens on release); 420, 500, 700, 2500, 3000 ms = flip, no menu.
  Hold with the session list open: flips, the list stays.
- Guide steps literally (M, Down, Down, Enter = Settings; Down to the last row, Enter x3) while WORKING with the clock
  running: "Look: night" -> "auto, day now" -> "day" -> "night", screen changes at once, clock keeps counting. Keys
  pressed with no pause between them lost one Down (landed on Projects): a laptop/test artefact of the 30 ms debounce,
  not filed.
- auto: hours set to the current hour -> night; same with `--clock-sync <missing file>` -> day and the log line
  "the clock is not set yet (no time sync yet)". Bad configs ("dusk", "25:00", not JSON) log and give day.
  from == to gives never night silently (r12-02).
- Night gallery sampled (12 states day vs night side by side, worst-time-marks/-mic, clock-asking, list-long, settings):
  no clipping or overlap seen; chosen ask option is an inverted amber block, clear; diff colours stay green/red (known).
  States are told apart only by glyph and word (r12-03).
**#29 time**
- Clock: counts once a second; resets on each class change (working -> permission -> working: 0:01 after the return).
  Not shown in DONE / WAITING (gallery). Format code checked by hand: 3 900 000 ms -> "1h05", 3 599 s -> "59:59",
  360 000 000 ms -> "99h+" (fit.js formatElapsed); gallery quiet.png shows 1h05 with QUIET 7 MIN.
- QUIET with 0.1 min: alpha (Bash sleep 600) got "QUIET 1 MIN" after about 6 s while beta kept posting Read events;
  list rows "alpha QUIET / beta WORKING"; Left/Right show each. Permission on the quiet session: QUIET gone, NEEDS
  PERMISSION 0:02; after a PostToolUse: WORKING 0:01, QUIET back after 6 s.
- Night then link loss (server stopped): NO LINK stays in the night look (data-look night), as documented.
- Sounds off (speech copy with "sounds": "off"): quiet mark set, fake player called 0 times.
- Quiet cue: with a fake cue player (cuePlayers -> a logging script), quiet.wav played once 6 s after the last event,
  and once more after an event and a new 6 s silence. No repeats in between.
- Demo scene 11: WORKING 0:00..0:37, "tasks 1/4" then "tasks 2/4" (recomputed from fixtures/sessions/task-list.jsonl
  and the 12 event indices in emulator/demo/scenes.js: tasks 1 and 2 completed of 4 created: 2/4, right); QUIET 1 MIN
  from about 0:37 for about 12 s, then the loop goes on (the guide's 36 s hold / 24 s is consistent).

## Findings
- r12-01 minor: guide says the --keys sheet lacks the menu hold; it shows it.
- r12-02 minor: config/look.json comment still states the rejected "year before 2026" rule; from == to undocumented.
- r12-03 minor (owner judgment): night states differ only by glyph and word; DECISIONS' "place" adds nothing.
- r12-04 polish: wb4-quiet.png shows UNKNOWN next to the new quiet.png.

## Not tested
- A real window (`run.sh` without --no-browser), any real Claude Code session, real wheel buttons, real panel, sun or
  night (bench N1-N10, T1-T6 all untested; nothing here proves anything about the device).
- Allow/deny answered from the bar under a hold (needs --sessions with tmux; the hold-under-permission case was only
  the "flip, prompt stays" part).
- A live session over an hour (only the formatter and the gallery's static 1h05); boot.html night (known N10); the
  64-timer limit; the `other` cue for another session's quiet mark.
- Screenshots used: /tmp/qa-r12-shots/ (bands.png, worst.png, d-*.png, q-*.png, p-*.png).
