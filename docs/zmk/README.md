# ZMK reference for the dongle and pods

A starting point for the firmware, to be built and flashed by the owner. **None of it was checked against the ZMK
docs and none of it was built or run.** One fetch of `https://zmk.dev/docs` through the proxy failed (not
reachable from the build VM, no other route tried), so every ZMK detail below, in `wheel.keymap` and in
`wheel.conf`, is **from memory, not checked against the ZMK docs, untested**. Node names, option names, units and
defaults may be wrong or out of date. Check each one against the docs and the ZMK version you build.

## What the firmware does

Only sends plain keys. No hold-tap, no layers, no macros for hold. Hold and long hold are detected on the Pi
(`src/input/gestures.js`, `timing` in `config/buttons.json`). The key for each position is the table in
`docs/BUTTONS.md` section 1, and `config/buttons.json` is the matching key map (a test keeps them equal).

| Key | Button | Pod |
|---|---|---|
| F13 | push-to-talk | voice |
| F14 | read-aloud | voice |
| F15 | cancel | voice |
| F16 | deny | voice |
| F17 | up | navigation |
| F18 | down | navigation |
| F19 | left | navigation |
| F20 | right | navigation |
| F21 | press | navigation |
| F22 | back | navigation |
| F23 | menu | navigation |
| F24 | spare | navigation (either) |

## Layout (from memory)

- The dongle is the split **central**: it is plugged into the Pi and shows up as a USB keyboard. It has no keys.
- Each pod is a split **peripheral** with a coin cell: a voice pod (4 keys) and a navigation pod (8 keys). Two
  peripherals on one central needs a ZMK version that supports it (from memory: since 2024) and a matrix
  transform that gives each pod its own range of positions.
- Positions 0-3 are the voice pod, 4-11 the navigation pod. A real board needs its own devicetree for the 5-way
  switch pins and the dongle; `wheel.keymap` shows only the key part.

## Files

| File | What |
|---|---|
| `wheel.keymap` | The 12 plain keys, one layer. A sketch: not a complete board or shield definition. |
| `wheel.conf` | Central and peripheral options: split roles, sleep, power, connection interval. |

## Coin cell (from memory)

- Pods sleep after a time without keys (`CONFIG_ZMK_SLEEP`, `CONFIG_ZMK_IDLE_SLEEP_TIMEOUT`, milliseconds) and wake
  on a key press. Wake from deep sleep needs the key pins marked as wake-up sources in the devicetree. The first
  press after sleep may be lost if that is wrong: bench 29 and D8.
- Power from a CR2032 limits current: lower radio power and no LEDs or displays on the pods. Battery life is bench
  39 and D12.
- A longer BLE connection interval saves battery and costs latency. Latency is bench 31 and D10.

## Not decided here

The boards, the switch part and the ZMK docs domain are open questions for the owner: `docs/BUTTONS.md` section 9.
Whether the dongle's USB ids stay ZMK's defaults (1d50:615e, from memory) is bench W1 and D5.
