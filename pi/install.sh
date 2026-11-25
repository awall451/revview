#!/bin/bash
# Set up the Pi as a revview kiosk. UNTESTED on a Pi: written without one; the file edits are tested only
# against a fake root in a temp dir (tests/unit/pi-install.test.js).
# Usage: sudo bash pi/install.sh --user NAME [--rotate 90|270] [--output HDMI-A-1] [--root DIR] [--dry-run]
#                                [--no-apt] [--adopt-buttons-base] [REVVIEW_DIR]
#   --user    the ordinary login user (the one the desktop auto-logs in as): runs the kiosk Chromium, the
#             server (a systemd user unit, lingering on) and the Claude sessions. Required.
#   --rotate  90 (normal mount, default) or 270 (mount flipped 180 degrees)
#   --adopt-buttons-base  keep /etc/revview/buttons.json as it is and record the current config/buttons.json as the
#             version it is based on (for an install made before the merge existed whose file differs from the
#             shipped one); from then on an update is merged (see below)
#   --root    act on this directory tree instead of / (a fake root for tests; no root needed, no apt,
#             no usermod, no systemctl, no udevadm)
#   REVVIEW_DIR defaults to this repository; it should live outside the home (e.g. /opt/revview); no npm ci is needed (Node's standard library only).
#             Its path must match ^/[A-Za-z0-9._/-]+$ (it goes into a shell line and a systemd unit).
#   --root    must not merely resolve to / (a symlink): give exactly / for a real install.
# Exit: 0 done; 2 bad arguments, or the root is read-only (overlay on) or /boot/firmware is ro (nothing written);
#   1 a file was refused (a symlink at any part of its path, a cmdline.txt or config.txt that is missing or malformed
#   or has no root=, or hooks skipped as ~/.claude is on the locked data): left as it was, everything else done,
#   fix it and re-run; 3 (or any other code, 1 included when setup.mjs itself could not load) setup.mjs failed part way:
#   nothing after that point was done, the hooks were not installed, no "done" line. (setup.mjs alone uses 4 for
#   "a file was refused", 2 bad arguments, 3 a crash; install.sh maps 4 to its own 1 and 2 to its own 2.)
# What it changes (see pi/setup.mjs): /boot/firmware/cmdline.txt and config.txt (quiet boot, rotated console),
#   /etc/lightdm/lightdm.conf (autologin), udev rules (dongle, touch rotation), /etc/systemd/user/revview.service
#   and its enable symlink, /var/lib/systemd/linger/<user>, /etc/revview/server.env and /etc/revview/buttons.json
#   (the owner's files, the USB ids and key map, are edited there; server.env is only written if missing, buttons.json
#   is created if missing and merged on an update, see below;
#   the udev dongle rule is regenerated from the ids in /etc/revview/buttons.json on every run),
#   ~/.config/labwc/autostart (kiosk, no desktop), the user's Claude Code hooks, packages, groups input, audio and video.
#   A changed file that existed gets a copy once: <file>.revview-backup.
# Key map on update: setup.mjs merges three versions of buttons.json per key (an array is one value): the shipped
#   one it recorded at its last run (/var/lib/revview/buttons.shipped.json, root-owned 0644), the new config/buttons.json,
#   and your /etc/revview/buttons.json. Keys you did not change follow the update, keys you changed are kept. If you
#   both changed the same key differently it stops for that file (exit 1 from here, nothing written for the key map;
#   it prints the diff command). A rewrite uses the shipped layout (comments do not exist in JSON; your own layout
#   is lost, never your values), first saves your file as buttons.json.revview-backup-<UTC stamp> (the newest 3 are
#   kept), and is atomic. A file that already equals the merge result is not touched. No recorded version (first
#   update of an install from before the merge): equal to the new shipped file, the version is recorded; else the
#   file is kept, a note says so and --adopt-buttons-base adopts it. --dry-run says what would happen.
# Re-run it any time: it is idempotent. Then reboot.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
user=""
rotate=90
output="HDMI-A-1"
root="/"
dry=0
apt=1
adopt=0
dir=""

die() { echo "install.sh: $*" >&2; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --user) [ $# -ge 2 ] || die "--user needs a value"; user="$2"; shift 2 ;;
    --rotate) [ $# -ge 2 ] || die "--rotate needs a value"; rotate="$2"; shift 2 ;;
    --output) [ $# -ge 2 ] || die "--output needs a value"; output="$2"; shift 2 ;;
    --root) [ $# -ge 2 ] || die "--root needs a value"; root="$2"; shift 2 ;;
    --dry-run) dry=1; shift ;;
    --no-apt) apt=0; shift ;;
    --adopt-buttons-base) adopt=1; shift ;;
    -*) die "unknown option $1" ;;
    *) [ -z "$dir" ] || die "only one REVVIEW_DIR"; dir="$1"; shift ;;
  esac
done

[ -n "$user" ] || die "--user NAME is required (the login user of the kiosk)"
[[ "$user" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die "bad user name: $user"
[ "$user" != "root" ] || die "the kiosk user must not be root"
case "$rotate" in 90 | 270) ;; *) die "--rotate must be 90 or 270" ;; esac
[[ "$output" =~ ^[A-Za-z0-9-]+$ ]] || die "bad --output: $output"
[ -d "$root" ] || die "--root is not a directory: $root"
given_root="$root"
root="$(cd "$root" && pwd -P)"
# A --root that only resolves to / (a symlink, "/." ...) would be a real install by accident: say / to mean it.
if [ "$root" = "/" ] && [ "$given_root" != "/" ]; then die "--root $given_root resolves to /; pass exactly / for a real install"; fi

# shellcheck source=/dev/null
. "$here/lib.sh"
# Before anything is written (also with --dry-run): not under the read-only root, and /boot/firmware is written.
revview_refuse_if_readonly "$root" install.sh boot
if [ "$(revview_cmdline_overlay "$root/boot/firmware/cmdline.txt")" = on ]; then
  echo "note: the read-only root is turned on for the next boot: what this run writes is kept"
fi

dir="$(cd "${dir:-$here/..}" && pwd)"
case "$dir" in
  /*) ;;
  *) die "REVVIEW_DIR must be absolute: $dir" ;;
esac
# The same allow-list as pi/setup.mjs: the path goes into a shell line and a systemd unit.
if [[ ! "$dir" =~ ^/[A-Za-z0-9._/-]+$ ]]; then die "REVVIEW_DIR must match ^/[A-Za-z0-9._/-]+\$ (letters, digits, . _ - and / only): $dir"; fi

real=0
[ "$root" = "/" ] && real=1
rp=""
[ "$real" -eq 1 ] || rp="$root"
if [ "$real" -eq 1 ] && [ "$dry" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then
  die "run as root: sudo bash $0 ..."
fi

# The user must exist: uid, gid and home.
if [ "$real" -eq 1 ]; then
  entry="$(getent passwd "$user" || true)"
else
  entry="$(grep "^$user:" "$root/etc/passwd" 2> /dev/null | head -n 1 || true)"
fi
[ -n "$entry" ] || die "user $user does not exist (create it first, or pass the user the desktop logs in as)"
IFS=: read -r _ _ uid gid _ home _ <<< "$entry"
case "$home" in /*) ;; *) die "home of $user is not absolute: $home" ;; esac

echo "user $user ($uid:$gid), home $home, repo $dir, rotate $rotate, output $output, root $root"

# Packages.
# overlayroot: raspi-config's overlay would otherwise apt-get it at `readonly.sh enable` time (needs a network).
pkgs="chromium tmux python3 espeak-ng wlr-randr sox overlayroot"
if [ "$real" -eq 1 ] && [ "$apt" -eq 1 ]; then
  missing=()
  for p in $pkgs; do
    dpkg -s "$p" > /dev/null 2>&1 || missing+=("$p")
  done
  if [ ${#missing[@]} -eq 0 ]; then
    echo "packages: all present"
  elif [ "$dry" -eq 1 ]; then
    echo "would install packages: ${missing[*]}"
  else
    apt-get update
    apt-get install -y --no-install-recommends "${missing[@]}"
    echo "installed packages: ${missing[*]}"
  fi
else
  echo "skipped packages (--no-apt or fake root); needed: $pkgs"
fi

# Node: check only.
node_bin="$(command -v node || true)"
if [ -z "$node_bin" ]; then
  echo "warning: node not found; the unit will use /usr/bin/node. Install Node 22 or newer." >&2
  node_bin="/usr/bin/node"
else
  # not resolved through symlinks: an upgrade that moves the real binary keeps working
  case "$node_bin" in /home/* | /root/*) echo "warning: node is in a home ($node_bin); the unit needs it outside the home (part B encrypts the home's data)" >&2 ;; esac
  major="$("$node_bin" -p 'process.versions.node.split(".")[0]' 2> /dev/null || echo 0)"
  if [ "$major" -lt 22 ]; then echo "warning: node $major found, revview needs 22 or newer" >&2; fi
fi
for need in python3 tmux; do
  command -v "$need" > /dev/null || echo "warning: $need not found" >&2
done

# Groups: input (buttons), audio, and video (vcgencmd, package raspi-utils-core, talks to /dev/vcio_gencmd, which raspberrypi-sys-mods' 10-vc.rules gives group video).
if [ "$real" -eq 1 ] && [ "$dry" -eq 0 ]; then
  usermod --append --groups input,audio,video "$user"
  echo "added $user to groups input,audio,video"
else
  echo "would add $user to groups input,audio,video"
fi

# Leftover of the old set-up: a system unit run as the user "revview".
old="$rp/etc/systemd/system/revview.service"
if [ -e "$old" ]; then
  if [ "$dry" -eq 1 ]; then
    echo "would remove the old system unit $old"
  else
    if [ "$real" -eq 1 ]; then systemctl disable --now revview.service || true; fi
    rm -f "$old"
    echo "removed the old system unit $old"
  fi
  echo "the revview system user is no longer used; remove it with: userdel revview"
fi

# Files.
setup_args=(--root "$root" --user "$user" --home "$home" --dir "$dir" --rotate "$rotate" --output "$output" --node "$node_bin" --owner "$uid:$gid")
if [ "$dry" -eq 1 ]; then setup_args+=(--dry-run); fi
if [ "$adopt" -eq 1 ]; then setup_args+=(--adopt-buttons-base); fi
# setup.mjs exits 4 when it refused a file (a symlink, a cmdline.txt without root=): the rest still runs, the exit
# code of this script ends as 1. 2 = bad arguments: stop. Anything else (3 a crash, 1 node could not even load it,
# a signal) = failed part way: stop. 1 is deliberately NOT "refused": node uses it for an uncaught error.
setup_rc=0
"$node_bin" "$here/setup.mjs" "${setup_args[@]}" || setup_rc=$?
case "$setup_rc" in
  0) ;;
  4) echo "install.sh: some files were refused (see the skipped lines above); fix them and run it again" >&2; setup_rc=1 ;;
  2)
    echo "install.sh: setup.mjs refused the arguments (see above); nothing was written" >&2
    exit 2
    ;;
  *)
    echo "install.sh: setup.mjs failed part way (exit $setup_rc); nothing after that point was done, the hooks were not installed; fix the error above and run it again" >&2
    exit "$setup_rc"
    ;;
esac

# Claude Code hooks for that user. ~/.claude may be a symlink into the locked data partition (pi/data-setup.sh):
# while the target is missing, writing through it would fail (or make a stray directory), so skip and say so.
hooks_locked=0
dangling=""
claude_link="$root$home/.claude"
if [ -L "$claude_link" ]; then
  target="$(readlink "$claude_link")"
  case "$target" in
    /*) [ -d "$root$target" ] || { hooks_locked=1; dangling="$target"; } ;;
    *) [ -d "$claude_link" ] || { hooks_locked=1; dangling="$target"; } ;;
  esac
fi
if [ "$hooks_locked" -eq 1 ]; then
  echo "skipped hooks: ~/.claude is a link to $dangling, which does not exist; if that is the locked data partition, insert the key stick (or run pi/unlock.sh) and run this again"
  setup_rc=1
elif [ "$dry" -eq 1 ]; then
  echo "would install the Claude Code hooks for $user"
elif [ "$real" -eq 1 ]; then
  runuser -u "$user" -- env HOME="$home" "$node_bin" "$dir/hooks/install.mjs"
else
  node "$dir/hooks/install.mjs" --settings "$root$home/.claude/settings.json"
fi

if [ "$real" -eq 1 ] && [ "$dry" -eq 0 ]; then
  udevadm control --reload
  udevadm trigger --subsystem-match=input
  systemctl daemon-reload
fi

if [ "$setup_rc" -ne 0 ]; then
  echo "not done: some files were refused (a skipped line above says which and why); fix that and run install.sh again. Do not reboot for this yet." >&2
  exit "$setup_rc"
fi

cat << EOF
done. Next:
  - reboot to start everything (kiosk, server, boot screen);
  - sign in to Claude Code as $user if not done: run \`claude\` once in a terminal;
  - logs: sudo journalctl --user-unit=revview  (Pi OS keeps the journal in memory only, so journalctl --user shows nothing)
  - dongle ids and keys: edit /etc/revview/buttons.json with sudo (sudoedit; the file is root-owned, mode 0644; USB ids and keys; kept by every re-run; an update merges it with the new default per key), then run
    sudo bash $dir/pi/install.sh --user $user $dir  again (with the same options as now) to regenerate the udev rule,
    and restart as $user:
    systemctl --user restart revview  (or reboot).
EOF
exit 0
