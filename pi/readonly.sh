#!/bin/bash
# Turn the Pi's read-only root (raspi-config's overlay file system) on or off, or show its state.
# UNTESTED on a Pi; tested only against a fake root and a stub raspi-config (tests/unit/pi-readonly.test.js).
# The raspi-config command names and file layout were checked against the real raspi-config-core 20261026+2 and
# overlayroot 0.18.debian14 packages: `nonint do_overlayfs 0|1` (on|off; on also installs overlayroot with apt-get if
# missing, prepends overlayroot=tmpfs to cmdline.txt, and when the overlay is not active now also applies
# enable_bootro / disable_bootro itself), `nonint enable_bootro` / `nonint disable_bootro` (fstab ro on
# /boot/firmware; each adds or removes ONE ,ro). Behaviour on a Pi is still untested (bench item).
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
# Exit codes:
#   0  done (or already off)
#   2  bad arguments, or refused before anything ran: enable while the overlay is on; enable without the overlayroot
#      package; enable when the /boot/firmware line in fstab has no "defaults" in its options (enable_bootro would
#      silently do nothing). The enable refusals apply to enable --dry-run too.
#   1  raspi-config did not do what we expected: cmdline.txt or fstab not as wanted afterwards; disable found ro in
#      fstab in a form raspi-config cannot remove (only defaults,ro is removed: edit /etc/fstab by hand); disable
#      left overlayroot=tmpfs in cmdline.txt. (disable's checks after raspi-config ran are skipped with --dry-run.)
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

# "on" / "off" / "unknown" for the overlay at the next boot (revview_cmdline_overlay in lib.sh).
next_overlay() { revview_cmdline_overlay "$cmdline"; }
# "on" when the /boot/firmware line of fstab has ro in its options, "off" when it has none, "unknown" without fstab.
next_bootro() {
  [ -r "$fstab" ] || { echo unknown; return; }
  awk '$1 !~ /^#/ && $2 == "/boot/firmware" { found = 1; if (("," $4 ",") ~ /,ro,/) ro = 1 }
       END { print (ro ? "on" : (found ? "off" : "unknown")) }' "$fstab"
}

# "yes" when the /boot/firmware line of fstab has ro in the form raspi-config's disable_bootro removes (defaults,ro).
bootro_removable() {
  [ -r "$fstab" ] || { echo no; return; }
  awk '$1 !~ /^#/ && $2 == "/boot/firmware" && (("," $4 ",") ~ /,defaults,ro,/) { f = 1 } END { print (f ? "yes" : "no") }' "$fstab"
}
# "yes" when fstab has a /boot/firmware line whose options lack defaults (enable_bootro would do nothing).
bootro_unsettable() {
  [ -r "$fstab" ] || { echo no; return; }
  awk '$1 !~ /^#/ && $2 == "/boot/firmware" && (("," $4 ",") !~ /,defaults,/) { f = 1 } END { print (f ? "yes" : "no") }' "$fstab"
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
    if [ ! -e "$root/usr/share/initramfs-tools/scripts/init-bottom/overlayroot" ]; then
      echo "readonly.sh: overlayroot is not installed; raspi-config would apt-get it (needs a network). Install it while online: sudo apt-get install overlayroot" >&2
      exit 2
    fi
    if [ "$(bootro_unsettable)" = yes ]; then
      echo "readonly.sh: the /boot/firmware line in $fstab has no \"defaults\" in its options; raspi-config's enable_bootro would do nothing and leave the boot partition writable. Add defaults to the options by hand, then run enable again." >&2
      exit 2
    fi
    run_rc do_overlayfs 0
    # do_overlayfs 0 already sets ro in fstab when the overlay is not active now; a second enable_bootro would give ,ro,ro.
    if [ "$dry" -eq 1 ]; then
      echo "would run: raspi-config nonint enable_bootro (only if fstab has no ro yet)"
      exit 0
    fi
    if [ "$(next_bootro)" != on ]; then run_rc enable_bootro; fi
    if [ "$(next_overlay)" != on ]; then
      echo "warning: raspi-config did not do what we expected: no overlayroot= in $cmdline; check raspi-config: Performance Options, P2 Overlay File System by hand" >&2
      echo "reboot to make the root read-only (only once the overlay is confirmed on)"
      exit 1
    fi
    if [ "$(next_bootro)" != on ]; then
      echo "warning: raspi-config did not set ro on /boot/firmware in fstab ($fstab)" >&2
      exit 1
    fi
    echo "reboot to make the root read-only"
    ;;
  disable)
    if [ "$overlay" = on ]; then
      # raspi-config's disable_overlayfs also remounts /boot/firmware rw itself; our remount is kept, harmless.
      if [ "$bootfs" = ro ]; then remount_boot_rw; fi
      run_rc do_overlayfs 1
      if [ "$dry" -eq 0 ] && [ "$(next_overlay)" = on ]; then
        echo "warning: $cmdline still turns the overlay on after do_overlayfs 1 (raspi-config only removes overlayroot=tmpfs when a space follows it); edit the file by hand" >&2
        exit 1
      fi
      echo "reboot, then run \`sudo bash pi/readonly.sh disable\` once more"
    elif [ "$bootfs" = ro ] || [ "$(next_bootro)" = on ]; then
      if [ "$(next_bootro)" = on ] && [ "$(bootro_removable)" = no ]; then
        echo "readonly.sh: fstab ($fstab) has ro on /boot/firmware, but raspi-config only removes defaults,ro; edit /etc/fstab by hand (remove ro from the /boot/firmware line), then run disable again" >&2
        exit 1
      fi
      # disable_bootro removes ONE ,ro: repeat while fstab still has ro (an old ,ro,ro), at most 3 calls.
      run_rc disable_bootro
      tries=1
      while [ "$dry" -eq 0 ] && [ "$(next_bootro)" = on ] && [ "$tries" -lt 3 ]; do
        run_rc disable_bootro
        tries=$((tries + 1))
      done
      if [ "$dry" -eq 0 ] && [ "$(next_bootro)" = on ]; then
        echo "warning: fstab ($fstab) still has ro on /boot/firmware after $tries calls of disable_bootro; edit it by hand" >&2
        exit 1
      fi
      if [ "$bootfs" = ro ]; then remount_boot_rw; fi
      echo "now update (pi/README.md Updating), then enable"
    else
      echo "already off"
    fi
    ;;
esac
