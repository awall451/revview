#!/bin/bash
# Turn the Pi's read-only root (raspi-config's overlay file system) on or off, or show its state.
# UNTESTED on a Pi; tested only against a fake root and a stub raspi-config (tests/unit/pi-readonly.test.js).
# EVERY raspi-config command below is FROM MEMORY (no documentation reachable, no Pi): `nonint do_overlayfs 0|1`
# (on|off) and `nonint enable_bootro` / `nonint disable_bootro` (the boot partition read-only option). Bench item.
# Usage: sudo bash pi/readonly.sh status|enable|disable [--root DIR] [--dry-run]
#   status   overlay now, boot partition now, and what the next boot will do (from cmdline.txt and fstab)
#   enable   turn the overlay and the read-only boot partition on (takes effect at the next boot). Run it LAST.
#   disable  to update: round 1 (overlay on) turns the overlay off; after the reboot, round 2 turns the boot
#            partition's read-only option off. Then update (pi/README.md, Updating), then enable.
#   --root     act on this directory tree instead of / (a fake root for tests: <root>/proc/mounts,
#              <root>/boot/firmware/cmdline.txt, <root>/etc/fstab; remount and reboot are not run, "would ..." is printed)
#   --dry-run  print the commands, run nothing
# The environment variable REVVIEW_RASPI_CONFIG replaces the raspi-config command: it exists ONLY so tests can
# point at a stub.
# Exit: 0 done; 2 bad arguments or refused (enable while the overlay is on); 1 raspi-config did not do what we expected.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$here/lib.sh"

die() { echo "readonly.sh: $*" >&2; exit 2; }

cmd=""
root="/"
dry=0
while [ $# -gt 0 ]; do
  case "$1" in
    --root) [ $# -ge 2 ] || die "--root needs a value"; root="$2"; shift 2 ;;
    --dry-run) dry=1; shift ;;
    -*) die "unknown option $1" ;;
    *) [ -z "$cmd" ] || die "only one subcommand"; cmd="$1"; shift ;;
  esac
done
case "$cmd" in status | enable | disable) ;; *) die "usage: readonly.sh status|enable|disable [--root DIR] [--dry-run]" ;; esac

[ -d "$root" ] || die "--root is not a directory: $root"
given_root="$root"
root="$(cd "$root" && pwd -P)"
if [ "$root" = "/" ] && [ "$given_root" != "/" ]; then die "--root $given_root resolves to /; pass exactly / for a real run"; fi
real=0
[ "$root" = "/" ] && real=1
if [ "$cmd" != status ] && [ "$real" -eq 1 ] && [ "$dry" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then
  die "run as root: sudo bash $0 $cmd"
fi

rc_bin="${REVVIEW_RASPI_CONFIG:-raspi-config}"
cmdline="$root/boot/firmware/cmdline.txt"
fstab="$root/etc/fstab"

# "on" when cmdline.txt has an overlayroot= token, "off" when it has none, "unknown" when it cannot be read.
next_overlay() {
  [ -r "$cmdline" ] || { echo unknown; return; }
  if grep -Eq '(^|[[:space:]])overlayroot=' "$cmdline"; then echo on; else echo off; fi
}
# "on" when the /boot/firmware line of fstab has ro in its options, "off" when it has none, "unknown" without fstab.
next_bootro() {
  [ -r "$fstab" ] || { echo unknown; return; }
  awk '$1 !~ /^#/ && $2 == "/boot/firmware" { found = 1; if (("," $4 ",") ~ /,ro,/) ro = 1 }
       END { print (ro ? "on" : (found ? "off" : "unknown")) }' "$fstab"
}

# run_rc ARGS...: raspi-config nonint ARGS (only printed with --dry-run).
run_rc() {
  if [ "$dry" -eq 1 ]; then echo "would run: raspi-config nonint $*"; return 0; fi
  echo "running: raspi-config nonint $*"
  "$rc_bin" nonint "$@"
}
remount_boot_rw() {
  if [ "$real" -eq 1 ] && [ "$dry" -eq 0 ]; then
    mount -o remount,rw /boot/firmware
    echo "remounted /boot/firmware read-write"
  else
    echo "would run: mount -o remount,rw /boot/firmware"
  fi
}

overlay="$(revview_overlay_state "$root")"
bootfs="$(revview_bootfs_state "$root")"

case "$cmd" in
  status)
    echo "overlay: $overlay"
    echo "boot partition: $bootfs"
    echo "overlay at next boot: $(next_overlay)"
    echo "boot read-only at next boot: $(next_bootro)"
    ;;
  enable)
    if [ "$overlay" = on ]; then
      echo "readonly.sh: the overlay is already on" >&2
      exit 2
    fi
    run_rc do_overlayfs 0
    run_rc enable_bootro
    if [ "$dry" -eq 1 ]; then exit 0; fi
    if [ "$(next_overlay)" != on ]; then
      echo "warning: raspi-config did not do what we expected: no overlayroot= in $cmdline (its commands are from memory); check Performance Options, Overlay File System by hand" >&2
      echo "reboot to make the root read-only (only once the overlay is confirmed on)"
      exit 1
    fi
    echo "reboot to make the root read-only"
    ;;
  disable)
    if [ "$overlay" = on ]; then
      if [ "$bootfs" = ro ]; then remount_boot_rw; fi
      run_rc do_overlayfs 1
      echo "reboot, then run \`sudo bash pi/readonly.sh disable\` once more"
    elif [ "$bootfs" = ro ] || [ "$(next_bootro)" = on ]; then
      run_rc disable_bootro
      if [ "$bootfs" = ro ]; then remount_boot_rw; fi
      echo "now update (pi/README.md Updating), then enable"
    else
      echo "already off"
    fi
    ;;
esac
