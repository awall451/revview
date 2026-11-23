# Revview

Try the display on your laptop, no Pi needed: [docs/EMULATOR-LAPTOP.md](docs/EMULATOR-LAPTOP.md).

Revview is a glanceable dashboard display for hands-free Claude Code while
driving. A Raspberry Pi 4 Model B with a 7.9" 1280×400 bar screen sits on the dash
and runs Claude Code natively; a button on the steering wheel is push-to-talk (Claude
Code's own `/voice` tap mode). The screen shows what Claude is doing in a
one-second glance, like a car radio: state first (working / waiting for me /
needs permission / done), then the current tool and file, the diff size as
`+N −N`, the last command and its last line of output. Read
`docs/DESIGN.md` before planning anything.

What this team builds is the **software**, in this order:

1. **The glance view.** A program that takes Claude Code hook events (tool
   start/stop, notification, stop) and keeps a small state, and a renderer that
   draws that state full-screen at 1280×400: big type, high contrast, colour
   for state, readable in a glance, no scrolling to follow along. The view is
   a web page that Chromium shows in kiosk mode on the Pi, so it can be
   tested here exactly as it will look: **an emulator of the 7.9" panel**
   (a 1280×400 browser viewport, the panel's physical size, so type sizes can
   be judged in millimetres) driven by Playwright. QA validates every change
   in that emulator, in each state, with recorded hook events, and
   `tools/check` takes one screenshot per state from it for the owner's gallery.
2. **Hook wiring.** The Claude Code settings and hook scripts that feed the
   view, and an optional spoken summary on Stop (local text-to-speech).
3. **Push-to-talk input.** Mapping a button (USB/Bluetooth keyboard key or
   GPIO) to Claude Code's push-to-talk key.
4. **The Pi image.** Scripts that turn a fresh Raspberry Pi OS into the
   appliance: kiosk start on boot, rotation, quiet boot, clean behaviour when
   power is cut. Write them carefully and document them; they cannot run here.

Done when I can flash a Pi, plug in the screen, mic and button, sit in my
car, and drive a whole Claude Code task by voice while the bar tells me at a
glance what is happening.

**This VM has no Pi, screen, microphone, button or car.** The hardware is in
`docs/DESIGN.md` (Pi 4B; a PoE HAT is for the bench only, so nothing may depend
on Ethernet). Never claim
something works on hardware. For anything that can only be proven on the
real device, write the steps for me to try in `docs/BENCH-TEST.md` and mark
it untested. Reading live car data (OBD-II / CAN) is a possible later goal
(see `docs/DESIGN.md`); do not start it unless I ask.

## On the Pi

Read in this order:

1. [pi/README.md](pi/README.md): set-up from a fresh flash to the bar, then its "First drive (parked)" section
   ([link](pi/README.md#first-drive-parked)).
2. [docs/BENCH-TEST.md](docs/BENCH-TEST.md): the "First afternoon" list at its top, the ids to try before the first
   useful drive, each with what it needs first. Every other section is reference, for later.
3. [docs/REVOKE.md](docs/REVOKE.md): what to do if the Pi or the key stick is lost or stolen.
4. [hooks/README.md](hooks/README.md): the Claude Code hooks that feed the bar.

## Plan and design

- [docs/DESIGN.md](docs/DESIGN.md)
- [docs/BENCH-TEST.md](docs/BENCH-TEST.md)

## Checks

```bash
bash tools/check /tmp/check-out
```

The gate runs the same script on every submitted branch.

## Run the live view

```bash
npm start        # live server on http://127.0.0.1:8138/ (loopback only)
```

Claude Code hook events are POSTed to `/event`; the page at `/` follows them. Details in
[src/server/README.md](src/server/README.md); the view itself in [src/view/README.md](src/view/README.md).
