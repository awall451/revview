# Pi set-up (dongle and server)

Only what the wheel-button dongle needs. The rest of the Pi image (charter stage 4: kiosk, boot, screen, data
partition) is not built. Nothing here was run on a Pi or with a dongle: all of it is untested, see
`docs/BENCH-TEST.md` items D1 to D12.

| File | What |
|---|---|
| `70-revview-dongle.rules` | udev: group `input`, mode 0660 and an optional symlink for the dongle's USB ids. The ids are a placeholder. |
| `revview.service` | systemd unit for the server: `--input --sessions`, never `--dev-bridge`, user `revview`, no ordering on the kiosk. |
| `install.sh` | Creates the user, installs the rule and the unit, enables the service. Needs root. |

## How the server finds the dongle

`src/input/devices.js` reads `/proc/bus/input/devices` and takes the first `kbd` event node whose `vendor`,
`product` and `name` match `device` in `config/buttons.json` and that has one of the mapped keys. So config alone is
enough: put the real USB ids in `device.vendor` and `device.product`. The udev symlink is only a fallback
(`"device": {"path": "/dev/input/revview-dongle"}`). The reader does not need a udev rule to find the device.
Matching by a fixed path or by USB id needs no new code.

## Permission without root

Event nodes belong to group `input`. The unit runs as user `revview` with `SupplementaryGroups=input`, so the node
can be read and grabbed (`EVIOCGRAB` in `src/input/grab.py`). The server also needs `python3` (the grab helper uses
only its standard library) and `tmux` (sessions). Check with bench W2.

## Ordering

The unit has no `Requires=`, `Wants=` or `After=` on the kiosk, the network or the dongle, and the kiosk has none on
the unit. Either can start first. If the server is late the kiosk shows NO LINK (bench 22). If the dongle is
absent the reader retries (every second, then backing off) and the view shows NO BUTTONS. Neither waits for the
other (bench D2).

## Read aloud (untested)

`config/speech.json` lists the engines. It needs `apt install espeak-ng` (the fallback, in Debian 12; version from
memory). Piper is a manual install to `/opt/piper` (the program and the voice `en_US-lessac-medium.onnx`; the
release and file names are from memory) and needs `alsa-utils` for `aplay`. The service user is in group `audio`
to open the sound card. With no engine the server logs it and the read-aloud button does nothing. See DECISIONS
"wheel buttons 5" and bench R1 to R14.

## Install

1. Put this repository on the Pi, e.g. `/opt/revview`, with `npm ci` done. Node 22 or newer (bench 25).
2. After the dongle exists: read its ids with `lsusb` and `/proc/bus/input/devices` (bench W1, D5). Edit
   `pi/70-revview-dongle.rules` and `config/buttons.json` so both have the same ids.
3. `sudo bash pi/install.sh /opt/revview`
4. `systemctl status revview` and `journalctl -u revview -n 50`. Expect `input: reading wheel buttons`.
5. Optional: `/etc/revview/server.env` with `REVVIEW_PROJECTS=/path/to/projects.json` (a line, no quotes).

Open points, all untested: `KillMode=process` in the unit is meant to keep the tmux sessions alive across a
service restart (bench D3); `claude` in the sessions needs its own sign-in for user `revview` (not set up here).
The bar only gets events once the hooks are installed for that same user: `node /opt/revview/hooks/install.mjs`
(see `hooks/README.md`, bench H1-H7). `install.sh` does not do it yet, since the sessions' user is not decided.
Stage 4 also has to send the boot/network events: `RevviewStarting` on key-on, `RevviewNetwork`, `RevviewDataLock`
(DECISIONS "stage 2 hook wiring").
