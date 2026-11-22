# Pi set-up: from a fresh flash to the bar

Stage 4, parts A and B: a fresh Raspberry Pi OS Trixie arm64 (desktop, labwc / Wayland) on a Pi 4B with the 7.9" 1280x400
panel becomes the appliance: power on, straight into the bar, Claude sessions feeding it. NOTHING HERE WAS RUN ON A
PI (part B too: it is written, not run). The file edits were tested only against a fake root in a temp dir (`tests/unit/pi-*.test.js`); everything else is
in `docs/BENCH-TEST.md` (P1-P14 for part A, B1-B17 for part B, and D/W/R/H items), all `untested`. Commands and names marked *(from memory)* could
not be checked here (documentation sites are not reachable from the team's VM). Decisions: `docs/DECISIONS.md`
"stage 4A". Part B (read-only root, encrypted data partition with the key stick, Piper) is described below; decisions in "stage 4B". If the Pi or the stick is lost: `docs/REVOKE.md`.

## Files

| File | What |
|---|---|
| `install.sh` | The one script to run, as root. Idempotent: re-run it any time. `--dry-run` shows what it would do; `--root DIR` works on a copy of a file tree (tests). |
| `setup.mjs` | Called by `install.sh`: every file edit and generated file (below). Pure functions, unit-tested. |
| `kiosk.sh` | The kiosk respawn loop: Chromium on the boot page, restarted when it exits; pause markers. |
| `revview.service` | systemd USER unit template of the server: `--input --sessions --boot --netmon`, never `--dev-bridge`, no ordering on the kiosk. |
| `70-revview-dongle.rules` | udev rule for the wheel-button dongle (group `input`). Its USB ids are a placeholder. |
| `lib.sh` | Sourced by the other scripts: reads the mount table; refuses to write when `/` is the read-only overlay or `/boot/firmware` is read-only. |
| `readonly.sh` | `status`, `enable`, `disable` of the read-only root (raspi-config's overlay file system and read-only boot partition). Run last. |
| `data-setup.sh` | Makes (with `--format`) or registers the encrypted data partition and the key stick; moves `~/.claude`, `~/repos`, `~/.ssh` onto it. Run by hand. |
| `data.mjs` | Called by `data-setup.sh`: checks the devices and writes the configuration files (`/etc/revview/data.conf`, `data.env`, the profile script, the unit, the udev rule). |
| `files.mjs` | The file writer shared by `setup.mjs` and `data.mjs`: atomic writes, backups, symlink refusal. |
| `unlock.sh` | Run as root at boot and when the stick is plugged in: opens and mounts the data with the key file on the stick. |
| `revview-unlock.service` | System unit template that runs `unlock.sh` (installed by `data-setup.sh`). |
| `72-revview-key.rules` | udev rule template: the stick's UUID starts the unlock when it is plugged in late. |

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
     gets `quiet loglevel=0 logo.nologo vt.global_cursor_default=0` (kept on ONE line, CRLF becomes LF). It also
     drops `fbcon=rotate:N` and any earlier `video=<connector>:...` token that has `rotate=` (what an earlier run
     with another `--output` wrote); a `video=` without `rotate=` of yours is kept. **If no token starts with
     `root=`** (empty or damaged file) the file is left byte-identical, a warning is printed and the installer exits
     1 after doing the rest: repair the file and run it again;
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

   Every file it changes that existed before is copied once to `<file>.revview-backup`. Files are written through a
   temporary file in the same directory and a rename (on the FAT boot partition that is still the best available).
   It never writes through a symlink: a target that is a symlink (also `~/.config/labwc/autostart`) is skipped, a
   warning is printed and the exit code is 1. `REVVIEW_DIR` must match `^/[A-Za-z0-9._/-]+$`; a `--root` that only
   resolves to `/` is refused (pass `/`). `/etc/lightdm/lightdm.conf` gets the autologin in every `[Seat:*]` section.
   When packages are missing it runs `apt-get update` first. Exit codes: 0 done, 2 bad arguments (nothing written),
   1 a file was refused (the rest is done).
8. **Settings** (optional), in `/etc/revview/server.env` (one `KEY=value` per line, no quotes):
   - `REVVIEW_START=/home/NAME/my-repo`: at key-on a Claude session starts there by itself. Without it, start one from
     the bar's menu (New session) once you are parked;
   - `REVVIEW_PROJECTS=/path/to/projects.json`: the folders the menu offers (`config/projects.example.json`);
   - `REVVIEW_NETMON_HOST=host:port`: what the network check connects to (default `api.anthropic.com:443`).
9. **Reboot**: `sudo reboot`. Expected: a quiet boot, the desktop logs in by itself, the bar shows NO LINK for a
   moment, then STARTING, then your session.
10. **Dongle ids**, once the real dongle exists: read them with `lsusb` and `/proc/bus/input/devices` (bench W1, D5),
    put the same ids in `pi/70-revview-dongle.rules` and `config/buttons.json`, and run the installer again.

## Encrypted data and the key stick

Everything here is part B: written without a Pi, not run. Names and options marked *(from memory)* could not be
checked.

**What lives on the encrypted partition** (mounted on `/srv/revview-data`; the home holds symlinks to it):
`~/.claude` (the sign-in, settings, transcripts, and the former `~/.claude.json`, which moves inside it through
`CLAUDE_CONFIG_DIR`), `~/repos`, and `~/.ssh` (push credentials). **What stays on the root**, so the bar works while
the data is locked: `~/.config/labwc`, `~/.config/revview`, the program in `/opt/revview`, `/etc/revview`.

**1. Make a partition for it** *(from memory, untested)*. After the first boot the root fills the whole card. Either
shrink the root with gparted on ANOTHER Linux computer (card in a reader) and add a third partition, or use a second
USB drive as the data device. It must not be the key stick. Do not make a file system on it: `data-setup.sh --format`
does.

**2. Put your repositories in `~/repos` BEFORE the set-up.** Set `REVVIEW_START` and the project paths under
`~/repos` (step 8 above). Keep the projects file in `/etc/revview`: it holds only paths, so the menu works while the
data is locked.

**3. Sign in to Claude Code before or after.** A sign-in made before the set-up existed unencrypted on the card, and
flash may keep the old copy. Sign in again after the set-up (and replace old push keys): `docs/REVOKE.md`.

**4. Find the names.** `lsblk -o NAME,PATH,TYPE,FSTYPE,SIZE,LABEL,TRAN,MOUNTPOINTS` lists them. The data device is a
partition such as `/dev/sda1` or `/dev/mmcblk0p3`; the key stick is a USB partition (FAT, exFAT or ext4; FAT or exFAT preferred: an ext4 stick replays its journal
even when mounted read-only) such as `/dev/sdb1`. The script never guesses either. Install the tool if it is missing: `sudo apt install cryptsetup`
*(from memory: it may already be there)*.

**5. Dry run, then format.**

```
sudo bash /opt/revview/pi/data-setup.sh --user NAME --device /dev/X --key-device /dev/Y --dry-run
sudo bash /opt/revview/pi/data-setup.sh --user NAME --device /dev/X --key-device /dev/Y --format
```

The dry run checks both devices, prints every command it would run and changes nothing. With `--format` it first
prints what it found and `--format will ERASE /dev/X ...`, then asks `Type /dev/X to ERASE it:`: type the device
name again (or give `--confirm /dev/X` when there is no terminal). It then makes the key file on the stick (4096
random bytes, never on the Pi's root), makes the partition encrypted (LUKS2, Adiantum), and asks for a RECOVERY
PASSPHRASE from cryptsetup: write it down and keep it apart from the Pi and the stick
(`--no-recovery-passphrase` skips it, and then a lost stick means lost data). It makes the file system, moves your
`~/.claude`, `~/.ssh` and `~/repos` onto it, writes the configuration and ends with `done. Next:` and a WARNING: the
old copies were deleted from the SD card, but flash may still hold them, so sign in to Claude Code again and replace
push keys. Without `--format` it only writes the configuration for a partition that is already encrypted.

Exit codes: 0 done; 1 something failed after work had started (read the messages, fix, run again); 2 refused before
anything was changed. It refuses, in plain words: a device that is not in `lsblk`; a whole disk instead of a
partition; a mounted device, or one with something on it; the data device on the same disk as the key stick; a key
stick that is not on USB, is mounted, has another file system or has no UUID; no confirmation; the read-only root
being on; and, without `--format`, a device that is not already encrypted.

**SSH login keys move too.** `~/.ssh` goes onto the encrypted partition whole, `authorized_keys` included: while the
data is locked, logging in to the Pi over SSH with a key does not work (a password login still does, if you allow it).
Keep a keyboard or password login for the times you boot without the stick.

**6. Reboot with the stick in.** Then `echo $CLAUDE_CONFIG_DIR` in a terminal should print `/home/NAME/.claude`: it
comes from `/etc/profile.d/revview-claude.sh`, and for the server (and every Claude it starts) from
`/etc/revview/data.env`. Run `install.sh` again if it said hooks were skipped.

**How the unlock works.** `revview-unlock.service` runs `unlock.sh` at boot. If the stick is not in yet, plugging
it in later starts the same service (`72-revview-key.rules`). The script mounts the stick read-only for a moment,
hands the key file's path to cryptsetup, unmounts the stick, checks the file system, and mounts the data. The key is
never copied, printed or logged. Pull the stick while the Pi runs: nothing happens, the data stays open until
power-off (and is locked again at the next boot without the stick). While LOCKED the bar shows INSERT KEY ("Insert
the key stick to unlock"). The bar, the network check, the buttons, the menu and read aloud work; no Claude session
starts (the key-on session waits) and New session is refused. When the data unlocks, the bar goes to STARTING and
the key-on session starts once. Log: `journalctl -u revview-unlock -b`. By hand: `sudo bash /opt/revview/pi/unlock.sh`.

## Read-only root (run last)

```
sudo bash /opt/revview/pi/readonly.sh status
sudo bash /opt/revview/pi/readonly.sh enable
sudo reboot
```

It uses raspi-config's overlay file system and its read-only boot partition option *(from memory: names and
effects are unchecked)*. After the reboot nothing on the card's root or boot partition is written while driving; the
only thing written is the data partition. A power cut can lose the last seconds of writes there (a transcript line,
a file being saved), not the system. Anything you change on the root afterwards is gone at the next boot: see
Updating. Swap: check `swapon --show` *(from memory: Trixie may use zram, which is fine; a swap FILE on the root
makes no sense under the overlay)*. Run this step LAST, after the install, the data set-up and Piper.

## Updating

1. `sudo bash /opt/revview/pi/readonly.sh disable` (round 1: turns the overlay off). Reboot.
2. `sudo bash /opt/revview/pi/readonly.sh disable` again (round 2: turns the read-only boot partition off).
3. `sudo apt update && sudo apt full-upgrade`.
4. `sudo git -C /opt/revview pull && cd /opt/revview && sudo npm ci` (or however the repository got there). The
   repository must stay owned by root and not writable by your user: the unlock runs `pi/unlock.sh` from it as root,
   and `data-setup.sh` refuses a path your user could change. Never `chown` it to your user.
5. `claude update`, as the kiosk user, with the data unlocked (the stick in). Claude's own auto-updater is off
   (`DISABLE_AUTOUPDATER=1` in the unit): under the overlay it would write to memory and the update would vanish.
6. Run `install.sh` again (step 7). It refuses (exit 2, nothing written) under the overlay, and when `/boot/firmware`
   is read-only: that is the sign that step 1 or 2 is missing.
7. `sudo bash /opt/revview/pi/readonly.sh enable`, then reboot.

## Piper (better voice for read aloud)

*(All from memory, unverified. No script installs it: a download whose checksum we cannot know here is not put in a
script.)* Without Piper, `espeak-ng` is used (the fallback). Do this with the overlay off.

1. On the Pi, download the aarch64 release `piper_linux_aarch64.tar.gz` of `rhasspy/piper` (release `2023.11.14-2`)
   from GitHub. Check it against the release page.
2. `sudo tar -xzf piper_linux_aarch64.tar.gz -C /opt` (gives `/opt/piper/piper`).
3. Download the voice `en_US-lessac-medium.onnx` and its `en_US-lessac-medium.onnx.json` from the
   `rhasspy/piper-voices` repository on Hugging Face into `/opt/piper/voices/`.
4. Test: `echo 'Hello from revview.' | /opt/piper/piper --model /opt/piper/voices/en_US-lessac-medium.onnx --output-raw | aplay -r 22050 -f S16_LE -t raw -`
5. Restart the server: `systemctl --user restart revview`. The log line `speech: piper` shows it was picked
   (`journalctl --user -u revview -b`).

Newer Piper versions (`piper1-gpl`, a Python package) have a different command line: `config/speech.json` would
need changing. The paths in that file are the ones above.

## Day to day

- Server status and log, as the kiosk user: `systemctl --user status revview`, `journalctl --user -u revview -b`.
  Restart it: `systemctl --user restart revview` (the Claude sessions in tmux survive, bench D3).
- See the Claude sessions: `tmux -L revview attach` (detach with Ctrl+B then D).
- **Pause the kiosk** (to use the desktop): `mkdir -p ~/.config/revview && touch ~/.config/revview/kiosk-paused`,
  then close the running Chromium yourself (the marker only stops a new one from starting; it does not stop one
  that is running); remove the file to bring it back (within about 5 s). If you cannot get to a terminal: put the
  SD card in another computer and create an empty file `revview-kiosk-paused` in its boot partition.
- Change rotation or user: run the installer again with the new options; it rewrites only what differs.
- Undo: the `.revview-backup` copies are the files as they were before the first install.

## How it fits together

- **Boot**: `revview-unlock.service` (a system unit, only after the data set-up) opens the data with the stick. Lingering starts the user's systemd manager at boot, which starts `revview.service`; the unit reads `/etc/revview/data.env`, which passes `--data-lock` (via `REVVIEW_DATA_MOUNT`) and `CLAUDE_CONFIG_DIR`. The server decides "locked" from the kernel's mount table, so the bar shows INSERT KEY until the data is mounted. A posted `RevviewDataLock` is only a poke (`src/server/README.md`). The server applies
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
- **Read aloud**: `espeak-ng` is installed; Piper is optional (section Piper). The user unit runs inside the user's audio session.

## Not done here

Nothing of part B was run on a Pi (bench items B1-B17). No script installs Piper. No shutdown HAT or ignition wiring
(not needed with the read-only root). Clevis/Tang unlock and a password prompt at boot are not done (DESIGN: later,
maybe). See DECISIONS "stage 4B".
