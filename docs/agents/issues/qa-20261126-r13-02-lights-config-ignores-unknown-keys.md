---
id: qa-20261126-r13-02
title: config/lights.json silently ignores misspelt keys ("led", "brightnes"): the defaults apply with no log line
severity: minor
area: src/lights/config.js (lights config), consistency with the speech config and keymap
---
## What happens

`loadLightsConfig` checks only the keys it knows and ignores every other key without a word. A typo therefore falls
back to the default silently:
- `"brightnes": { "day": 5 }` (owner wants dim LEDs) -> the default cap 48 applies, almost 10x brighter, and nothing in
  the log says the setting was not read.
- `"led": 3` (three LEDs chained) -> 8 LEDs are driven.

The other hand-edited configs of the project refuse unknown keys: `src/speech/config.js:28` throws
`unknown key "<k>"` (keys starting with `_` are comments, as here), and `src/input/keymap.js:30` fails with
`unknown field (allowed: ...)`. The lights config, which is the one that decides how bright LEDs in a dark cab are, is
the only one that does not.

## How to reproduce

```
printf '{"lights":"on","driver":"none","brightnes":{"day":5},"led":3,"colour_order":"RGB"}' > /tmp/c7.json
node src/server/index.js 18704 --dev-bridge --lights-config /tmp/c7.json
curl -s localhost:18704/dev/lights
```

## Evidence

Log: `lights: on (no driver, 8 LEDs, untested on hardware)`, no warning. `/dev/lights`:
`{"lights":"on","frame":[[0,0,0] x 8],"dayCap":48}` (8 LEDs, day cap 48, not 3 and 5).
For comparison, in the same round every wrong value was refused with a clear line (not JSON, empty file, `"lights":
true`, `"ON"`, `"leds": "8"`, 0, 100, brightness 200, `[]`, a device with `; rm -rf /`, a missing file): each gave
`lights config: ...` plus `lights: none (bad lights config, see the log)`, and the server kept serving (`/state` 200).

Expected (as the speech config): `lights config: unknown key "brightnes"` and no lights feature, or at least a
warning line naming the ignored key.
