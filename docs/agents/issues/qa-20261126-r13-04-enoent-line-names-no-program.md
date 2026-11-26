---
id: qa-20261126-r13-04
title: "LED driver stopped (cannot start: ENOENT)" does not say which program is missing
severity: polish
area: src/lights/ws2812.js (driver log line)
---
## What happens

When the helper's interpreter cannot be started, the one log line is
`lights: LED driver stopped (cannot start: ENOENT); the LEDs stay off until the server restarts`. It does not name
`python3` (nor the helper path), so a reader of `journalctl --user-unit=revview` has to read the source to learn what
was not found. The other failure lines are self-explaining (`exit 3: no spidev module (install python3-spidev)`,
`exit 1: <helper stderr>`, `the helper is not reading its input`).

## How to reproduce

```
mkdir -p /tmp/nopy && ln -s "$(command -v node)" /tmp/nopy/node
printf '{"lights":"on","leds":8,"driver":"ws2812-spi"}' > /tmp/on-spi.json
PATH=/tmp/nopy /tmp/nopy/node src/server/index.js 18706 --dev-bridge --lights-config /tmp/on-spi.json
```

## Evidence

Log line 3 of that run: `lights: LED driver stopped (cannot start: ENOENT); the LEDs stay off until the server
restarts`. The server kept serving (`/state` 200). Code: `src/lights/ws2812.js` `c.on('error', ...)` uses only
`e.code`; `argv[0]` is at hand there. Low impact on a Pi (python3 is always installed), hence polish.
