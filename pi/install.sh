#!/bin/bash
# Set up the Pi as a revview kiosk. UNTESTED on a Pi: written without one; the file edits are tested only
# against a fake root in a temp dir (tests/unit/pi-install.test.js).
# Usage: sudo bash pi/install.sh --user NAME [--rotate 90|270] [--output HDMI-A-1] [--root DIR] [--dry-run]
#                                [--no-apt] [REVVIEW_DIR]
#   --user    the ordinary login user (the one the desktop auto-logs in as): runs the kiosk Chromium, the
#             server (a systemd user unit, lingering on) and the Claude sessions. Required.
#   --rotate  90 (normal mount, default) or 270 (mount flipped 180 degrees)
#   --root    act on this directory tree instead of / (a fake root for tests; no root needed, no apt,
#             no usermod, no systemctl, no udevadm)
#   REVVIEW_DIR defaults to this repository; it should live outside the home (e.g. /opt/revview), with npm ci done.
# What it changes (see pi/setup.mjs): /boot/firmware/cmdline.txt and config.txt (quiet boot, rotated console),
#   /etc/lightdm/lightdm.conf (autologin), udev rules (dongle, touch rotation), /etc/systemd/user/revview.service
#   and its enable symlink, /var/lib/systemd/linger/<user>, /etc/revview/server.env (only if missing),
#   ~/.config/labwc/autostart (kiosk, no desktop), the user's Claude Code hooks, packages, groups input and audio.
#   A changed file that existed gets a copy once: <file>.revview-backup.
# Re-run it any time: it is idempotent. Then reboot.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
user=""
rotate=90
output="HDMI-A-1"
root="/"
dry=0
apt=1
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
root="$(cd "$root" && pwd)"
dir="$(cd "${dir:-$here/..}" && pwd)"
case "$dir" in
  /*) ;;
  *) die "REVVIEW_DIR must be absolute: $dir" ;;
esac
if [[ "$dir" =~ [[:space:]@\|%\"] ]]; then die "REVVIEW_DIR must not contain spaces, @, |, % or \": $dir"; fi

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
pkgs="chromium tmux python3 espeak-ng wlr-randr"
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

# Groups: input (buttons) and audio.
if [ "$real" -eq 1 ] && [ "$dry" -eq 0 ]; then
  usermod --append --groups input,audio "$user"
  echo "added $user to groups input,audio"
else
  echo "would add $user to groups input,audio"
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
"$node_bin" "$here/setup.mjs" "${setup_args[@]}"

# Claude Code hooks for that user.
if [ "$dry" -eq 1 ]; then
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

cat << EOF
done. Next:
  - reboot to start everything (kiosk, server, boot screen);
  - sign in to Claude Code as $user if not done: run \`claude\` once in a terminal;
  - logs, as $user: journalctl --user -u revview
  - fill in the dongle's real USB ids in /etc/udev/rules.d/70-revview-dongle.rules and config/buttons.json.
EOF
