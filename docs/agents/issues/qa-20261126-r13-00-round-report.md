---
id: qa-20261126-r13-00
title: QA round r13 (cycle 69) - gate/main bd54ec6: lights per project (owner issue #34)
severity: report
area: lights (src/lights, --lights-config, Settings row Lights, emulator --lights, /dev/lights, docs)
---
Checkout: worktree /tmp/qa-r13 of gate/main bd54ec6 on branch work/qa-20261126-r13, `npm ci` there (dev tools only);
no full tools/check (the gate ran it). Driven with Playwright headless Chromium at 1280x440 (panel 1280x400 plus the
LED strip); screenshots read by me. No Pi, no LED, no SPI device here: nothing below proves anything on hardware.

Servers: `emulator/run.sh --no-browser --port 18701 --lights` (demo), plus `node src/server/index.js 187xx
--dev-bridge ... --lights-config <file>` for hand-posted hook events and the awkward configs. All stopped at the end.

## What was tested and seen

**Demo with --lights (run.sh, port 18701)**
- Server log: no lights line in run.sh's output beyond the demo lines; `GET /dev/lights` answers
  `{"lights":"on","frame":[[18,33,48],...],"dayCap":48}` right after start (lights on, as the guide says for --lights).
- All 10 demo scenes driven with keys 1-9, 0; `/dev/lights` sampled every 40 ms for 4.5 s per scene and the strip's
  `data-rgb` read. Colours recomputed by hand from the hex in frames.js with cap 48 (`round(c*48/255)`):
  working #5eb1ff -> 18,33,48; waiting #c8a2ff -> 38,30,48; permission #ffb020 -> 48,33,6; done #4fdc7a -> 15,41,23;
  asking #e6f25a -> 43,46,17. All five match the frames seen. LED order = bar order (scene 1: LED1 blue = the shown
  WORKING session, LEDs 2-3 lilac = the two others waiting, "+2"). CLAUDE EXITED (scene 7): all 8 dark. OFFLINE and
  INSERT KEY: LEDs keep the session states (documented: overlays not on the LEDs).
- Slow flash measured from the frame transitions: on/off edges at about 1000 ms steps (e.g. 42, 1036, 2071, 3065,
  4054 ms in scene 4), i.e. 1 s on / 1 s off as documented. Steady states (working, done) never changed between samples.
- Screenshot scene-1 at 1280x440: strip of 8 round LEDs below the panel, blue, lilac, lilac, five dark grey; panel
  unchanged.

**Hand-posted hook events (node src/server/index.js 18702/18703/18708, driver none)**
- Lights off at start (config off): Settings row order Voice, Wheel buttons, Sessions, Projects, Sounds, Lights, Look
  (screenshot settings-lights-row.png); the row reads "Lights: off"; Enter -> "Lights: on" and the first lit frame
  2 ms later; Enter again -> all dark 1 ms later. Log lines `lights: on` / `lights: off`. Without a sounds feature (a
  bad `--speech` file) the row moves up one (Projects, Lights, Look) and still toggles. `RevviewLights` posted over
  HTTP: 403.
- Three sessions working / done / failed (StopFailure): LED1 18,33,48 steady, LED2 15,41,23 steady, LED3 38,30,48
  flashing with edges every 250 +- 15 ms (2 Hz). Night (Look row): 4,8,12 / 4,10,6 / 9,8,12 - recomputed by hand with
  cap 12, all match; "auto, night now" gives the same night cap; back to day -> 48 cap. Flash stops at once on a state
  change: failed -> UserPromptSubmit = 30 samples steady blue; permission Notification -> amber 48,33,6 slow flash;
  PostToolUse -> steady blue.
- 10 sessions posted: the board keeps 8 (the bar's existing cap; the 9th/10th push out the oldest working ones) and
  the LEDs follow; frame [done, working x4, done x3] equals the Sessions list on screen (p4 DONE, p5-p8, p9 DONE, ...)
  including its colour squares (list-8.png). One session ended (SessionEnd s5): the later LEDs move up one, LED8
  dark. Order replayed through `reduceBoard` by hand: a dropped session that posts again comes back at the end.
- Panel pixels: same server, page at 1280x400 without `lights=1` and at 1280x440 with it, top 1280x400 clipped: PNGs
  byte-identical in 3 of 3 tries.

**Driver and helper (stand-ins, no SPI)**
- Real `spi-helper.py` with a fake `spidev` module on PYTHONPATH (logs every writebytes2): opened bus 0 dev 0,
  mode 0, 2.4 MHz; every line decoded back by my own decoder (GRB, 3 SPI bits per bit, 100/110 only, 90 zero reset
  bytes) to exactly the `/dev/lights` frames; fast flash reaches the helper in 250 ms steps. SIGTERM to node: dark frames
  written, helper `close`, no helper left, node exit 0. SIGKILL to node: helper got EOF, wrote dark, exited; none left.
- Lights off at start with ws2812-spi: no helper process, 0 SPI writes; 21 quick toggles (60 ms apart) -> exactly
  one helper, row and frame agree at the end ("on", lit).
- Real python3 without spidev: `lights: LED driver stopped (exit 3: no spidev module (install python3-spidev))`,
  once; server serves.
- Stand-in that exits at once: `(exit 1: stand-in: boom)`, once. No python3 on PATH: `(cannot start: ENOENT)` (r13-04).
- Stand-in that never reads stdin, 320 events in 3 s: `(the helper is not reading its input)` once, the stand-in
  killed, RSS 69 -> 75 MB during the burst and flat after, `/state` 200. SIGTERM with such a helper: node exits after
  1014 ms (the 1 s wait), no process left.
- Bad configs (not JSON, empty, lights true / "ON", leds "8" / 0 / 100, brightness.day 200, `[]`, device with
  `; rm -rf /`, missing file): each one line `lights config: ...` naming the key and the value, `lights: none (bad
  lights config, see the log)`, `/state` 200. Unknown keys are silently ignored (r13-02).

**Docs**
- pi/README wiring (pin 19 = GPIO10 MOSI, `/dev/spidev0.0`, 8 LEDs, GRB) agrees with the code and with PI-FACTS L8;
  bench LT1-LT12 all `untested`; PI-FACTS 11 marks timing, level and Pi 4 clock "from memory". The brightness
  arithmetic (11 mA at 48, 15 mA / 120 mA at 64) recomputed and right. Current and part values are unsourced (r13-03).
  LT10 contradicts the not-kept setting (r13-01). The guide's --lights section matches run.sh (on, 8 LEDs, driver
  none, 100 ms poll, x255/cap display). The --keys sheet does not mention Settings rows at all (nothing wrong there).
  Nothing in the docs says the LEDs work.

**Regression**
- Gallery spec + lights spec run alone: 43 passed. Shots looked at: permission.png, night-asking-choice.png,
  night-worst-cjk-wide-permission.png, and live scene-1 / scene-4 with the strip: nothing clipped or moved.
- Sounds row: cues -> cues and speech -> off -> cues. Look row: day -> night -> auto -> day; Lights unaffected.

## Findings
- r13-01 minor: bench LT10 expects the LEDs to light again after a kill -9 restart; the row's "on" is not kept.
- r13-02 minor: lights config silently ignores misspelt keys (brightness / leds typos fall back to defaults).
- r13-03 polish: pi/README current and part figures (20 mA, 1 mA idle, 330-470 ohm, 100-1000 uF) unsourced.
- r13-04 polish: `cannot start: ENOENT` does not name the missing program.

## Not tested
- Any real LED, SPI bus, level, colour as seen, brightness in a cab, power draw (bench LT1-LT12; known).
- A real window (`run.sh` without --no-browser); the strip was seen only in headless screenshots.
- The helper killed by SIGTERM directly (only via node); `KillMode=process` under real systemd; a helper stuck
  inside a kernel SPI write.
- Long runs (hours of flashing) for memory; only a 320-event burst and minutes of flashing.
- Screenshots were in /tmp/qa-r13-shots/ (scene-*.png, settings*.png, list-8.png, pix-*.png); removed with the round's temp files.
