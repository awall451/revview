# Revview design

What Revview is, the hardware it targets and why, and what goes on the screen. The team's goal and rules
are in the charter; this file is background for planning.

## The problem

Coding by voice while driving today means holding the phone: unlock, open Claude, tap the mic. Two problems:

1. **Input:** the phone has to be held and poked to talk.
2. **Output:** there is no way to see what Claude is doing.

Revview fixes both: a display in the driving sightline that can be glanced at like a radio, and a
push-to-talk button on the steering wheel.

## Requirements

| Need | Notes |
|---|---|
| Glanceable output | Read in a radio-length glance. Big type, few lines, no scrolling to follow along. |
| Push-to-talk without touching the phone | One button on the wheel. Tap, speak, done. |
| Works in daylight | The hard one. A hood/visor and a matte film on the screen. |
| Boots on ignition, no fiddling | Power on, straight into the interface. |
| Survives a car | Power cuts at key-off, heat on the dash, cabin noise for the mic. |
| Room to grow | Other glance views later on the same box. |

## Architecture: Claude Code runs on the Pi

Claude Code's voice dictation (`/voice`) is the push-to-talk:

- The key is rebindable (`voice:pushToTalk` in `~/.claude/keybindings.json`).
- **Tap mode** is the wheel-button behaviour: tap, speak, tap again; it submits itself (transcripts of 3+
  words). Recording also stops after 15 s of silence.
- It **needs a local microphone**: dictation does not work over SSH or in cloud sessions. So Claude Code runs
  on the device with the mic, natively on the Pi, not as a terminal into another machine. It also needs a
  claude.ai login (not an API key).

Docs: <https://code.claude.com/docs/en/voice-dictation>

## Hardware (owner's side; the team cannot test it)

| Part | Pick | Notes |
|---|---|---|
| Computer | **Raspberry Pi 4 Model B**, Raspberry Pi OS Trixie arm64 (labwc / Wayland) | Claude Code runs on ARM64 Linux. Power: 5 V / 3 A over USB-C. Video out is **micro-HDMI**: use HDMI0 (the port next to the USB-C power socket). |
| Screen | Waveshare 7.9" HDMI LCD, 400×1280 native, mounted landscape → **1280×400** | Sold for the Pi 4B. A micro-HDMI to HDMI cable or adapter to the Pi's HDMI0. 300–530 cd/m², capacitive touch over a separate USB cable, 470–640 mA at 5 V: at high brightness feed it from its own 5 V port rather than the Pi's USB. |
| Power | A 12 V → USB-C car adapter rated 5 V / 3 A, or a car Pi HAT with ignition-sense safe shutdown | 3 A is enough for the Pi 4B with the mic and button; an under-powered supply shows the lightning-bolt warning and throttles. Power is cut at key-off: see "Survives a car" (clean shutdown or a read-only root). |
| Mic | USB mic near the visor or A-pillar | Cabin noise is the big unknown. |
| Button | **Two coin-cell wireless pods on the wheel (ZMK on nRF52840, a split keyboard) plus an nRF52840 USB dongle in the Pi.** Not bought yet. | The Pi sees ONE USB HID keyboard from the first second of boot, with no pairing on the Pi. The pods send F13-F24 and a few combos. Voice pod on the 9 o'clock spoke (push-to-talk, read aloud, cancel, deny); navigation pod on the lower-right spoke (up, down, left, right, press, back, menu). **keyd is replaced by revview's own reader** of the dongle (exclusive grab, key map in config; proposal, the owner to confirm): keyd only remaps a key to a key, and some actions are not keys. Details, the input layer and the evidence: `docs/BUTTONS.md`. Strap pods to the rim or a spoke, never over the airbag cover. |
| Network | Phone hotspot over Wi-Fi | Prefer the hotspot's 5 GHz band if the phone has it (the Pi 4B supports it): it keeps Wi-Fi out of the button's 2.4 GHz band. |
| Audio out | The Pi 4B's own 3.5 mm jack (or the screen's jack over HDMI) → car AUX | For spoken replies. |
| PoE HAT (owned) | **Bench only** | Power and wired network over one Ethernet cable while developing on the desk (phase 1). Not in the car: there is no PoE there, and the HAT covers the GPIO header a GPIO button or a power HAT would need. Nothing in the software may depend on Ethernet; in the car the network is the phone hotspot over Wi-Fi. |

Screen: <https://www.waveshare.com/7.9inch-hdmi-lcd.htm> · wiki <https://www.waveshare.com/wiki/7.9inch_HDMI_LCD>

### Known Pi settings (from a working build with the same panel on a Pi 5; check each on the Pi 4B)

- **Rotation needs three things to agree** on Trixie + labwc:
  1. Console: `video=HDMI-A-1:400x1280M@60,rotate=90` in `/boot/firmware/cmdline.txt` (Wayland ignores it).
  2. Display: `wlr-randr --output HDMI-A-1 --transform 90` in `~/.config/labwc/autostart`.
  3. Touch: labwc does not rotate this panel's touch. udev rule:
     `ATTRS{idVendor}=="0712", ATTRS{idProduct}=="000a", ENV{LIBINPUT_CALIBRATION_MATRIX}="0 -1 1 1 0 0"`.
     For a 180° flipped mount: transform `270`, matrix `0 1 0 -1 0 1`.
- Current Pi OS drives the Pi 4B with KMS (`dtoverlay=vc4-kms-v3d`), so the mode goes on the kernel
  command line as above; the Waveshare wiki's `hdmi_group`/`hdmi_timings` lines are only for the old
  legacy display driver.
- The Pi 4B's USB ports share 1.2 A: the mic and a button are fine; power the screen from its own port.
- (`usb_max_current_enable=1` from the Pi 5 build does not apply to a Pi 4B.)
- **Kiosk:** start the app from `~/.config/labwc/autostart` through a respawn loop; a marker file pauses it
  for development.
- **Quiet boot:** `disable_splash=1`; remove `splash` and add
  `quiet loglevel=0 logo.nologo vt.global_cursor_default=0`; black desktop, no icons.
- The Pi 4B has a 3.5 mm jack: the simplest audio path to the car's AUX.
- Expect roughly 40–50 s from power to UI on a stock Pi 5 image, somewhat more on a Pi 4B; faster is a goal,
  not a given.

## What goes on the screen

1280×400 is a strip. Design for a one-second glance, not for reading:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ● WORKING   my-repo · main               Edit src/app.py          +42 −3     │
│ $ pytest -q                                                                  │
│ ✓ 18 passed  ✗ 1 failed   test_auth.py: expected 200, got 401                │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **State first, in colour:** working / waiting for me / needs permission / done. The one thing worth a glance.
- Current tool and target file, the diff as `+N −N` (never the diff itself), last command, last line of output.
- Claude Code hooks (tool start/stop, notification, stop) feed the view. A Stop hook can read the final
  summary aloud (local TTS) so most of the time there is no need to look.
- **The view is a web page** shown by Chromium in kiosk mode on the Pi. In development it runs in an
  emulator of the 7.9" panel: a 1280×400 viewport at the panel's physical size (about 190 × 60 mm of
  active area), driven by Playwright. QA checks every change there, and the gate saves one screenshot per
  state for the owner's gallery.
- Touch is for when parked. Nothing while moving should need it.
- Permission prompts need a plan: a permissive allow-list on the Pi so it rarely asks, or buttons for "yes" and "no"
  (allow and deny on the wheel, answered through a waiting PermissionRequest hook: `docs/BUTTONS.md`, section 2).

## Living in a car: what else to design for

- **Power is cut at key-off, mid-write** (open: propose one). An SD card that loses power while writing gets corrupted sooner or
  later. Either a read-only root (overlay file system) with the repositories and Claude Code's state on a
  separate writable partition that is synced often, or a small UPS / ignition-sense HAT that shuts the Pi down
  cleanly. Decide which; the image scripts follow from it.
- **Secrets on a device that can be stolen** (decided). The Pi holds a claude.ai login, the repositories and whatever
  lets it push code. Two layers:
  - **Encrypt the data, unlock it with a key you carry.** The repositories, Claude Code's settings and login,
    and the push credentials live on a LUKS-encrypted partition. It unlocks at boot from a key file on a small
    USB stick on the car keychain: stick in, it unlocks with no typing; stick out (you took your keys), the
    data stays locked and the view says "insert key". The Pi 4B has no AES instructions, so use the
    **Adiantum** cipher (`cryptsetup --cipher xchacha12,aes-adiantum-plain64`), which is fast without them.
    The operating system itself can stay unencrypted and read-only. There is no password prompt at boot.
  - **Credentials that can be taken back.** A per-repository deploy key or a fine-grained token with the
    least access, never a personal key with everything. `docs/REVOKE.md` says how to revoke the Claude login
    and each key if the Pi or the stick goes missing.
  - Voice is not a lock: a voice can be recorded and replayed, and cabin noise makes speaker recognition
    unreliable. Possession of the key stick is the factor. (A Pi has no TPM; a TPM HAT would only stop someone
    who takes the SD card out, not someone who takes the whole Pi.)
  - Later, maybe: network-bound unlock (Clevis and a Tang server reached over a private network), so a stolen
    Pi can be locked out from home even with the stick.
- **No signal** (decided). Tunnels and dead zones drop the hotspot, and voice transcription needs the network. The view
  needs an "offline" state, and a dictation that failed must say so, not vanish.
- **What Claude may do unattended while you drive** (decided). A permissive allow-list for ordinary work;
  nothing destructive (no force pushes, no deleting outside the repo, no deploys) without a confirmation that
  waits until you are parked.
- **Heat.** A Pi 4B throttles at about 80 °C, and a dash in summer sun gets hotter than that. A case that is a
  heatsink and no direct sun on it. **Later (not now):** the view shows when the Pi is throttling. (The PoE
  HAT's fan is not in the car.)
- **Boot to ready** (decided). Key-on to a working push-to-talk takes the better part of a minute: the view
  shows "starting" until Claude Code is really ready (and "insert key" while the data is locked).

## Phases

| Phase | What |
|---|---|
| 0 | Bench test the interaction on a laptop: `/voice` tap mode, push-to-talk on a spare key. |
| 1 | Pi on the desk: Pi 4B + screen + USB mic, Claude Code native, boots into the interface (the PoE HAT can power it and give it wired network here). |
| 2 | In the car: power with clean shutdown, dash mount with hood, wheel button. |
| 3 | Glance UI: the big-type view driven by hooks, spoken replies. |
| 4 | Maybe: a small, very bright projected status display showing only the agent state. |

## Later: live car data from the ECU

Not in scope until the owner asks. A small car strip next to the Claude view: RPM, speed, coolant temp,
fuel, check-engine codes, read from the **OBD-II** port (US cars 1996+; CAN bus from 2008).

| Path | Hardware | Pi side |
|---|---|---|
| ELM327 adapter (start here) | USB dongle, preferably STN-chip based | `python-OBD`, standard mode-01 PIDs |
| CAN HAT | Pi CAN HAT + OBD-to-DB9 cable | SocketCAN `can0`, `can-utils`, `python-can` |
| Raw bus decode | Same CAN HAT | `candump` + a DBC file (opendbc) |

Rules: read only (raw CAN in listen-only mode); power the Pi from an ignition-switched source, never OBD
pin 16 (always on). In the sandbox: `vcan0` replaying recorded `candump` logs, or an ELM327 emulator.

## Safety and law

Glance only: no alerts that demand staring, nothing that needs touch while moving. Some places restrict
screens in the driver's view or anything mounted on the windshield; a dash-top bar below the sightline is
the safer shape.
