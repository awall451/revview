# Pi set-up: from a fresh flash to the bar

Stage 4, part A: a fresh Raspberry Pi OS Trixie arm64 (desktop, labwc / Wayland) on a Pi 4B with the 7.9" 1280x400
panel becomes the appliance: power on, straight into the bar, Claude sessions feeding it. NOTHING HERE WAS RUN ON A
PI. The file edits were tested only against a fake root in a temp dir (`tests/unit/pi-*.test.js`); everything else is
in `docs/BENCH-TEST.md` (P1-P14, and D/W/R/H items), all `untested`. Commands and names marked *(from memory)* could
not be checked here (documentation sites are not reachable from the team's VM). Decisions: `docs/DECISIONS.md`
"stage 4A". Part B (read-only root, encrypted data partition with the key stick, Piper, power cuts) is not built.

## Files

| File | What |
|---|---|
| `install.sh` | The one script to run, as root. Idempotent: re-run it any time. `--dry-run` shows what it would do; `--root DIR` works on a copy of a file tree (tests). |
| `setup.mjs` | Called by `install.sh`: every file edit and generated file (below). Pure functions, unit-tested. |
| `kiosk.sh` | The kiosk respawn loop: Chromium on the boot page, restarted when it exits; pause markers. |
| `revview.service` | systemd USER unit template of the server: `--input --sessions --boot --netmon`, never `--dev-bridge`, no ordering on the kiosk. |
| `70-revview-dongle.rules` | udev rule for the wheel-button dongle (group `input`). Its USB ids are a placeholder. |

## Who runs what

ONE ordinary login user, the one the desktop logs in as automatically (you choose the name; it does not have to be
`pi`). That user runs the kiosk Chromium, the revview server (a systemd user unit, started at boot through
"lingering") and the Claude sessions (in revview's own tmux server, `tmux -L revview`). Claude Code's sign-in, its
settings and hooks and your repositories are in that user's home. The user is put in groups `input` (wheel buttons)
and `audio`. The older set-up's `revview` system user is no longer used.

## Steps

1. **Flash** Raspberry Pi OS (64-bit, with desktop; Trixie) with Raspberry Pi Imager. In the Imager's OS
   customisation *(from memory)*: set the user name and password (this is the kiosk user), the Wi-Fi of your phone's
   hotspot (5 GHz if the phone has it), the time zone, and turn on SSH if you want to work from a laptop.
2. **Wire it**: the panel's HDMI to the Pi's HDMI0 (the micro-HDMI port next to the USB-C power socket), the panel's
   touch USB cable, the USB mic, the wheel-button dongle (or any USB keyboard to start with). Power the panel from its
   own 5 V port at high brightness. Boot once and let the first-boot set-up finish.
3. **Update**: `sudo apt update && sudo apt full-upgrade -y`, reboot.
4. **Node 22 or newer**: `node --version`. If it is missing or older than 22, install Node 22 system-wide (outside
   your home; for example from NodeSource *(from memory)*). The installer checks it and never installs it.
5. **The repository**: put it in `/opt/revview` (outside the home: part B will encrypt the home's data, and the bar
   must run while that is locked), owned by root and readable by everyone, then `cd /opt/revview && sudo npm ci`.
6. **Claude Code**, as the kiosk user (not root): install it with Anthropic's native installer *(from memory:
   `curl -fsSL https://claude.ai/install.sh | bash`, which puts `claude` in `~/.local/bin`)*, then run `claude` once
   in a terminal and sign in with your claude.ai account. Set up `/voice` and its key as in `docs/BUTTONS.md`.
7. **Run the installer**, as root:

   ```
   sudo bash /opt/revview/pi/install.sh --user NAME --dry-run /opt/revview   # look first
   sudo bash /opt/revview/pi/install.sh --user NAME /opt/revview
   ```

   Options: `--rotate 270` if the panel is mounted the other way up (180 degrees), `--output HDMI-A-2` if the panel is
   on the other port, `--no-apt` to skip packages. It prints one line per thing it did. What it does:
   - packages (only the missing ones): `chromium tmux python3 espeak-ng wlr-randr` *(names from memory)*;
   - groups `input` and `audio` for the user;
   - quiet boot: `/boot/firmware/config.txt` gets `disable_splash=1`; `/boot/firmware/cmdline.txt` loses `splash` and
     gets `quiet loglevel=0 logo.nologo vt.global_cursor_default=0` (kept on ONE line);
   - rotation, all three parts (they must agree): the console on the kernel command line
     (`video=HDMI-A-1:400x1280M@60,rotate=90`), the picture in the labwc autostart (`wlr-randr --output HDMI-A-1
     --transform 90`), the touch in `/etc/udev/rules.d/71-revview-touch.rules`;
   - autologin: `autologin-user=NAME` in `/etc/lightdm/lightdm.conf` *(from memory)*; if that file does not exist it
     says so, and you turn on Desktop Autologin in `sudo raspi-config` (System Options, Boot / Auto Login);
   - the kiosk: `~/.config/labwc/autostart` (rotation, then `kiosk.sh`). It replaces the desktop's own autostart, so
     there is no panel, no desktop and no icons. An autostart you had before is saved as `autostart.revview-backup`;
   - the server: `/etc/systemd/user/revview.service`, enabled, lingering on for the user;
   - the dongle udev rule; `/etc/revview/server.env` (only if missing; all settings commented out);
   - the Claude Code hooks for the user (`hooks/install.mjs`, into `~/.claude/settings.json`);
   - an old `/etc/systemd/system/revview.service` from the earlier set-up is disabled and removed.

   Every file it changes that existed before is copied once to `<file>.revview-backup`.
8. **Settings** (optional), in `/etc/revview/server.env` (one `KEY=value` per line, no quotes):
   - `REVVIEW_START=/home/NAME/my-repo`: at key-on a Claude session starts there by itself. Without it, start one from
     the bar's menu (New session) once you are parked;
   - `REVVIEW_PROJECTS=/path/to/projects.json`: the folders the menu offers (`config/projects.example.json`);
   - `REVVIEW_NETMON_HOST=host:port`: what the network check connects to (default `api.anthropic.com:443`).
9. **Reboot**: `sudo reboot`. Expected: a quiet boot, the desktop logs in by itself, the bar shows NO LINK for a
   moment, then STARTING, then your session.
10. **Dongle ids**, once the real dongle exists: read them with `lsusb` and `/proc/bus/input/devices` (bench W1, D5),
    put the same ids in `pi/70-revview-dongle.rules` and `config/buttons.json`, and run the installer again.

## Day to day

- Server status and log, as the kiosk user: `systemctl --user status revview`, `journalctl --user -u revview -b`.
  Restart it: `systemctl --user restart revview` (the Claude sessions in tmux survive, bench D3).
- See the Claude sessions: `tmux -L revview attach` (detach with Ctrl+B then D).
- **Pause the kiosk** (to use the desktop): `mkdir -p ~/.config/revview && touch ~/.config/revview/kiosk-paused`,
  then close Chromium; remove the file to bring it back (within about 5 s). If you cannot get to a terminal: put the
  SD card in another computer and create an empty file `revview-kiosk-paused` in its boot partition.
- Change rotation or user: run the installer again with the new options; it rewrites only what differs.
- Undo: the `.revview-backup` copies are the files as they were before the first install.

## How it fits together

- **Boot**: lingering starts the user's systemd manager at boot, which starts `revview.service`. The server applies
  STARTING to the bar itself (`--boot`) and, when no revview tmux window exists (after a power cut there is none),
  starts the `REVVIEW_START` session once it is listening, so that session's first hook reaches the bar. After a
  server restart the surviving window is picked up and nothing new starts.
- **Kiosk**: labwc runs `~/.config/labwc/autostart` at login; `kiosk.sh` starts Chromium on
  `file:///opt/revview/src/view/boot.html?port=8138`, which shows NO LINK until the server answers and then opens
  `http://127.0.0.1:8138/`. The Chromium profile lives in `$XDG_RUNTIME_DIR` (memory only): fresh each boot, so no
  "restore pages" after a power cut and no browser writes to the SD card. Chromium is restarted 1 s after it exits
  (longer if it keeps dying). Neither the kiosk nor the server waits for the other.
- **Network** (`--netmon`): every 10 s the server checks for a default route on any interface (Wi-Fi hotspot, or the
  bench's Ethernet; nothing depends on either) and opens a TCP connection to the Claude API host. Two failures in a
  row show OFFLINE; one success clears it.
- **Buttons**: `src/input` finds the dongle by the USB ids in `config/buttons.json`; the user's `input` group lets the
  server read and grab it; a missing dongle shows NO BUTTONS and is retried.
- **Read aloud**: `espeak-ng` is installed; Piper is part B. The user unit runs inside the user's audio session.

## Not done here (part B and later)

Read-only root / overlay, the LUKS data partition unlocked from the key stick (`RevviewDataLock`, INSERT KEY),
`docs/REVOKE.md`, Piper, power-cut behaviour. See DECISIONS "stage 4A", "Where part B hooks in".
