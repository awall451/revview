# Pi set-up: from a fresh flash to the bar

Stage 4, parts A and B: a fresh Raspberry Pi OS Trixie arm64 (desktop, labwc / Wayland) on a Pi 4B with the 7.9" 1280x400
panel becomes the appliance: power on, straight into the bar, Claude sessions feeding it. NOTHING HERE WAS RUN ON A
PI (part B too: it is written, not run). The file edits were tested only against a fake root in a temp dir (`tests/unit/pi-*.test.js`); everything else is
in `docs/BENCH-TEST.md` (P1-P21 for part A, S4B-1 to S4B-19 for part B, and the D, W, R, HW (Stage 2 hooks) and H (honest states) items), all `untested`. Commands and names marked *(from memory)* could
not be checked here (documentation sites are not reachable from the team's VM). Every such fact, including the ones
not marked here (package names, paths, keys, flags), is listed with how to check it in `docs/PI-FACTS.md`. Decisions: `docs/DECISIONS.md`
"stage 4A". Part B (read-only root, encrypted data partition with the key stick, Piper) is described below; decisions in "stage 4B". If the Pi or the stick is lost: `docs/REVOKE.md`.

## Files

| File | What |
|---|---|
| `install.sh` | The one script to run, as root. Idempotent: re-run it any time. `--dry-run` shows what it would do; `--root DIR` works on a copy of a file tree (tests). |
| `setup.mjs` | Called by `install.sh`: every file edit and generated file (below). Pure functions, unit-tested. |
| `kiosk.sh` | The kiosk respawn loop: Chromium on the boot page, restarted when it exits; pause markers. |
| `revview.service` | systemd USER unit template of the server: `--input --sessions --boot --netmon --thermal`, never `--dev-bridge`, no ordering on the kiosk. |
| `70-revview-dongle.rules` | udev rule TEMPLATE for the wheel-button dongle (group `input`): the installer fills in the USB ids of `/etc/revview/buttons.json` and writes the rule on every run. |
| `lib.sh` | Sourced by the other scripts: reads the mount table; refuses to write when `/` is the read-only overlay or `/boot/firmware` is read-only. |
| `readonly.sh` | `status`, `enable`, `disable` of the read-only root (raspi-config's overlay file system and read-only boot partition). Run last. |
| `data-setup.sh` | Makes (with `--format`) or registers the encrypted data partition and the key stick; moves `~/.claude`, `~/repos`, `~/.ssh` onto it. Run by hand. |
| `data.mjs` | Called by `data-setup.sh`: checks the devices and writes the configuration files (`/etc/revview/data.conf`, `data.env`, the profile script, the unit, the udev rule). |
| `files.mjs` | The file writer shared by `setup.mjs` and `data.mjs`: atomic writes, backups, symlink refusal. |
| `unlock.sh` | Run as root at boot and when the stick is plugged in: opens and mounts the data with the key file on the stick. |
| `revview-unlock.service` | System unit template that runs `unlock.sh` (installed by `data-setup.sh`). |
| `72-revview-key.rules` | udev rule template: the stick's UUID starts the unlock when it is plugged in late. |
| `backlight.sh` | **Untested**, not wired into anything: `backlight.sh day\|night\|<percent>` tries `/sys/class/backlight`, then `ddcutil`, else exits 3 (the HDMI panel probably has no software backlight; `docs/PI-FACTS.md` section 10). |
| `tree/` | Not for the Pi: development checks. `build.sh OUT` unpacks the real Trixie arm64 packages of `packages.lock` (about 140 MB download, never installed or run); `check.sh OUT` runs install.sh, readonly.sh and kiosk.sh against a copy and checks the names they use (`docs/PI-FACTS.md` section 9). Run on request, never by the gate. |

### Exit codes

| Program | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| `setup.mjs` | done | never (node's own: an import or syntax error) | bad arguments | unexpected error in main | a file refused or skipped |
| `data.mjs` (`check`, `write`) | done | never (node's own) | bad arguments | unexpected error, uncaught exception or unhandled rejection | devices not acceptable, a file refused or skipped, an untrusted path to `unlock.sh` |
| `install.sh` | done | something refused or skipped (setup's 4, so also a key map conflict) | bad arguments, a read-only root, or setup's 2 | `setup.mjs` failed part way (its 3 is passed on; any other code of it too) | not used |
| `data-setup.sh` | done | refused or failed after work started (data.mjs's 3 or 4 on the real write) | bad arguments, or refused before anything changed (any non-zero code of data.mjs's checks) | not used | not used |
| `unlock.sh` | unlocked, or no stick | any refusal or error | bad arguments, a bad `--root`, or not run as root | not used | not used |
| `readonly.sh` | done | raspi-config did not do what was expected | bad arguments or refused | not used | not used |

The `.mjs` programs keep refusal (4) apart from a crash (3) because node itself exits 1 for an error outside the
code's own handling; the shell scripts keep their own older codes.

## Who runs what

ONE ordinary login user, the one the desktop logs in as automatically (you choose the name; it does not have to be
`pi`). That user runs the kiosk Chromium, the revview server (a systemd user unit, started at boot through
"lingering") and the Claude sessions (in revview's own tmux server, `tmux -L revview`). Claude Code's sign-in, its
settings and hooks and your repositories are in that user's home. The user is put in groups `input` (wheel buttons)
`audio` and `video`. The older set-up's `revview` system user is no longer used.

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
   must run while that is locked), owned by root and readable by everyone. The Pi does not need Ethernet for this.
   - With the Pi on Wi-Fi (home Wi-Fi or the phone's hotspot): `sudo apt install git` if `git` is missing, then
     `sudo git clone https://github.com/awall451/revview /opt/revview`. Cloned with `sudo`, it is already owned by root. The repository is public at github.com/awall451/revview and can be cloned without a sign-in (not checked from the team's VM).
   - With no network on the Pi: copy the repository from a laptop (a USB stick, or `scp`/`rsync` over Wi-Fi into your
     home, then `sudo mv` it to `/opt/revview`) and make it root-owned and not writable by others:
     `sudo chown -R root:root /opt/revview && sudo chmod -R a+rX,go-w /opt/revview`.

   There is no `npm ci` step: the server, the hooks and the installer use only Node's standard library. `npm ci` would
   only install the dev tools for the checks (Playwright, ESLint), which the Pi never runs.
6. **Claude Code**, as the kiosk user (not root): install it with Anthropic's native installer *(from memory:
   `curl -fsSL https://claude.ai/install.sh | bash`, which puts `claude` in `~/.local/bin`)*, then run `claude` once
   in a terminal and sign in with your claude.ai account. Voice (`/voice tap`, the key stays on Space) is set up once after the install: see "First drive (parked)" at the end.
7. **Run the installer**, as root:

   ```
   sudo bash /opt/revview/pi/install.sh --user NAME --dry-run /opt/revview   # look first
   sudo bash /opt/revview/pi/install.sh --user NAME /opt/revview
   ```

   Options: `--rotate 270` if the panel is mounted the other way up (180 degrees), `--output HDMI-A-2` if the panel is
   on the other port, `--no-apt` to skip packages. It prints one line per thing it did. What it does:
   - packages (only the missing ones): `chromium tmux python3 espeak-ng wlr-randr sox overlayroot` *(names checked against the Trixie package lists, 2026-11-24, `docs/PI-FACTS.md`; that they work on the Pi is untested; `sox` records the microphone for `/voice`; `overlayroot` is what the read-only step needs: raspi-config would otherwise `apt-get install` it at `enable` time, so it is installed now while the Pi is online)*;
   - groups `input`, `audio`, `video` and `spi` for the user (`video`: `vcgencmd` for `--thermal`; `spi`: `/dev/spidev0.0` for the lights, the group is created when missing);
   - `dtparam=spi=on` in `/boot/firmware/config.txt` (inside the installer's own block, only when no active spi line exists; it takes a reboot. An explicit `dtparam=spi=off` is the owner's choice and is left alone: the installer prints a warning that the lights will not work until it is changed to `dtparam=spi=on`. An spi line inside a conditional `[section]` is treated as global, not handled);
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
     says so, and you turn on Desktop Autologin in `sudo raspi-config` (System Options, S5 Boot, B4 Desktop Autologin);
   - the kiosk: `~/.config/labwc/autostart` (rotation, then `kiosk.sh`). The Pi session starts labwc with `-m`
     (merge), so this file runs AFTER the system autostart `/etc/xdg/labwc/autostart` and does not replace it: the
     desktop, the panel and kanshi still start, and the kiosk is full screen above them (untested: bench P4, P6). An
     autostart you had before is saved as `autostart.revview-backup`. Two things touch this file or the layout
     afterwards: raspi-config's Screen Blanking option appends a `swayidle` line to `~/.config/labwc/autostart`
     (and a rerun of `install.sh` rewrites that file, so the line is lost), and the desktop's Screen Configuration
     tool writes a kanshi config that may override our `wlr-randr` rotation (`labwc-pi` creates an empty kanshi
     config when none exists, so there is no profile until someone saves one);
   - the server: `/etc/systemd/user/revview.service`, enabled, lingering on for the user;
   - `/etc/revview/buttons.json`, your copy of `config/buttons.json` (USB ids and key map; created if missing, and on an update merged key by key with the new default, see Updating), `/var/lib/revview/buttons.shipped.json` (root-owned, 0644: the shipped version the last run merged from, the base of that merge), and the dongle udev rule `/etc/udev/rules.d/70-revview-dongle.rules`, generated on every run from the ids in that file (a missing, damaged or symlinked file or `/etc/revview` directory, or ids that are not 4 hex digits, leave the rule as it was and the installer exits 1). The rule is derived from the merged file;
   - `/etc/revview/server.env` (only if missing; all settings commented out);
   - the Claude Code hooks for the user (`hooks/install.mjs`, into `~/.claude/settings.json`);
   - an old `/etc/systemd/system/revview.service` from the earlier set-up is disabled and removed.

   Every file it changes that existed before is copied once to `<file>.revview-backup`. Files are written through a
   temporary file in the same directory and a rename (on the FAT boot partition that is still the best available).
   It never writes through a symlink: if any part of a target's path is a symlink (the file itself, `~/.config` or
   `~/.config/labwc`, the home directory, `/boot/firmware`, `/etc/udev/rules.d` and so on; below `--root` with a fake
   root), that file is skipped, a warning is printed and the exit code is 1. `REVVIEW_DIR` must match
   `^/[A-Za-z0-9._/-]+$`; a `--root` that only resolves to `/` is refused (pass `/`). `/etc/lightdm/lightdm.conf` gets
   the autologin in every `[Seat:*]` section; a missing `lightdm.conf` is only a note. `--root` as an ordinary user
   does not chown. When packages are missing it runs `apt-get update` first. Exit codes:
   - 0: done.
   - 1: a file was refused or skipped (a symlink, `cmdline.txt` or `config.txt` missing, a `cmdline.txt` with several
     lines or no `root=`, or hooks skipped): the rest is done; fix it and re-run.
   - 2: bad arguments, or a read-only root (nothing written).
   - 3 (or any other code, including 1 when `setup.mjs` could not even load): `setup.mjs` failed part way: nothing
     after that point was done, the hooks were not installed, and there is no "done" line.
   - `node pi/setup.mjs` run alone uses 4 for "a file was refused" (0 done, 2 bad arguments, 3 a crash); `install.sh`
     turns 4 into its own 1.
8. **Settings** (optional), in `/etc/revview/server.env` (one `KEY=value` per line, no quotes):
   - `REVVIEW_START=/home/NAME/my-repo`: at key-on a Claude session starts there by itself. It must be an absolute
     folder. Without it (the default), with `--boot` the bar leaves STARTING once the boot is done and says "No session
     yet: open the menu for New session": start one from the menu once you are parked. A `REVVIEW_START` that is
     relative, missing, or whose Claude fails to start leaves a short note ("Key-on session not started: ...") and the
     menu works. A session revview starts (key-on or New session) shows STARTING until its first hook, at most 30 s
     (then UNKNOWN "No events from this session yet"); push-to-talk is not sent while it says STARTING;
   - `REVVIEW_PROJECTS=/path/to/projects.json`: the folders the menu offers (`config/projects.example.json`);
   - `REVVIEW_NETMON_HOST=host:port`: what the network check connects to (default `api.anthropic.com:443`). A bad value
     is logged and the default is used (IPv6 literals like `[::1]:443` are not accepted).
9. **Reboot**: `sudo reboot`. Expected: a quiet boot, the desktop logs in by itself, the bar shows NO LINK for a
   moment, then STARTING, then your session.
10. **Dongle ids and keys**, once the real dongle exists: read the ids with `lsusb` and `/proc/bus/input/devices`
    (bench W1, D5). Edit `/etc/revview/buttons.json` with `sudoedit /etc/revview/buttons.json` (it is root-owned, mode 0644, like the rest of `/etc`; the kiosk user only reads it) (`device.vendor`, `device.product` and the keys): it is your file,
    kept by every re-run of the installer, and merged key by key with the new default on an update (see Updating). Then run `sudo bash /opt/revview/pi/install.sh --user NAME
    /opt/revview` again, with the same options as the first time (e.g. `--rotate 270`), to regenerate the udev rule, and `systemctl --user restart revview` as the kiosk user (or
    reboot). A `device` given by `name` or `path` only (no `vendor` and `product`) is valid: the installer then writes no dongle rule, prints a `note:` and does not fail; with only one of the two ids, or an id that is not 4 hex digits, it refuses as above (exit 1). Do not edit the rule or `config/buttons.json` in the repository. With the read-only overlay on, `/etc`
    edits are lost at the next boot: turn the overlay off first (see Updating). Bench D13.

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
it in later starts the same script through `revview-unlock-stick.service` (`72-revview-key.rules`). The script mounts the stick read-only for a moment,
hands the key file's path to cryptsetup, unmounts the stick, checks the file system, and mounts the data. The key is
never copied, printed or logged. Pull the stick while the Pi runs: nothing happens, the data stays open until
power-off (and is locked again at the next boot without the stick). While LOCKED the bar shows INSERT KEY ("Insert
the key stick to unlock"). The bar, the network check, the buttons, the menu and read aloud work; no Claude session
starts (the key-on session waits) and New session is refused. When the data unlocks, the bar goes to STARTING and
the key-on session starts once. Log: `journalctl -u 'revview-unlock*' -b`. By hand: `sudo bash /opt/revview/pi/unlock.sh`.

## Read-only root (run last)

```
sudo bash /opt/revview/pi/readonly.sh status
sudo bash /opt/revview/pi/readonly.sh enable
sudo reboot
```

It uses raspi-config's overlay file system and its read-only boot partition option *(function names and file
layouts checked against raspi-config-core 20261026+2, 2026-11-24; what they do on a Pi is untested)*.
`enable` needs the `overlayroot` package installed (`install.sh` installs it while the Pi is online; without it
`readonly.sh enable` refuses, exit 2, because raspi-config would try to `apt-get` it). raspi-config's
`do_overlayfs 0` also sets the boot partition read-only (the `ro` option on the `/boot/firmware` line of
`/etc/fstab`) and puts `overlayroot=tmpfs` at the front of `cmdline.txt`; `readonly.sh` does not call
`enable_bootro` separately any more. After the reboot nothing on the card's root or boot partition is written while driving; the
only thing written is the data partition. A power cut can lose the last seconds of writes there (a transcript line,
a file being saved), not the system. Anything you change on the root afterwards is gone at the next boot: see
Updating. Swap: check `swapon --show` *(Pi OS Trixie has the package `rpi-swap` in its archive, which sets up zram
and/or `/var/swap` per `/etc/rpi/swap.conf`, `Mechanism=auto`; whether your image has it, and which one `auto`
picks, is bench S4B-14. Zram is fine under the overlay; a swap FILE on the root makes no sense under it)*. Run this step LAST, after the install, the data set-up and Piper.

## Updating

1. `sudo bash /opt/revview/pi/readonly.sh disable` (round 1: turns the overlay off). Reboot.
2. `sudo bash /opt/revview/pi/readonly.sh disable` again (round 2: turns the read-only boot partition off).
3. `sudo apt update && sudo apt full-upgrade`.
4. `sudo git -C /opt/revview pull` if you cloned it (Wi-Fi needed), or copy the new version over `/opt/revview` from a
   laptop as in step 5 and run the `chown`/`chmod` there again. No `npm ci`. The
   repository must stay owned by root and not writable by your user: the unlock runs `pi/unlock.sh` from it as root,
   and `data-setup.sh` refuses a path your user could change. Never `chown` it to your user.
5. `claude update`, as the kiosk user, with the data unlocked (the stick in). Claude's own auto-updater is off
   (`DISABLE_AUTOUPDATER=1` in the unit): under the overlay it would write to memory and the update would vanish.
6. If the `git pull` changed the data set-up's templates in `pi/data.mjs` (the unlock unit, the stick's udev rule,
   `/etc/revview/data.env`, `data.conf`, `/etc/profile.d/revview-claude.sh`), `install.sh` does NOT refresh them;
   only `data-setup.sh` does. Re-run it WITHOUT `--format` (add `--dry-run` first). It refuses while the data is
   open, and step 5 needs the data open, so the order is: steps 1-5 with the stick in; reboot WITHOUT the stick
   (the data stays locked); `sudo bash /opt/revview/pi/data-setup.sh --user NAME --device /dev/X --key-device
   /dev/STICK` (see "Encrypted data and the key stick"); then reboot WITH the stick in (the overlay is still off, so this is safe), and
   carry on with step 7: `install.sh` writes the hooks into the unlocked data. If only `pi/unlock.sh` changed, skip this: it runs from `/opt/revview` and takes effect at once.
   Not tried on a Pi.
7. Run `install.sh` again (step 7). Your `/etc/revview/buttons.json` is MERGED per key (an array such as `buttons` is one value) from three versions: the shipped file recorded at the last run (`/var/lib/revview/buttons.shipped.json`), the new `config/buttons.json`, and yours. A key you did not change follows the update (added, changed or removed); a key you changed is kept; the same change on both sides is fine. If you and the update changed the same key differently (or the update removed a key you edited) it writes nothing for the key map, prints the keys and `diff /etc/revview/buttons.json /opt/revview/config/buttons.json`, and exits 1 (the other files are done): edit your file by hand and run it again. When the merge changes your file it is rewritten in the shipped layout (JSON has no comments; your own layout is lost, your values are not), after saving the old one as `/etc/revview/buttons.json.revview-backup-<UTC time>` (the newest 3 are kept, older ones are deleted), written atomically, root:root 0644. If the merge result equals your file it is not touched. `--dry-run` prints `would merge ...` and writes nothing. An install from before this existed has no recorded version: if your file equals the new default the version is recorded; otherwise your file is kept and a `note:` says so; run `sudo bash /opt/revview/pi/install.sh --user NAME --adopt-buttons-base` to keep it as it is and record the current default as its base (later updates merge), or copy the default over it (`cp /opt/revview/config/buttons.json /etc/revview/buttons.json`, losing your edits) and run again. `--adopt-buttons-base` is refused (exit 1 from `install.sh`, nothing changed) when a valid recorded version already exists, because adopting would turn the update's own changes into "yours"; remove `/var/lib/revview/buttons.shipped.json` by hand first if you really want to start over. The saved copies are ordered by file time, not by the time in their names (the Pi has no real-time clock), and the one just written is never deleted. A key named `__proto__` or `constructor` is an ordinary key and is kept. The dongle rule is regenerated from the merged file's ids. Not tried on a Pi. It refuses (exit 2, nothing written) under the overlay, and when `/boot/firmware`
   is read-only: that is the sign that step 1 or 2 is missing.
8. `sudo bash /opt/revview/pi/readonly.sh enable`, then reboot (with the stick in).

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
   (`sudo journalctl --user-unit=revview -b`).

Newer Piper versions (`piper1-gpl`, a Python package) have a different command line: `config/speech.json` would
need changing. The paths in that file are the ones above.

## Day to day

- Server status and log, as the kiosk user: `systemctl --user status revview`, `sudo journalctl --user-unit=revview -b`.
  Not `journalctl --user -u revview`: raspberrypi-sys-mods ships `Storage=volatile` for journald
  (`/usr/lib/systemd/journald.conf.d/40-rpi-volatile-storage.conf`), and journalctl(1) says `--user` only works with
  persistent logging, so it would show nothing; the user unit's lines are in the system journal (read with `sudo`, or
  without it when the user is in group `adm`). Seen in the packages, not tried on a Pi (bench P11).
  Restart it: `systemctl --user restart revview` (the Claude sessions in tmux survive, bench D3).
- **Why a Claude ended** (key-on or any session revview started): the bar says "Session ended: <last line of its
  screen>", and the journal (command above) has a line `owned sessions: Claude of session <id> ... ended with status N`
  followed by up to 20 screen lines, each starting `  | `. Those lines are what Claude last showed, so the journal can
  hold file names or parts of a conversation; look before you share it. A session stopped from the tmux side while it
  still runs (`kill-window`) leaves no such note.
- See the Claude sessions: `tmux -L revview attach` (detach with Ctrl+B then D).
- **Pause the kiosk** (to use the desktop): `mkdir -p ~/.config/revview && touch ~/.config/revview/kiosk-paused`,
  then close the running Chromium yourself (the marker only stops a new one from starting; it does not stop one
  that is running); remove the file to bring it back (within about 5 s). If you cannot get to a terminal: put the
  SD card in another computer and create an empty file `revview-kiosk-paused` in its boot partition.
- Change rotation or user: run the installer again with the new options; it rewrites only what differs.
- Undo (UNTESTED; do it with the overlay off, see Updating). Stop the server first, as the kiosk user:
  `systemctl --user disable --now revview`. Then, as root, remove what the installer created:
  - `/etc/udev/rules.d/70-revview-dongle.rules`, `71-revview-touch.rules` (and `72-revview-key.rules` if you did the
    data set-up);
  - `/etc/systemd/user/revview.service` and `/etc/systemd/user/default.target.wants/revview.service` (the link);
  - `/var/lib/systemd/linger/NAME` (or `loginctl disable-linger NAME`);
  - `/etc/revview/server.env` and `/etc/revview/buttons.json` (your key map; keep a copy if you want it) with its `buttons.json.revview-backup-*` copies, and `/etc/revview/` if empty;
  - `/var/lib/revview/buttons.shipped.json` (the recorded base of the key map merge), and `/var/lib/revview/` if empty (there is no uninstall script; removing it is by hand);
  - `~/.config/labwc/autostart`: on a fresh Pi it had no backup, so just delete it (the system autostart runs
    on its own again); if `autostart.revview-backup` exists, move it back over it;
  - the hooks: `node /opt/revview/hooks/install.mjs --remove` as the kiosk user (it removes only revview's entries
    from `~/.claude/settings.json` and keeps the rest; `--dry-run` shows first);
  - the data set-up, if you did it (`docs/REVOKE.md` for the data itself): `/etc/revview/data.conf`, `data.env`,
    `/etc/profile.d/revview-claude.sh`, `/etc/systemd/system/revview-unlock.service` and `revview-unlock-stick.service`
    and `/etc/systemd/system/multi-user.target.wants/revview-unlock.service`; `sudo systemctl daemon-reload`.
  - Files the installer edited and backed up (`cmdline.txt`, `config.txt`, `lightdm.conf`): put each
    `<file>.revview-backup` back over the file. Without a backup the file was not there before.
  - `udevadm control --reload` (or reboot) afterwards. Packages and group memberships (`input`, `audio`, `video`) stay.

## How it fits together

- **Boot**: `revview-unlock.service` (a system unit, only after the data set-up) opens the data with the stick. Lingering starts the user's systemd manager at boot, which starts `revview.service`; the unit reads `/etc/revview/data.env`, which passes `--data-lock` (via `REVVIEW_DATA_MOUNT`) and `CLAUDE_CONFIG_DIR`. The server decides "locked" from the kernel's mount table, so the bar shows INSERT KEY until the data is mounted. A posted `RevviewDataLock` is only a poke (`src/server/README.md`). The server applies
  STARTING to the bar itself (`--boot`) and, when no revview tmux window exists (after a power cut there is none),
  starts the `REVVIEW_START` session once it is listening, so that session's first hook reaches the bar. After a
  server restart the surviving window is picked up and nothing new starts.
- **Kiosk**: labwc runs `~/.config/labwc/autostart` at login, after the system autostart (labwc `-m`, untested); `kiosk.sh` starts Chromium on
  `file:///opt/revview/src/view/boot.html?port=8138`, which shows NO LINK until the server answers and then opens
  `http://127.0.0.1:8138/`. The Chromium profile lives in `$XDG_RUNTIME_DIR` (memory only): fresh each boot, so no
  "restore pages" after a power cut and no browser writes to the SD card. Chromium is restarted 1 s after it exits
  (longer if it keeps dying). Neither the kiosk nor the server waits for the other.
- **Network** (`--netmon`): every 10 s the server checks for a default route on any interface (Wi-Fi hotspot, or the
  bench's Ethernet; nothing depends on either) and opens a TCP connection to the Claude API host. Two failures in a
  row show OFFLINE; one success clears it.
- **Thermal and power** (`--thermal`): every 5 s the server reads `vcgencmd get_throttled` and
  `/sys/class/thermal/thermal_zone0/temp`. A quiet outline tag `HOT` shows in the band when the CPU is throttled or
  soft-limited now (bits 2, 3; bit 1, frequency capped, is not used because under-voltage is thought to set it too) or at 80 C and above (until it is below 75 C); `LOW POWER` shows while the supply is
  under-voltage now (bit 0). The "has occurred" bits show nothing (they are logged once). A missing `vcgencmd` or an
  unreadable value is quiet: one log line, no mark. Overrides (for tests and odd images): `REVVIEW_THERMAL_VCGENCMD`
  (the command), `REVVIEW_THERMAL_THROTTLED` and `REVVIEW_THERMAL_TEMP` (a value instead of reading). **From memory,
  untested on hardware** (bench PT-1 to PT-3). The unit is a user unit, so it has no `SupplementaryGroups=`: on
  Raspberry Pi OS Trixie `vcgencmd` is `/usr/bin/vcgencmd` (package `raspi-utils-core`) and talks to
  `/dev/vcio_gencmd`, which is group `video` mode 0660 (raspberrypi-sys-mods `10-vc.rules`); names and layout checked
  against the packages, behaviour untested.
  The installer adds the user to `video` (with `input` and `audio`). If the mark never appears with a Pi that is
  throttled, run `vcgencmd get_throttled` as the kiosk user (after a new login) and tell the bench (PT-3) if it is denied.
  A `vcgencmd` that hangs is killed after 3 s and a read that gives no answer in 4 s counts as unreadable (the marks
  clear after the 10 s hold). In the fullest band (NEEDS PERMISSION + 9+ + voice mark + NO BUTTONS) there is not room
  for everything: `LOW POWER`, then `HOT`, can be absent.
- **Buttons**: `src/input` finds the dongle by the USB ids in `/etc/revview/buttons.json` (the unit's `--input`; `config/buttons.json` is only the default it is created from); the user's `input` group lets the
  server read and grab it; a missing dongle shows NO BUTTONS and is retried.
- **Read aloud**: `espeak-ng` is installed; Piper is optional (section Piper). The user unit runs inside the user's audio session.

## Lights (LEDs per session)

**Untested on hardware** (bench group LT in `docs/BENCH-TEST.md`). One WS2812B addressable RGB LED per Claude session
(up to 8, in bar order) on a single data wire from the Pi's SPI0 MOSI. The server runs `src/lights/spi-helper.py`
(`python3-spidev`) when started with `--lights-config`; the unit passes `/opt/revview/config/lights.json` (the repo's
path). That file says `"lights": "off"` by default, so nothing is driven until you turn it on: with it off at start no SPI helper process is started and no dark frame is
sent. Once on, switching off sends dark and keeps the helper. LEDs left lit by a hard kill therefore stay lit while the
lights are off, until power-off.

**Wiring** (header pin numbers; GPIO10 = SPI0 MOSI = pin 19; nothing else in revview uses the 40-pin header, and
SPI0 is GPIO 7-11, so no collision with the other revview parts):

| Strip | Pi header |
|---|---|
| 5 V | pin 2 or 4 (5 V) |
| GND | pin 6 (or any ground pin) |
| DIN | pin 19 (GPIO10, MOSI), through a 330-470 ohm resistor close to the first LED *(value from memory, check against the datasheet of the LEDs you buy)* |

- **Level.** The Pi's data pin is 3.3 V; a WS2812B at 5 V wants at least 0.7 x VDD = 3.5 V. It often works without a
  level shifter, not guaranteed. Safer: a 74AHCT125 (or similar) level shifter on the data line, or feed the first LED
  a diode drop lower (about 4.3 V) and keep the first data wire short. Join the grounds first.
- **Capacitor.** 100-1000 uF across 5 V and GND at the strip *(value from memory, check against the datasheet of the LEDs you buy)*, and connect GND before 5 V.
- **Current.** About 20 mA per colour channel at full drive *(from memory, check against the datasheet of the LEDs you buy)*. At the brightness cap (64 of 255, config `brightness`)
  that is at most about 15 mA per LED, so 8 LEDs are about 120 mA, plus about 1 mA idle each *(also from memory, same check)*. The 5 V header pin is fed
  straight from the Pi's supply, so this comes out of the supply's budget after the Pi and the panel.
- **PoE HAT.** The one on the bench covers the header (`docs/DESIGN.md`): fit the strip in the car, or wire to the HAT's
  own pins; the lights are not a bench-with-PoE feature.
- **Enable.** Set `"lights": "on"` in `config/lights.json` (the install keeps it, restart the service), or use the
  Settings row "Lights" (not kept over a restart). `"leds"` is how many are chained; `"driver": "none"` turns the
  feature off for good.
- **SPI.** `install.sh` adds `dtparam=spi=on` and the user to group `spi`: reboot once. `/dev/spidev0.0` should exist
  afterwards. No SPI or no helper: one log line, the bar keeps working.
- **Pi 4 clock** *(from memory, not checked)*: the SPI0 clock is derived from the core clock, so a core clock that
  changes (power saving) would change the bit timing; pinning `core_freq=250` in `config.txt` may be needed if the
  LEDs flicker or show wrong colours. Not done by the installer.

## Not done here

Nothing of part B was run on a Pi (bench items S4B-1 to S4B-19). No script installs Piper. No shutdown HAT or ignition wiring
(not needed with the read-only root). Clevis/Tang unlock and a password prompt at boot are not done (DESIGN: later,
maybe). See DECISIONS "stage 4B".

## First drive (parked)

Do this once, after the install and a reboot, with the car parked. Nothing here was run on a Pi or in a car.
Facts marked *(Claude Code 2.1.330)* were read from the installed Claude Code's own strings; the rest is marked
*(from memory, untested)*.

**Set up voice, once, as the kiosk user.** Voice is a setting of Claude Code, user-wide (not per project):
`/voice tap` writes it to the user settings, `~/.claude/settings.json` (or `settings.json` in `CLAUDE_CONFIG_DIR` when
that is set). Before the encrypted-data set-up that is `~/.claude/settings.json` on the card; after it,
`/etc/revview/data.env` sets `CLAUDE_CONFIG_DIR=/home/NAME/.claude`, which is a link onto the unlocked data partition
(so do this with the stick in). Do it INSIDE a revview session so that the setting lands where the sessions read it:

1. `tmux -L revview attach`, as the kiosk user (a terminal, or ssh). If there is no session yet, start one from the menu
   (New session) first. The sessions get `CLAUDE_CONFIG_DIR` from the service, so `/voice` run there writes the
   settings they read.
2. In the Claude prompt type `/voice tap`. Expected: `Turned on voice mode (tap)` and a hint like `Tap <key> (with input
   empty) to start, tap again to send.` *(Claude Code 2.1.330)*. The command is `/voice [hold|tap|off]`, default
   `hold`; revview sends one Space per tap, so tap mode is the one that works.
3. Leave push-to-talk on Space (Claude Code's default binding `space` to `voice:pushToTalk`, in the Chat context
   *(Claude Code 2.1.330)*). Do not rebind it: the wheel's push-to-talk button sends exactly one Space.
4. If it says SoX is missing ("Voice mode needs SoX to record"), the `sox` package was not installed (install step
   skipped with `--no-apt`, or no network): `sudo apt-get install sox`, then run `/voice tap` again. If it says
   "Voice mode needs a microphone, and SoX couldn't open one." or "there's no audio device here.", the USB mic is not
   seen by the kiosk user's audio session (bench P14). `command -v rec` should print a path (`rec` comes with SoX).
5. If it says "Voice mode needs a Claude.ai account. Run /login to sign in.", sign in with your claude.ai account:
   voice is not available with an API key, another provider or an organisation sign-in *(Claude Code 2.1.330)*.
6. Detach: Ctrl+B then D *(from memory, untested)*.

**Then, parked, drive one turn by voice.** With the bar on WAITING FOR ME for the session (the mic mark is next to the
position, not crossed out):

1. Tap push-to-talk on the wheel, speak, tap it again: the second tap sends. *(Behaviour of Claude Code's tap mode,
   *Claude Code 2.1.330*; the wheel's one-Space-per-tap is revview's.)*
2. What the bar can say, in its own words (src/view/view.js, src/state/board.js): `STARTING` with "Not ready for voice
   yet" while the session has no first hook yet (a tap then is not sent; the bar says "Claude is still starting:
   push-to-talk not sent"); `WORKING` once Claude is on your request; `NEEDS PERMISSION` when it asks (answer with the
   wheel); `WAITING FOR ME` or `DONE` when the turn is over and it is your turn. A crossed-out mic names the reason: "No network:
   push-to-talk will not work", "No wheel buttons found". The bar has no "recording" state of its own: whether the
   recording started is seen in the Claude prompt (`tmux -L revview attach`), not on the bar.
3. Record the result in `docs/BENCH-TEST.md`: S1 (voice mode set up in the revview session), P13 and P14 (a spoken turn
   reaches Claude; the mic is heard), P21 (SoX present: `command -v rec` prints a path and `/voice tap` says "Turned on
   voice mode (tap)") and D13 (dongle ids kept: edit `/etc/revview/buttons.json`, re-run `install.sh`, the edit and the
   rule stay).
