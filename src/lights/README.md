# Lights

One WS2812B addressable RGB LED per session (up to 8), driven over the Pi's SPI MOSI (GPIO10). LED i shows the
state of session i, in bar order. Config: `config/lights.json` (`lights` off/on, `leds`, `driver`, `device`,
`brightness`); the Settings row sets `board.lights`.

**UNTESTED ON HARDWARE.** The encoding, the driver (against a fake process) and the frames are unit tested; the
Python helper is only compiled in the tests. Nothing here has driven a real LED.

## State to colour and pattern

| state | colour (bar day colour) | pattern |
|---|---|---|
| working | #5eb1ff | steady |
| done | #4fdc7a | steady |
| starting | #e0e0e0 | steady |
| unknown | #5ce1e6 | steady |
| permission | #ffb020 | slow flash, 1 s on / 1 s off |
| asking | #e6f25a | slow flash |
| waiting | #c8a2ff | slow flash |
| failed | #c8a2ff (the waiting band) | fast flash, 250 ms on / 250 ms off (2 Hz, the fastest allowed) |

No session = dark. Lights off = all dark, but nothing is sent to the driver (so no helper process exists) until the lights
have been on once; after that, off sends a dark frame and the helper stays. LEDs left lit by a hard kill stay lit while the
lights are off, until power-off. The flash phase is `floor(now / half) % 2`, from absolute time, so all LEDs
flash in step. `classify.js` derives the state like the bar does: a pending question/plan is asking, any other
pending prompt or activity permission is permission, then failed, then starting, then the activity.

## Brightness

`brightness.day` / `brightness.night` (whole numbers 1..64) cap any channel: `channel = round(c * cap / 255)`.
Night is the board's effective look (day / night / auto).

## Driver interface

`show(frame)` (frame = array of `leds` `[r, g, b]`, 0..255) and `close()` (a promise). `createSpiDriver` is the
WS2812B one; `createNullDriver` (`driver: "none"`) does nothing. A plain-RGB LED driver would be a second driver
with the same two methods. `createLights` keeps one 250 ms timer only while something flashes and lights are on,
and calls `show` only when the frame changed. Nothing throws.

## SPI encoding and protocol

SPI at 2.4 MHz, mode 0: each data bit becomes 3 SPI bits (1 -> `110`, 0 -> `100`), so 9 bytes per LED in G, R, B
order, MSB first, then 90 zero bytes (300 us low) as the reset. The driver starts `spi-helper.py` (python3 with
`python3-spidev`) on the first frame only, and writes one line per frame to its stdin: the lowercase hex of the SPI
bytes. The helper exits 3 when the spidev module is missing and 4 when the device cannot be opened.

## Failure and stop

A spawn error, a write error (EPIPE) or an early helper exit logs ONE line (`lights: LED driver stopped (...)`),
and the driver stays dead until the server restarts; the child is killed (SIGKILL) when the driver dies. A write error
waits for the helper's own exit so the line carries its stderr (`cannot open /dev/spidev0.0`), with a short fallback.
While the helper's stdin is full only the latest frame is held and sent on `drain`; no drain for 3 s is a failure. Clean stop: `close()` shows a dark frame, ends stdin, waits up
to a second for the helper, then SIGKILL. If Node crashes, the helper sees EOF on stdin and writes a dark frame. If
the helper itself is killed with SIGKILL, or the power is cut, the LEDs keep the last colour until the next
power-up or the next frame.
