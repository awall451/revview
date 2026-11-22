# Input layer (wheel buttons)

Raw key events from the wheel-button dongle in, named button gestures out. Phase WB2 of `docs/BUTTONS.md`:
it stops at gestures. Nothing acts on Claude Code yet (WB3). Nothing here was tried on hardware.

| File | What |
|---|---|
| `keys.js` | Linux key codes (F1-F24, modifiers), `MODIFIER_KIND`, `BROWSER_CODES` (KeyboardEvent.code to Linux code, for the dev bridge). Browser-safe. |
| `keymap.js` | `loadConfig(path)` / `parseConfig(obj)`: validates `config/buttons.json`. Any error is a `ConfigError` naming the file and field. |
| `gestures.js` | `createGestureDetector({bindings, timing, clock, emit})`: pure, time only from the injected clock. |
| `evdev.js` | `struct input_event` parser (chunk-safe) and `encodeEvent` for tests. |
| `devices.js` | `/proc/bus/input/devices` parser and `matchDevice`. |
| `reader.js` | `createDeviceReader`: find, open (with or without the grab), report presence, re-open after loss. |
| `grab.py` | The grab helper: python3 standard library, `EVIOCGRAB`, copies raw bytes to stdout. |
| `index.js` | `createInputPipeline` (detector only) and `startInput` (reader + detector). |

## Config (`config/buttons.json`)

`device` picks the dongle: `name`, `vendor`, `product` (4 hex digits) matched against `/proc/bus/input/devices`,
or a fixed `path` (e.g. `/dev/input/by-id/...`, or a FIFO as a fake device with `"grab": false`). `buttons` maps a
key (`"F13"`, or a combo like `"Shift+F24"`) to a button name, with `hold` and `longHold` flags. `timing` is optional
(defaults 30 / 400 / 1000 ms). Unknown fields are errors. The shipped ids (ZMK's default 1d50:615e) and the key
codes are not verified: bench items 27 and W1.

## Gestures

- Kernel auto-repeat (value 2) is ignored. A press within `debounceMs` of the same key's release is ignored.
- A button with neither `hold` nor `longHold` fires `tap` on press (lowest latency).
- Otherwise: released before `holdMs` is a `tap`; `hold` fires at `holdMs` while held; `long-hold` at
  `longHoldMs`. A release after `holdMs` gives no tap (a long-hold-only button released between the two gives
  nothing).
- `reset()` when the device is lost (or the kernel reports `SYN_DROPPED`): a key still down gives no gesture.
- Times are arrival times on a monotonic clock, not the kernel's event timestamps.

## struct input_event

Assumed: 64-bit userspace (Raspberry Pi OS Trixie arm64, as in `docs/DESIGN.md`; also x86-64): 8-byte
`tv_sec`, 8-byte `tv_usec`, u16 type, u16 code, s32 value = 24 bytes, little-endian. 32-bit userspace (armhf)
uses 16 bytes; `createEventParser({size: 16})` handles it but nothing selects it automatically. The
`B: KEY=` bitmap in `/proc/bus/input/devices` is read as 64-bit words (a 64-bit kernel).

## Running

`node src/server/index.js --input [config path]` runs the reader inside the server (presence goes to the
state core as `RevviewInput`, gestures to `GET /buttons`). `--dev-bridge` adds `POST /dev/key`, fed by the page
at `/?devkeys=1`: the same detector, for the emulator. See `src/server/README.md`.

## Tests

`tests/unit/input-*.test.js` and `server-input.test.js`: fake clock traces (synthetic, not from a device),
constructed byte streams, a synthetic `/proc` sample (`tests/unit/fixtures/input/`), a FIFO as the fake device.
`grab.py` is tested only where the grab fails (a regular file: ENOTTY; a missing path). The real grab, key
codes and reconnect are bench items 27-33 and W1-W3 in `docs/BENCH-TEST.md`.
