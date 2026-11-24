# Pi set-up: facts that were written from memory

Every package name, path, config key, command, option and flag that the Pi set-up (`pi/`, its tests and fixtures,
`pi/README.md`, `docs/BENCH-TEST.md` stage 4A/4B, `docs/DECISIONS.md` stage 4A/4B, `docs/REVOKE.md`,
`config/speech.json`) relies on and that nobody has checked against the real Raspberry Pi OS. Many are marked
*(from memory)* where they are used. Many others were never flagged; they are listed here too.

**Status, 2026-11-23 (backlog f59dbf):** every row is `from memory`. Both archives were unreachable from the
team's VM: `http://deb.debian.org/debian/dists/trixie/Release` and
`http://archive.raspberrypi.com/debian/dists/trixie/Release` returned 403 from the proxy. Nothing below was checked.

Rules for a later cycle:
- A row can become `checked against <package> <version>` only with that package's evidence (its index entry, or a
  file from its unpacked `.deb`). That proves **names and file layouts only**. It does not prove that anything works
  on a Pi. Those rows keep their bench item, which stays `untested`.
- `only on the Pi` rows cannot be checked from packages at all. Their bench item is the check.
- Downloaded `.deb` files are untrusted data. Put each one in its own new directory under `/tmp`. Unpack it with
  `dpkg-deb -x` (or `ar x` + `tar`), never install it, run nothing from it, and read files with `grep`/`zcat` only.
  Reading strings out of a binary (`grep -a -c -- 'switch-name' usr/lib/chromium/chromium`) is fine. Running the
  binary is not.

## Where to look (abbreviations used in the table)

| Abbrev. | Source |
|---|---|
| **D** | Debian Trixie package index, arm64: `http://deb.debian.org/debian/dists/trixie/main/binary-arm64/Packages.xz` (contrib/non-free-firmware are not needed: no row names a package from them) |
| **R** | Raspberry Pi archive index, arm64: `http://archive.raspberrypi.com/debian/dists/trixie/main/binary-arm64/Packages.xz` (also try `binary-all` for arch-all packages such as `raspi-config`) |
| **D/R** | Both indexes. A package in R overrides the Debian one of the same name on a Pi (check the `Version:` of each) |
| **unpack X: F** | Find package X's `Filename:` in the index, download that `.deb`, unpack it, and read file F inside it |
| **Pi: B** | Only on the Pi. Bench item B in `docs/BENCH-TEST.md` |

## 1. Packages the installer installs or the scripts call

`pi/install.sh:102` installs `pkgs="chromium tmux python3 espeak-ng wlr-randr sox"` (`dpkg -s` per name, then
`apt-get install -y --no-install-recommends`, lines 106-114). It is repeated in `pi/README.md:69` and
`docs/DECISIONS.md:1093` (that line lacks `sox`; `sox` was added later, DECISIONS:1407-1409). No test encodes
the list: `--root` skips apt.

| # | Fact | Used in | How to check | Status |
|---|---|---|---|---|
| P01 | Package `chromium` exists on Trixie arm64, and the Pi gets **Raspberry Pi's build** (not Debian's) under that name | install.sh:102; README:69; DECISIONS:1094 | D/R: is `Package: chromium` in R, and which version wins? Also look for `chromium-browser` in R (bookworm's RPi name), a transitional or real package | from memory |
| P02 | The Chromium binary is `chromium` on PATH, with `chromium-browser` as a fallback | kiosk.sh:13, 53; test pi-kiosk.test.js:99 ("no chromium") | unpack chromium (R): list `usr/bin/` (is it `chromium`, `chromium-browser`, or both? a wrapper script or a symlink?) | from memory |
| P03 | Package `tmux` | install.sh:102; `tmux -L revview` everywhere | D: `Package: tmux` | from memory |
| P04 | Package `python3` (grab helper `src/input/grab.py`) | install.sh:102, 132 | D: `Package: python3` | from memory |
| P05 | Package `espeak-ng` provides the command `espeak-ng`, and its voice `en-us` exists (`-v en-us -s 165`, reads stdin) | install.sh:102; config/speech.json; DECISIONS:841 ("Debian 12 ... 1.51": outdated, the target is Trixie) | D: `Package: espeak-ng` + version; unpack `espeak-ng-data`: a voice named `en-us` (e.g. `usr/lib/*/espeak-ng-data/lang/gmw/en-US`) | from memory |
| P06 | Package `wlr-randr` provides the command `wlr-randr` | install.sh:102; setup.mjs:109 | D/R: `Package: wlr-randr`; unpack: `usr/bin/wlr-randr` | from memory |
| P07 | Package `sox` provides `rec` (Claude Code's voice needs SoX). The name comes from Claude Code 2.1.330's own hint ("Ubuntu/Debian: sudo apt-get install sox"), not from a Pi | install.sh:102; README:69, 319-322; DECISIONS:1407-1409; bench P21 | D: `Package: sox`; unpack sox: `usr/bin/rec` (often a symlink to `sox`) | from memory |
| P08 | `cryptsetup` is the package that provides the `cryptsetup` command ("it may already be there") | data-setup.sh:151 (message `apt install cryptsetup`); README:149-150 | D: `Package: cryptsetup` vs `cryptsetup-bin` (which one ships `usr/sbin/cryptsetup`?); whether the Pi OS desktop image has it is Pi-only (bench S4B-9) | from memory |
| P09 | `aplay` comes from `alsa-utils` (Piper pipeline) | config/speech.json; DECISIONS:844 | D: unpack alsa-utils: `usr/bin/aplay` | from memory |
| P10 | `lsblk`, `mountpoint`, `flock`, `runuser`, `mount`, `umount` come from util-linux (`mount` package for mount/umount) and are on the image | data-setup.sh:150, 157; unlock.sh:76, 110 | D: unpack util-linux / mount: `usr/bin/lsblk`, `usr/bin/mountpoint`, `usr/bin/flock`, `usr/sbin/runuser` (sbin or bin?) | from memory |
| P11 | `e2fsck`, `mkfs.ext4` (e2fsprogs) | unlock.sh:165; data-setup.sh:273 | D: unpack e2fsprogs: `usr/sbin/e2fsck`, `usr/sbin/mkfs.ext4` | from memory |
| P12 | `curl` exists on the Pi (unlock.sh pokes the server with it; skipped quietly when missing) | unlock.sh:69 | D: `Package: curl`; that the desktop image includes it: Pi | from memory |
| P13 | `raspi-config` is installed and is a shell script with a `nonint` mode | readonly.sh:48, 68 | R: `Package: raspi-config`; unpack: `usr/bin/raspi-config` (see section 5) | from memory |
| P14 | Node 22 or newer is not in Pi OS by default; install it from NodeSource | README:45-46 | D: version of `Package: nodejs` in Trixie (if it is 22 or newer, NodeSource is not needed) | from memory |
| P15 | `git` may be missing on the image (`sudo apt install git`) | README:49 | D: `Package: git`; whether the image has it: Pi | from memory |

## 2. Boot partition: `/boot/firmware/cmdline.txt` and `config.txt`

Code: `pi/setup.mjs` `editCmdline` (44-57), `editConfigTxt` (59-70), CLI 220-221. Tests: `tests/unit/pi-setup.test.js`,
`pi-install.test.js`. Fixtures: `tests/unit/fixtures/pi/cmdline.txt` and `config.txt` (both WRITTEN FROM MEMORY,
`tests/unit/fixtures/pi/README.md`).

| # | Fact | Used in | How to check | Status |
|---|---|---|---|---|
| B01 | The boot partition is mounted on `/boot/firmware` (not `/boot`) on Trixie | setup.mjs:220-221; lib.sh:27; readonly.sh:49, 60, 72; kiosk.sh:10, 25; all fixtures | unpack raspi-config (R): the paths its script uses for `cmdline.txt`/`config.txt` (it has a `/boot/firmware` vs `/boot` switch); Pi: P1 | from memory |
| B02 | Stock `cmdline.txt` is one line like the fixture: `console=serial0,115200 console=tty1 root=PARTUUID=... rootfstype=ext4 fsck.repair=yes rootwait quiet splash plymouth.ignore-serial-consoles cfg80211.ieee80211_regdom=GB` | fixture cmdline.txt; pi-setup.test.js | No package ships it (the image builder writes it). Pi: copy it off a fresh flash (P1) | from memory |
| B03 | Stock `config.txt` content (comments, `dtoverlay=vc4-kms-v3d`, `max_framebuffers=2`, `disable_fw_kms_setup=1`, `arm_64bit=1`, `[cm4]`, `[cm5]`, `[all]` at the end) | fixture config.txt | Same as B02: Pi only (P1) | from memory |
| B04 | `disable_splash=1` in config.txt removes the rainbow splash | setup.mjs:60, 68; README:71 | Firmware option, not in a `.deb` index. Pi: P3 | from memory |
| B05 | The KMS overlay is named `vc4-kms-v3d` (or `vc4-fkms-v3d`) and the `video=` mode needs it | setup.mjs:65 (warning); DESIGN:63 | unpack the RPi kernel package (R, e.g. `linux-image-rpi-v8`): `boot/firmware/overlays/vc4-kms-v3d.dtbo` or wherever it ships overlays (check the `Filename`/file list) | from memory |
| B06 | Kernel arguments `quiet loglevel=0 logo.nologo vt.global_cursor_default=0` give a quiet boot; removing `splash` turns plymouth off | setup.mjs:49-55; README:71-72; pi-setup.test.js:22 | Kernel/plymouth behaviour. Pi: P3 | from memory |
| B07 | `video=HDMI-A-1:400x1280M@60,rotate=90` rotates the console; `rotate=270` for a flipped mount is our own inference | setup.mjs:55; DECISIONS:1077-1081 | The 90 form is from DESIGN "Known Pi settings" (owner's working Pi 5 build, not a Pi 4B). Pi: P3, P4 | from memory |
| B08 | `fbcon=rotate:N` would fight `video=...,rotate=` (so it is dropped) | setup.mjs:39, 50 | Pi: P3 | from memory |
| B09 | The first HDMI connector is `HDMI-A-1` (HDMI0, next to USB-C); the other is `HDMI-A-2` | install.sh:33; setup.mjs:166; README:41, 67 | Pi only: `wlr-randr` output names (P4) | from memory |

## 3. Login and desktop: lightdm, labwc, wlr-randr, touch

| # | Fact | Used in | How to check | Status |
|---|---|---|---|---|
| L01 | Pi OS Trixie desktop still uses lightdm as display manager (with labwc) | setup.mjs:222-225; DECISIONS:1085 | R: the desktop metapackage's `Depends:` (e.g. `raspberrypi-ui-mods` / `rpd-*`) on `lightdm`; D/R: `Package: lightdm` | from memory |
| L02 | Autologin key `autologin-user=NAME` in a `[Seat:*]` section of `/etc/lightdm/lightdm.conf` | setup.mjs:72-97, 222; README:80; test pi-install.test.js:54; pi-setup.test.js | unpack lightdm (D/R): `etc/lightdm/lightdm.conf` (section name `[Seat:*]`, key `autologin-user`, commented default); unpack raspi-config: how `do_boot_behaviour` sets desktop autologin (which file and key it edits; whether it also sets `autologin-session` or a group) | from memory |
| L03 | lightdm.conf fixture lines `user-session=rpd-labwc`, `greeter-session=pi-greeter-labwc`, `display-setup-script=/usr/share/dispsetup.sh` | fixture lightdm.conf | R: which packages ship `usr/share/wayland-sessions/*.desktop` (the real session name) and the greeter `usr/share/xgreeters/*.desktop`; whose postinst or raspi-config sets these keys. The fixture's full text: Pi (copy `/etc/lightdm/lightdm.conf` off a fresh flash, P5) | from memory |
| L04 | raspi-config menu "System Options, Boot / Auto Login" (Desktop Autologin) | setup.mjs:225; README:81 | unpack raspi-config: the whiptail menu strings | from memory |
| L05 | labwc runs `~/.config/labwc/autostart` with `sh` at session start | setup.mjs:103-111, 270; README:82; DECISIONS:1063; tests pi-install.test.js:52, 99, 188, 209 | unpack labwc (D/R): man pages `usr/share/man/man5/labwc-config.5.gz` / `man1/labwc.1.gz` ("autostart", search path); R may ship its own labwc build | from memory |
| L06 | A user `~/.config/labwc/autostart` REPLACES the system `/etc/xdg/labwc/autostart` (no panel, no desktop) instead of running after it | setup.mjs:105; README:82, 264-265; DECISIONS:1064 | unpack labwc: man page (does it take the first autostart found in the XDG config path?); R: which package ships `etc/xdg/labwc/autostart` and what it starts; whether the Pi session starts labwc with its own `--config-dir`/`-C` (read the session `.desktop` file and any wrapper script it names) | from memory |
| L07 | `wlr-randr --output HDMI-A-1 --transform 90` rotates the picture; 270 for a flipped mount | setup.mjs:109; README:78-79; bench P4 | unpack wlr-randr: `usr/share/man/man1/wlr-randr.1.gz` (option names, transform values). Behaviour: Pi P4 | from memory |
| L08 | Nothing else in the Pi session (e.g. kanshi, started by the system autostart) re-applies a display layout after our `wlr-randr` (follows from L06) | setup.mjs:105-109 | R: the system `etc/xdg/labwc/autostart` (does it start kanshi?). Pi: P4 | from memory |
| L09 | Touch rotation: udev property `LIBINPUT_CALIBRATION_MATRIX` (matrix `0 -1 1 1 0 0` for 90, `0 1 0 -1 0 1` for 270), matched by `ATTRS{idVendor}=="0712", ATTRS{idProduct}=="000a"`, in `/etc/udev/rules.d/71-revview-touch.rules`; labwc does not rotate touch itself | setup.mjs:114-121, 263; pi-setup.test.js | The 90 matrix and the ids come from DESIGN "Known Pi settings" (owner's Pi 5 build). unpack libinput10 (D/R): `grep -a LIBINPUT_CALIBRATION_MATRIX` in the shared library (the name only). 270 matrix and behaviour: Pi P4 | from memory |
| L10 | `XDG_RUNTIME_DIR` is set in the labwc autostart environment (the kiosk profile goes there, else `/tmp`) | kiosk.sh:11, 26 | Pi: P9 (no restore bubble after a power cut) | from memory |
| L11 | The kiosk's log lines (stderr of the autostart) land in `journalctl --user` or labwc's log | bench P7 | Pi: P7 | from memory |

## 4. Chromium (kiosk.sh)

`pi/kiosk.sh:32` says it: "Flag behaviour is from memory and untested on the Pi". Flags are at kiosk.sh:33-48.
`tests/unit/pi-kiosk.test.js` uses a fake browser, so no test encodes the flags. A package can only prove that a
switch NAME is compiled into that build (the string is in the binary) or is set by the wrapper. It cannot prove what
the switch does. Behaviour: bench P6, P9.

| # | Fact | How to check (all: unpack chromium from R, and `chromium-common` if the binary is there) | Status |
|---|---|---|---|
| C01 | Where the real binary and the wrapper are, and which default flags the wrapper adds | the `usr/bin/chromium*` script; `etc/chromium.d/*` or `etc/chromium-browser/*` default-flag files (Raspberry Pi's build may already add `--ozone-platform`, `--enable-features=...`) | from memory |
| C02 | `--kiosk` | the man page (`usr/share/man/man1/chromium.1.gz`) or the wrapper; a binary search for `kiosk` proves nothing (the word is too common) | from memory |
| C03 | `--ozone-platform=wayland` | man page / wrapper; binary string `ozone-platform` | from memory |
| C04 | `--noerrdialogs`, `--disable-infobars`, `--no-first-run`, `--no-default-browser-check` | binary strings `noerrdialogs`, `disable-infobars`, `no-first-run`, `no-default-browser-check` (some switches were removed upstream over time) | from memory |
| C05 | `--disable-session-crashed-bubble`, `--hide-crash-restore-bubble` | binary strings | from memory |
| C06 | `--password-store=basic` (no keyring dialog) | binary string `password-store`; man page | from memory |
| C07 | `--disable-features=Translate` (the feature is named `Translate`) | binary string `Translate` (feature names are strings; weak evidence) | from memory |
| C08 | `--check-for-update-interval=31536000` | binary string `check-for-update-interval` | from memory |
| C09 | `--disable-pinch`, `--overscroll-history-navigation=0` | binary strings `disable-pinch`, `overscroll-history-navigation` | from memory |
| C10 | `--user-data-dir=DIR`; the profile's `Default/Preferences` holds `"exited_cleanly":false` and `"exit_type":"Crashed"` after a crash (kiosk.sh:59-63 rewrites them; test pi-kiosk.test.js:80-86 encodes the JSON form without spaces) | binary strings `exited_cleanly`, `exit_type`, `Crashed`. Exact JSON spacing: Pi only (look at a real Preferences file, P9) | from memory |

## 5. Read-only root: raspi-config overlay (readonly.sh, lib.sh)

`pi/readonly.sh:4-5`: "EVERY raspi-config command below is FROM MEMORY". Test: `tests/unit/pi-readonly.test.js` with
a stub raspi-config (line 31: `do_overlayfs 0` appends `overlayroot=tmpfs` to cmdline.txt). The overlay mount line is
in the tests (`pi-readonly.test.js:12`, `pi-install.test.js:135`). For every row: unpack raspi-config (R) and read
`usr/bin/raspi-config`.

| # | Fact | Used in | How to check | Status |
|---|---|---|---|---|
| O01 | `raspi-config nonint do_overlayfs 0` turns the overlay ON, `1` OFF (0 = on, as for every raspi-config nonint switch) | readonly.sh:94, 107; tests :102-159 | raspi-config: `do_overlayfs` (its argument handling in nonint mode) | from memory |
| O02 | `raspi-config nonint enable_bootro` / `disable_bootro` exist and set/clear the read-only boot partition | readonly.sh:95, 110; tests :103-152 | raspi-config: the function names (they may be named differently, or only reachable inside `do_overlayfs`) | from memory |
| O03 | Turning the overlay on puts `overlayroot=tmpfs` into cmdline.txt (and that is what readonly.sh and install.sh look for: `overlayroot=`) | readonly.sh:55, 97; install.sh:69; lib.sh; stub pi-readonly.test.js:31; pi-install.test.js:173 | raspi-config: the cmdline.txt edit in `enable_overlayfs` (or similar) | from memory |
| O04 | Under the overlay, `/` is in /proc/mounts with file system type `overlay` (`overlayroot / overlay rw,...,lowerdir=/media/root-ro,upperdir=/media/root-rw/overlay`) | lib.sh:18-22; tests pi-readonly.test.js:12, pi-install.test.js:135 | D/R: `Package: overlayroot`; unpack it: the initramfs script (`usr/share/initramfs-tools/scripts/init-bottom/overlayroot`, or wherever it is) for the mount type, source name and lowerdir/upperdir paths; Pi: S4B-1 | from memory |
| O05 | `do_overlayfs` may apt-install the `overlayroot` package and rebuild the initramfs when it runs: that needs a network at `enable` time | readonly.sh (not handled) | raspi-config: does `do_overlayfs` call `apt-get install overlayroot` or `update-initramfs`? If so, `readonly.sh enable` needs Wi-Fi (never Ethernet) or a pre-install step | from memory |
| O06 | The read-only boot option is the `ro` option on the `/boot/firmware` line of `/etc/fstab` (readonly.sh reads fstab to say what the next boot does) | readonly.sh:58-62; tests FSTAB_RO/FSTAB_RW :16-17 | raspi-config: what `enable_bootro` edits (fstab, and how: `defaults,ro`?) | from memory |
| O07 | Under the overlay, `/boot/firmware` can be made writable for the current boot with `mount -o remount,rw /boot/firmware` (needed before `do_overlayfs 1` can edit cmdline.txt) | readonly.sh:70-77, 106 | raspi-config: does `do_overlayfs 1` remount it itself? Pi: S4B-13 | from memory |
| O08 | Menu name "Performance Options, Overlay File System" | DECISIONS:1175; readonly.sh:98 (warning text) | raspi-config: whiptail menu strings | from memory |
| O09 | Swap: Trixie may use zram (fine under the overlay); a swap file on the root makes no sense under it | README:204; bench S4B-14 | D/R: is there an `rpi-swap` / `systemd-zram-generator` / `dphys-swapfile` package, and which one does the desktop metapackage depend on? Pi: S4B-14 | from memory |

## 6. systemd, logind, udev

| # | Fact | Used in | How to check | Status |
|---|---|---|---|---|
| S01 | User units in `/etc/systemd/user/` are read by every user's manager; enabling = symlink in `/etc/systemd/user/default.target.wants/` | setup.mjs:264-266; revview.service:2-3, 46; test pi-install.test.js:51-53 | unpack systemd (D): `usr/share/man/man5/systemd.unit.5.gz` (user unit search path), `usr/lib/systemd/user/default.target` exists | from memory |
| S02 | Lingering = the empty file `/var/lib/systemd/linger/<user>` (what `loginctl enable-linger` writes); with it the user manager starts at boot | setup.mjs:268; README:262; DECISIONS:1053; test pi-install.test.js:51 | unpack systemd: `man1/loginctl.1.gz` (enable-linger) and `grep -a 'systemd/linger'` in `usr/lib/systemd/systemd-logind` (the path string only). Starting at boot: Pi P11 | from memory |
| S03 | A lingering user manager has `XDG_RUNTIME_DIR` and reaches the user's PipeWire session (mic for `/voice`, read aloud) | revview.service:4-5; DECISIONS:1054-1056 | Pi: P14 | from memory |
| S04 | `ConditionUser=`, `%h`, `EnvironmentFile=-`, `KillMode=process`, `NoNewPrivileges=` are accepted in a user unit (and `User=`/`SupplementaryGroups=` are not useful there) | revview.service:8, 21-43 | unpack systemd: `man5/systemd.unit.5.gz`, `systemd.exec.5.gz`, `systemd.kill.5.gz` (does this version warn about `KillMode=process`?) | from memory |
| S05 | `revview-unlock.service`: `Type=oneshot`, `After=local-fs.target`, `WantedBy=multi-user.target`; enabled by the symlink in `/etc/systemd/system/multi-user.target.wants/` | revview-unlock.service; data.mjs:276-279; tests pi-data.test.js:171, pi-data-setup.test.js:216 | unpack systemd: `man5/systemd.special.7.gz`, `systemd.service.5.gz` | from memory |
| S06 | udev rule `TAG+="systemd", ENV{SYSTEMD_WANTS}+="unit"` on a block device starts that unit when it appears; a second unit (`revview-unlock-stick.service`) avoids merging into the boot job | 72-revview-key.rules:6; revview-unlock.service:3-6 | unpack systemd: `man5/systemd.device.5.gz` (SYSTEMD_WANTS). Behaviour: Pi S4B-5, S4B-8 | from memory |
| S07 | `ENV{ID_FS_UUID}` is set on the stick's partition by the time a rule numbered 72 runs (blkid runs in 60-persistent-storage.rules) | 72-revview-key.rules:6 | unpack udev (D: `udev` or `systemd` package): `usr/lib/udev/rules.d/60-persistent-storage.rules` | from memory |
| S08 | `/dev/disk/by-uuid/<UUID>` exists for a LUKS partition (the LUKS UUID) and for the stick (file system UUID) | unlock.sh:8-9, 116, 133; test pi-unlock.test.js:30-33 | unpack udev: 60-persistent-storage.rules (`ID_FS_USAGE` filesystem/crypto -> `disk/by-uuid`) | from memory |
| S09 | UUID formats from blkid: FAT `XXXX-XXXX`, exFAT/NTFS 16 hex digits, ext4 36 characters (all three are accepted, so a wrong guess here is harmless; exFAT is probably `XXXX-XXXX` too) | unlock.sh:8-9, 100-103; data.mjs:22; data-setup.sh:170-171 | Pi: `blkid` on each stick type (S4B-8) | from memory |
| S10 | `60-input-id.rules` sets `ID_INPUT_KEYBOARD` before our rule 70 | 70-revview-dongle.rules:19, 22 | unpack udev: `usr/lib/udev/rules.d/60-input-id.rules` | from memory |
| S11 | Stock Pi OS rules already give input event nodes to group `input`, mode 0660 | 70-revview-dongle.rules:11-12 | unpack udev: `50-udev-default.rules` (`SUBSYSTEM=="input"`... `GROUP="input"`, mode); R: raspberrypi-sys-mods `99-com.rules` | from memory |
| S12 | Groups `input`, `audio` and `video` exist on Pi OS (`usermod --append --groups input,audio,video`) | install.sh:138; README:70 | unpack base-passwd (D): `usr/share/base-passwd/group.master` (audio); systemd: `usr/lib/sysusers.d/basic.conf` (input). Pi: P14 (`id`) | from memory |
| S13 | `udevadm control --reload`, `udevadm trigger --subsystem-match=input`, `systemctl daemon-reload` | install.sh:202-204; data-setup.sh:350-351 | unpack udev/systemd: `man8/udevadm.8.gz` | from memory |
| S14 | `/etc/profile.d/*.sh` is sourced by the terminals the kiosk user opens (sets `CLAUDE_CONFIG_DIR`) | data.mjs:274; README:179-180; bench S4B-12 | unpack base-files (D): `etc/profile` (sources profile.d for login shells only); whether a desktop terminal is a login shell: Pi S4B-12 | from memory |
| S15 | The unit's `DISABLE_AUTOUPDATER=1` turns Claude Code's auto-updater off (the name is in the 2.1.330 binary, the effect is from memory) | revview.service:34-36; DECISIONS:1185 | Not a Pi package. Pi: S4B-13 | from memory |
| S16 | `journalctl --user -u revview` shows the user unit's log | install.sh:216; README:249 | Pi: P11 | from memory |

## 7. Encrypted data partition (data-setup.sh, data.mjs, unlock.sh)

`pi/data-setup.sh:26-29` and `pi/unlock.sh:5-11` list these as FROM MEMORY. Tests use stubs
(`pi-data-setup.test.js:13-37`, `pi-unlock.test.js:17-23`). The lsblk fixture `tests/unit/fixtures/pi/data/lsblk.json`
and `mounts` are WRITTEN FROM MEMORY (`fixtures/pi/data/README.md`).

| # | Fact | Used in | How to check | Status |
|---|---|---|---|---|
| E01 | `lsblk -J -b -o NAME,PATH,TYPE,FSTYPE,UUID,LABEL,SIZE,MOUNTPOINTS,TRAN,RM`: these column names exist; JSON is `{"blockdevices":[...children]}` with lower-case keys, `size` a number with `-b`, `mountpoints` an array (`[null]` when unmounted), `rm` a boolean, `tran` only on the disk | data-setup.sh:157; data.mjs:11, 55-64, 106; fixture lsblk.json; README:147 | unpack util-linux (D): `usr/share/man/man8/lsblk.8.gz` (columns, `--json`, MOUNTPOINTS); JSON value types: Pi (save a real `lsblk -J ...` as the new fixture, S4B-10) | from memory |
| E02 | `type` values `part`, `disk`, `crypt`; `tran` value `usb` | data.mjs:94, 102, 107; pi-data.test.js:43 | unpack util-linux: lsblk man page; Pi S4B-10 | from memory |
| E03 | `cryptsetup luksFormat --batch-mode --type luks2 --cipher xchacha12,aes-adiantum-plain64 --key-size 256 --pbkdf pbkdf2 --iter-time 500 --key-file KEY DEV` | data-setup.sh:249-250; test pi-data-setup.test.js:125, 176 | unpack cryptsetup / cryptsetup-bin (D): `man8/cryptsetup-luksFormat.8.gz` (or `cryptsetup.8.gz`): every option name; Adiantum needs the kernel module: Pi S4B-9, S4B-15 | from memory |
| E04 | `cryptsetup luksAddKey --key-file KEY DEV` asks for the NEW passphrase on the terminal | data-setup.sh:254 | man `cryptsetup-luksAddKey.8.gz` | from memory |
| E05 | `cryptsetup open --type luks2 --key-file KEY DEV NAME`; `isLuks DEV`; `luksUUID DEV` prints the UUID | data-setup.sh:195, 259, 336; unlock.sh:157; tests pi-unlock.test.js:245-246 | man `cryptsetup-open.8.gz`, `cryptsetup-isLuks.8.gz`, `cryptsetup-luksUUID.8.gz` | from memory |
| E06 | `mkfs.ext4 -q -L LABEL DEV` | data-setup.sh:273 | unpack e2fsprogs: `man8/mke2fs.8.gz` | from memory |
| E07 | `e2fsck -p` exit status: 0 clean, 1 fixed, 2 fixed + reboot advised, 4 or more not fixed | unlock.sh:10, 165-170; tests pi-unlock.test.js:204-227 | unpack e2fsprogs: `man8/e2fsck.8.gz` (EXIT CODE) | from memory |
| E08 | `mountpoint -q DIR` exits 0 when DIR is a mount point | unlock.sh:7, 110; stub pi-unlock.test.js:17 | unpack util-linux: `man1/mountpoint.1.gz` | from memory |
| E09 | Mount options: stick `ro,nosuid,nodev,noexec` (unlock) and `rw,nosuid,nodev,noexec` (set-up) on vfat/exfat/ext4; data `noatime,nosuid,nodev` | unlock.sh:145, 173; data-setup.sh:226, 277 | unpack mount (D): `man8/mount.8.gz`; Pi S4B-5 | from memory |
| E10 | `runuser -u USER -- CMD` | install.sh:196; data-setup.sh:287; stub pi-data-setup.test.js:37 | unpack util-linux: `man1/runuser.1.gz` | from memory |
| E11 | `flock FD`, `stat -c %u` / `%s` (GNU coreutils) | unlock.sh:76, 139, 154 | unpack util-linux: `man1/flock.1.gz`; coreutils: `man1/stat.1.gz` | from memory |
| E12 | The mount table lists the data's source as `/dev/mapper/revview-data`, not `/dev/dm-N` | DECISIONS:1283-1285; src/server/datalock.js (reads /proc/self/mountinfo) | Pi only: `grep revview-data /proc/self/mountinfo` (S4B-5) | from memory |
| E13 | `cryptsetup luksKillSlot`, `luksDump` shows the PBKDF per slot, the passphrase slot defaults to argon2id; `.credentials.json` is the sign-in file name | docs/REVOKE.md:10, 40-60; DECISIONS:1216; bench S4B-19 | man `cryptsetup-luksKillSlot.8.gz`, `cryptsetup-luksDump.8.gz`, and the compiled-in default PBKDF (`man8/cryptsetup.8.gz`, "--pbkdf"). `.credentials.json`: not a Pi package | from memory |

## 8. Owner steps and other Pi-side facts

| # | Fact | Used in | How to check | Status |
|---|---|---|---|---|
| X01 | Raspberry Pi Imager's OS customisation sets user, password, Wi-Fi, time zone, SSH | README:38-40 | Not in the Pi archive in a useful way (the Imager runs on a laptop). Pi: P1 | from memory |
| X02 | Claude Code native installer `curl -fsSL https://claude.ai/install.sh \| bash` puts `claude` in `~/.local/bin` | README:57-58; revview.service:27-28; DECISIONS:1059 | Not a Pi package. Pi: P13 | from memory |
| X03 | The repository can be cloned without a sign-in from `https://github.com/awall451/revview` | README:50 | Not from the VM (no GitHub route was tried). Pi: P1 | from memory |
| X04 | tmux detach is Ctrl+B then D (default prefix `C-b`) | README:251, 325 | unpack tmux (D): `man1/tmux.1.gz` ("prefix", "detach-client" default key `d`) | from memory |
| X05 | Piper: release `2023.11.14-2` of `rhasspy/piper`, `piper_linux_aarch64.tar.gz` unpacks to `/opt/piper/piper`; voice `en_US-lessac-medium.onnx` (+ `.json`); `--model ... --output-raw` gives raw 22050 Hz S16_LE | README:230-245; config/speech.json; DECISIONS:838-844, 1267; bench S4B-16 | Not in D or R (check whether D/R has a `piper` package that changed this). Pi: S4B-16 | from memory |
| X06 | ZMK dongle USB ids `1d50:615e` (default in `config/buttons.json`) | 70-revview-dongle.rules:6-7; DECISIONS:815; bench W1, D5; test pi-install.test.js:291-296 | Not a package. Pi with the dongle: W1, D5 | from memory |
| X07 | Panel touch ids `0712:000a`, panel mode 400x1280 | setup.mjs:116-120 | DESIGN "Known Pi settings" (owner's Pi 5 build). Pi: P4 | from memory |
| X08 | `vcgencmd get_throttled` exists on Raspberry Pi OS Trixie (`/usr/bin/vcgencmd`), prints `throttled=0x...`, and the kiosk user may call it (it talks to `/dev/vcio`, group `video`, from memory; the installer adds `input,audio,video`) | revview.service (`--thermal`); README Thermal; DECISIONS cycle 40 | Pi: PT-3 (unpack `libraspberrypi-bin` from R for the path only) | from memory |
| X09 | Throttle bits: 0 under-voltage now, 1 arm frequency capped now (not used for HOT: believed to be set by under-voltage too), 2 currently throttled, 3 soft temperature limit active; 16-19 the same have occurred since boot | README Thermal; DECISIONS cycle 40 | Pi: PT-3 | from memory |
| X10 | `/sys/class/thermal/thermal_zone0/temp` is the CPU temperature in millidegrees C; the Pi 4B starts soft-limiting at about 80 C | README Thermal; DECISIONS cycle 40 | Pi: PT-1, PT-3 | from memory |

## Doing the check later (when both domains answer 200)

1. Download `Packages.xz` for D (main, arm64) and R (main, arm64; and `binary-all`) into a fresh `/tmp` directory each.
   For every package named in section 1 (and lightdm, labwc, raspi-config, overlayroot, util-linux, mount,
   e2fsprogs, cryptsetup, cryptsetup-bin, systemd, udev, libinput10, base-passwd, base-files, alsa-utils,
   espeak-ng-data, nodejs, git, curl), record `Package`, `Version` and which archive has it.
2. Unpack (never install) the `.deb` files the "How to check" column names, each into its own new `/tmp`
   directory. Read only the files named.
3. For each row: if the evidence matches, set the status to `checked against <package> <version> (names/layout only)`.
   If it does not, fix `pi/` and the fixture (test first, no test deleted or weakened), set the status to
   `fixed: was X, now Y per <package> <version>`, and add a line to DECISIONS. `only on the Pi` rows stay
   `from memory` until the bench. Every BENCH-TEST item stays `untested`.
