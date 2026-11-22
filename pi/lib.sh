#!/bin/bash
# Shared checks for the pi/ scripts (sourced, never run). UNTESTED on a Pi; tested against a fake root
# (tests/unit/pi-readonly.test.js, pi-install.test.js, pi-data-setup.test.js).
#
# The mount table is <root>/proc/mounts: on a real install (root /) that is the kernel's own; a fake root for
# tests may hold a hand-written one, or none (then nothing is mounted read-only and the overlay is off).

# The last /proc/mounts line for mount point $2 wins (later mounts stack on top of earlier ones).
# Prints "fstype options" of that line, or nothing when the mount point is not in the table.
revview_mount_entry() {
  local mounts="$1/proc/mounts" want="$2"
  [ -r "$mounts" ] || return 0
  awk -v want="$want" '$2 == want { last = $3 " " $4 } END { if (last != "") print last }' "$mounts"
}

# "on" when / is an overlay file system right now (raspi-config's overlay is active: every write to the root
# goes to memory and is gone at the next boot), else "off".
revview_overlay_state() {
  local e
  e="$(revview_mount_entry "$1" /)"
  case "$e" in overlay\ *) echo on ;; *) echo off ;; esac
}

# "ro" when the boot partition is mounted read-only right now, else "rw" (also when it is not mounted at all).
revview_bootfs_state() {
  local e opts
  e="$(revview_mount_entry "$1" /boot/firmware)"
  opts="${e#* }"
  case ",$opts," in *,ro,*) echo ro ;; *) echo rw ;; esac
}

# Refuse (exit 2, nothing written) when what this script writes would be lost or cannot be written:
#   $1 root, $2 script name, $3 "boot" when the script also writes /boot/firmware.
revview_refuse_if_readonly() {
  local root="$1" name="$2" needs_boot="${3:-}"
  if [ "$(revview_overlay_state "$root")" = on ]; then
    echo "$name: the read-only root (overlay) is ON: anything written now is lost at the next boot." >&2
    echo "$name: turn it off first: sudo bash pi/readonly.sh disable, reboot, then run this again (pi/README.md, Updating)." >&2
    exit 2
  fi
  if [ "$needs_boot" = boot ] && [ "$(revview_bootfs_state "$root")" = ro ]; then
    echo "$name: /boot/firmware is mounted read-only: run sudo bash pi/readonly.sh disable first (pi/README.md, Updating)." >&2
    exit 2
  fi
}
