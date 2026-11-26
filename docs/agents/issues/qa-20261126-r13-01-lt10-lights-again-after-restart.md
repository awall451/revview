---
id: qa-20261126-r13-01
title: Bench LT10 expects the LEDs to "light again" after a kill -9 restart, but a Settings-row "on" is not kept over a restart
severity: minor
area: docs/BENCH-TEST.md group LT (lights), honesty of the expected result
---
## What the docs say

`docs/BENCH-TEST.md` LT10: "`kill -9` the node server with LEDs lit | The LEDs go dark shortly (the helper sees EOF on
its stdin); the service restarts and lights again".

The same docs say the Settings row is not kept over a restart and the shipped config is off:
- `config/lights.json`: `"lights": "off"`; its `_comment`: "the Settings row "Lights" turns them on or off until the
  server restarts".
- `docs/BENCH-TEST.md` LT3: "after a service restart it is back to what `config/lights.json` says".
- `pi/README.md` Lights, Enable: "use the Settings row "Lights" (not kept over a restart)".

So on the default install (the only way the bench tester gets the LEDs lit is LT3's Settings row), after LT10's kill -9
the restarted service starts with `"lights": "off"` and the LEDs stay dark. LT10's "lights again" is only true when
`config/lights.json` itself says `"on"`, which LT10 does not ask for. A bench tester following LT1-LT10 in order will
see a "failure" that is the documented behaviour (or worse, mark LT10 passed after re-enabling by hand).

## How to reproduce (emulator, no Pi)

1. `node src/server/index.js 18707 --dev-bridge --dev-keys config/buttons.laptop.json --lights-config <file with "lights":"off">`
   (the repo default), post a SessionStart + UserPromptSubmit to `/event`.
2. Settings, the Lights row, Enter: `GET /dev/lights` shows `"lights":"on"` and a lit frame.
3. `kill -9` the server, start it again with the same arguments: the log says `lights: off (...)`, `/dev/lights`
   shows `"lights":"off"` and an all-dark frame; posting events keeps it dark.

## Evidence

Code: `src/server/live.js:84` sets `board.lights` from `lights.config.lights` at every start; nothing stores the
row's value. Seen in this round: the server started with off-spi.json logs `lights: off`, and no helper is started
(`pgrep -f '[s]pi-helper'` empty, the fake spidev log has 0 lines) until the row is pressed.

## Suggested direction (for the owner of the doc)

LT10 either sets `"lights": "on"` in `config/lights.json` first, or expects "the service restarts; the LEDs stay dark
until switched on again (the row is not kept)".
