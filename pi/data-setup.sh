#!/bin/bash
# Set up the encrypted data partition and the key stick. UNTESTED on a Pi: written without one and tested only
# against a fake root and stubbed commands (tests/unit/pi-data-setup.test.js). Run it by hand, never from a script.
# Usage: sudo bash pi/data-setup.sh --user NAME --device /dev/X --key-device /dev/Y
#          [--format [--confirm /dev/X]] [--no-recovery-passphrase] [--dry-run] [--root DIR] [REVVIEW_DIR]
#   --user        the kiosk user (the one install.sh was given); its ~/.claude, ~/.claude.json, ~/.ssh and ~/repos move
#                 onto the data partition and are replaced by symlinks to /srv/revview-data/{claude,ssh,repos}.
#   --device      the partition that holds (or will hold) the encrypted data. Never guessed, never defaulted.
#   --key-device  the USB stick's partition (vfat, exfat or ext4) that holds the key file revview/data.key.
#   --format      ERASE --device: make it LUKS2 (xchacha12,aes-adiantum-plain64), add the key file (and a recovery
#                 passphrase, asked by cryptsetup itself), make an ext4 file system, move the user's data in.
#                 Needs the device name typed again at "Type <device> to ERASE it:" (from /dev/tty) or --confirm.
#                 Without --format the device must already be LUKS; only the configuration is (re)written.
#   --no-recovery-passphrase  no second key slot. Then a lost stick means lost data.
#   --dry-run     checks the devices (reads only), prints every command that would run, writes and erases nothing.
#   --root        act on this tree instead of / (a fake root for tests: the stick is mounted under DIR/run, no systemctl).
#   REVVIEW_DIR   defaults to this repository; it is run as root at boot, so on a real root it and pi/unlock.sh must
#                 be root-owned and not group/world writable (e.g. /opt/revview). Path: ^/[A-Za-z0-9._/-]+$.
# DESTRUCTIVE (only with --format, after the confirmation): cryptsetup luksFormat on --device (everything on it is
#   gone), mkfs.ext4 on the new mapping; it also WRITES a new key file to the stick (an existing one is reused) and
#   MOVES (copy, then delete) the user's ~/.claude, ~/.claude.json, ~/.ssh and ~/repos onto the data partition.
# Key material: a file of 4096 random bytes made straight onto the mounted stick, never on the root, never printed.
# Exit: 0 done; 1 something was refused or failed after work had started (see the messages; fix and re-run);
#   2 bad arguments or refused before anything was changed (a device that is not acceptable, no confirmation,
#   the read-only root (overlay) on, a non-LUKS device without --format).
# FROM MEMORY, UNTESTED against the real tools: lsblk's column names and JSON shape (-J -b -o NAME,PATH,TYPE,FSTYPE,UUID,
#   LABEL,SIZE,MOUNTPOINTS,TRAN,RM), cryptsetup luksFormat/luksAddKey/open/isLuks/luksUUID and their options
#   (--pbkdf pbkdf2 --iter-time 500 --key-size 256), that luksAddKey --key-file asks for the NEW passphrase on the
#   terminal, mkfs.ext4 -q -L, mount options on FAT, and runuser -u.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
user=""
device=""
key_device=""
format=0
confirm=""
recovery=1
dry=0
root="/"
dir=""

readonly MAPPER=revview-data
readonly DATA_MOUNT=/srv/revview-data
readonly KEY_FILE=revview/data.key

committed=0
stick=""
stick_mounted=0
tmp=""
phase="checking"

say() { echo "data-setup.sh: $*"; }
die() { echo "data-setup.sh: $*" >&2; exit 2; }

# Runs on every exit: unmounts the stick and removes the temp dir, then makes the exit code 2 (nothing was
# changed) or 1 (work had started) for any unexpected failure.
# shellcheck disable=SC2317 # called by the EXIT trap
finish() {
  local rc=$?
  trap - EXIT
  if [ -n "$tmp" ]; then rm -rf "$tmp"; fi
  if [ "$stick_mounted" -eq 1 ]; then
    if umount "$stick"; then stick_mounted=0; else echo "data-setup.sh: could not unmount the key stick at $stick: unmount it by hand" >&2; fi
  fi
  if [ -n "$stick" ] && [ "$stick_mounted" -eq 0 ] && [ -d "$stick" ]; then rmdir "$stick" 2> /dev/null || true; fi
  if [ "$rc" -ne 0 ]; then
    if [ "$committed" -eq 1 ]; then
      if [ "$rc" -ne 1 ]; then echo "data-setup.sh: failed (exit $rc) while: $phase" >&2; fi
      rc=1
    elif [ "$rc" -ne 2 ]; then
      echo "data-setup.sh: failed (exit $rc) while: $phase; nothing was changed" >&2
      rc=2
    fi
  fi
  exit "$rc"
}
trap finish EXIT

# Print the command in --dry-run, run it otherwise.
run() {
  if [ "$dry" -eq 1 ]; then
    printf 'would run:'
    printf ' %s' "$@"
    printf '\n'
  else
    "$@"
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --user) [ $# -ge 2 ] || die "--user needs a value"; user="$2"; shift 2 ;;
    --device) [ $# -ge 2 ] || die "--device needs a value"; device="$2"; shift 2 ;;
    --key-device) [ $# -ge 2 ] || die "--key-device needs a value"; key_device="$2"; shift 2 ;;
    --confirm) [ $# -ge 2 ] || die "--confirm needs a value"; confirm="$2"; shift 2 ;;
    --root) [ $# -ge 2 ] || die "--root needs a value"; root="$2"; shift 2 ;;
    --format) format=1; shift ;;
    --no-recovery-passphrase) recovery=0; shift ;;
    --dry-run) dry=1; shift ;;
    -*) die "unknown option $1" ;;
    *) [ -z "$dir" ] || die "only one REVVIEW_DIR"; dir="$1"; shift ;;
  esac
done

[ -n "$user" ] || die "--user NAME is required (the kiosk user)"
[[ "$user" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die "bad user name: $user"
[ "$user" != "root" ] || die "the kiosk user must not be root"
[ -n "$device" ] || die "--device /dev/X is required (the partition for the encrypted data; it is never guessed)"
[ -n "$key_device" ] || die "--key-device /dev/Y is required (the USB stick's partition)"
dev_re='^/dev/[A-Za-z0-9][A-Za-z0-9_/-]*$'
if [[ ! "$device" =~ $dev_re || "$device" == *..* ]]; then die "bad --device: $device"; fi
if [[ ! "$key_device" =~ $dev_re || "$key_device" == *..* ]]; then die "bad --key-device: $key_device"; fi
[ "$device" != "$key_device" ] || die "--device and --key-device are the same: $device"
if [ -n "$confirm" ] && [ "$format" -eq 0 ]; then die "--confirm only goes with --format"; fi
[ -d "$root" ] || die "--root is not a directory: $root"
given_root="$root"
root="$(cd "$root" && pwd -P)"
if [ "$root" = "/" ] && [ "$given_root" != "/" ]; then die "--root $given_root resolves to /; pass exactly / for a real install"; fi
rb="${root%/}" # "" for the real root, else the fake root's path: prefix for every path of the machine

# shellcheck source=/dev/null
. "$here/lib.sh"
revview_refuse_if_readonly "$root" data-setup.sh

dir="$(cd "${dir:-$here/..}" && pwd)"
if [[ ! "$dir" =~ ^/[A-Za-z0-9._/-]+$ ]]; then die "REVVIEW_DIR must match ^/[A-Za-z0-9._/-]+\$ (letters, digits, . _ - and / only): $dir"; fi

real=0
[ "$root" = "/" ] && real=1
if [ "$real" -eq 1 ] && [ "$dry" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then
  die "run as root: sudo bash $0 ..."
fi

if [ "$real" -eq 1 ]; then
  entry="$(getent passwd "$user" || true)"
else
  entry="$(grep "^$user:" "$root/etc/passwd" 2> /dev/null | head -n 1 || true)"
fi
[ -n "$entry" ] || die "user $user does not exist"
IFS=: read -r _ _ uid gid _ home _ <<< "$entry"
[[ "$home" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "home of $user must match ^/[A-Za-z0-9._/-]+\$: $home"
if [[ ! "$uid" =~ ^[0-9]+$ || ! "$gid" =~ ^[0-9]+$ ]]; then die "bad uid/gid of $user"; fi
[ "$uid" -ne 0 ] || die "user $user has uid 0; the kiosk user must not be root"
rhome="$rb$home"
mnt="$rb$DATA_MOUNT"

node_bin="$(command -v node || true)"
[ -n "$node_bin" ] || die "node not found"
command -v lsblk > /dev/null || die "lsblk not found"
command -v cryptsetup > /dev/null || die "cryptsetup not found (apt install cryptsetup)"

tmp="$(mktemp -d)"

# ---- the devices: read-only checks, nothing is changed yet ----
phase="listing the block devices"
lsblk -J -b -o NAME,PATH,TYPE,FSTYPE,UUID,LABEL,SIZE,MOUNTPOINTS,TRAN,RM > "$tmp/lsblk.json"
mounts_file="$rb/proc/mounts"
[ -r "$mounts_file" ] || mounts_file=/dev/null
phase="checking the devices"
if ! "$node_bin" "$here/data.mjs" check --lsblk "$tmp/lsblk.json" --mounts "$mounts_file" --device "$device" --key-device "$key_device" > "$tmp/facts.json"; then
  die "the devices are not acceptable (see above); nothing was changed"
fi
fact() {
  "$node_bin" -e 'let v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
for (const k of process.argv[2].split(".")) v = v == null ? v : v[k];
process.stdout.write(v == null ? "" : String(v));' "$tmp/facts.json" "$1" | tr -cd '[:print:]'
}
key_uuid="$(fact key.uuid)"
if ! [[ "$key_uuid" =~ ^[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}$ || "$key_uuid" =~ ^[0-9A-Fa-f]{16}$ \
  || "$key_uuid" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
  die "the key stick's UUID is not usable: $key_uuid"
fi
if [ -e "$rb/dev/mapper/$MAPPER" ] && [ "$format" -eq 1 ]; then die "/dev/mapper/$MAPPER already exists (the data is open): close it first (cryptsetup close $MAPPER)"; fi
if [ -r "$mounts_file" ] && awk -v m="$DATA_MOUNT" '$2 == m { f = 1 } END { exit !f }' "$mounts_file"; then
  die "$DATA_MOUNT is already a mount point: unmount it first"
fi

data_fstype="$(fact data.fstype)"
data_label="$(fact data.label)"
echo "data device: $(fact data.path), $(fact data.size) bytes, file system: ${data_fstype:-none}, label: ${data_label:-none}"
echo "key stick:   $(fact key.path), file system: $(fact key.fstype), UUID $key_uuid"
echo "user $user ($uid:$gid), home $home, repo $dir, root $root"

# Everything that would be written, checked before the first destructive step: arguments, templates and (real root)
# that the repository is root-owned. Dummy data UUID; no output, nothing written.
phase="checking the configuration"
dummy_uuid="00000000-0000-0000-0000-000000000000"
if ! "$node_bin" "$here/data.mjs" write --root "$root" --user "$user" --home "$home" --dir "$dir" --data-uuid "$dummy_uuid" \
  --key-uuid "$key_uuid" --owner "$uid:$gid" --dry-run > /dev/null; then
  die "the configuration cannot be written (see above); nothing was changed"
fi

if [ "$format" -eq 0 ]; then
  cryptsetup isLuks "$device" > /dev/null 2>&1 || die "$device is not a LUKS device: use --format to make it one (that ERASES it)"
else
  echo
  echo "--format will ERASE $device (data device above) and make it an encrypted partition."
  if [ -n "$confirm" ]; then
    [ "$confirm" = "$device" ] || die "--confirm $confirm is not the device $device: nothing was done"
  elif [ "$dry" -eq 0 ]; then
    { printf 'Type %s to ERASE it: ' "$device" > /dev/tty; } 2> /dev/null || die "no terminal to ask on: give --confirm $device; nothing was done"
    typed=""
    { IFS= read -r typed < /dev/tty; } 2> /dev/null || die "no answer: nothing was done"
    [ "$typed" = "$device" ] || die "not confirmed: nothing was done"
  else
    say "--dry-run: the confirmation would be asked here"
  fi
fi

# ---- --format: from here on things change ----
data_uuid=""
failed=0
if [ "$format" -eq 1 ]; then
  [ "$dry" -eq 1 ] || committed=1
  umask 077
  if [ "$dry" -eq 1 ]; then
    stick="/run/revview-key.XXXXXX"
  else
    phase="mounting the key stick"
    mkdir -p "$rb/run"
    stick="$(mktemp -d "$rb/run/revview-key.XXXXXX")"
    chmod 700 "$stick"
  fi
  key="$stick/$KEY_FILE"
  run mount -o rw,nosuid,nodev,noexec "$key_device" "$stick"
  stick_mounted=$((1 - dry))

  phase="making the key file on the stick"
  if [ "$dry" -eq 1 ]; then
    echo "would run: mkdir -p $stick/revview"
    echo "would run: (if $key does not exist) head -c 4096 /dev/urandom > $key"
  else
    mkdir -p "$stick/revview"
    if [ -L "$key" ]; then
      die "$KEY_FILE on the stick is a symlink; remove it"
    elif [ -e "$key" ]; then
      if [ ! -f "$key" ] || [ "$(wc -c < "$key")" -ne 4096 ]; then die "$KEY_FILE on the stick exists but is not a regular file of 4096 bytes: move it away"; fi
      say "reusing the key file $KEY_FILE already on the stick"
    else
      head -c 4096 /dev/urandom > "$key"
      [ "$(wc -c < "$key")" -eq 4096 ] || { rm -f "$key"; die "could not write the key file"; }
      sync "$key" 2> /dev/null || sync
      say "made the key file $KEY_FILE on the stick (4096 random bytes; it exists nowhere else)"
    fi
  fi

  phase="formatting $device"
  run cryptsetup luksFormat --batch-mode --type luks2 --cipher xchacha12,aes-adiantum-plain64 --key-size 256 \
    --pbkdf pbkdf2 --iter-time 500 --key-file "$key" "$device"
  if [ "$recovery" -eq 1 ]; then
    phase="adding the recovery passphrase"
    say "cryptsetup now asks for the recovery passphrase (the way in if the stick is lost): write it down and keep it apart"
    run cryptsetup luksAddKey --key-file "$key" "$device"
  else
    say "no recovery passphrase: a lost stick means the data is gone"
  fi
  phase="opening $device"
  run cryptsetup open --type luks2 --key-file "$key" "$device" "$MAPPER"

  phase="unmounting the key stick"
  if [ "$dry" -eq 1 ]; then
    echo "would run: umount $stick"
    echo "would run: rmdir $stick"
  else
    umount "$stick"
    stick_mounted=0
    rmdir "$stick"
    stick=""
  fi

  phase="making the file system"
  run mkfs.ext4 -q -L "$MAPPER" "/dev/mapper/$MAPPER"
  phase="mounting the data"
  run mkdir -p "$mnt"
  run chmod 755 "$mnt"
  run mount -o noatime,nosuid,nodev "/dev/mapper/$MAPPER" "$mnt"
  for d in claude ssh repos; do
    run mkdir -p "$mnt/$d"
    run chown "$uid:$gid" "$mnt/$d"
    run chmod 700 "$mnt/$d"
  done

  # Move the user's data: everything is done AS the user (copy, delete, link), so root never walks into a path the
  # user can change. A symlink that is not ours is never followed: that item is refused.
  phase="moving the user's data"
  asuser() { run runuser -u "$user" -- "$@"; }
  is_ours() { [ -L "$1" ] && [ "$(readlink "$1")" = "$2" ]; }
  move_dir() { # $1 name in the home, $2 name on the data partition
    local src="$rhome/$1" target="$DATA_MOUNT/$2"
    if is_ours "$src" "$target"; then say "$src is already linked to $target"; return 0; fi
    if [ -L "$src" ]; then
      echo "data-setup.sh: $src is a symlink to somewhere else ($(readlink "$src")): not moved; remove or fix it and move its content by hand" >&2
      failed=1
      return 0
    fi
    if [ -e "$src" ]; then
      if [ ! -d "$src" ]; then
        echo "data-setup.sh: $src is not a directory: not moved" >&2
        failed=1
        return 0
      fi
      asuser cp -a "$src/." "$mnt/$2/"
      asuser chmod 700 "$mnt/$2" # cp -a gave the top directory the old one's mode
      asuser rm -rf -- "$src"
      say "moved $src to $target"
    fi
    asuser ln -s "$target" "$src"
  }
  move_dir .claude claude
  src="$rhome/.claude.json"
  if [ -L "$src" ]; then
    echo "data-setup.sh: $src is a symlink: not moved" >&2
    failed=1
  elif [ -f "$src" ]; then
    asuser cp -a "$src" "$mnt/claude/.claude.json"
    asuser rm -f -- "$src"
    say "moved $src into the data partition (claude/.claude.json)"
  fi
  move_dir .ssh ssh
  move_dir repos repos
  cat << 'EOF'

WARNING: the old copies of ~/.claude, ~/.claude.json, ~/.ssh and ~/repos were deleted from the SD card, but
flash storage may still hold them readable (wear levelling: deleting does not erase). The safe course: sign in
to Claude Code again after the next boot, and REPLACE the push keys and tokens (docs/REVOKE.md).
EOF
fi

# ---- both modes: the configuration ----
phase="reading the LUKS UUID"
if [ "$format" -eq 1 ] && [ "$dry" -eq 1 ]; then
  data_uuid="$dummy_uuid"
  say "--dry-run: the LUKS UUID does not exist yet; a placeholder is used below"
else
  data_uuid="$(cryptsetup luksUUID "$device" | tr -d '[:space:]')"
fi
[[ "$data_uuid" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || die "unexpected LUKS UUID: $data_uuid"

phase="writing the configuration"
[ "$dry" -eq 1 ] || committed=1
write_args=(--root "$root" --user "$user" --home "$home" --dir "$dir" --data-uuid "$data_uuid" --key-uuid "$key_uuid" --owner "$uid:$gid")
if [ "$dry" -eq 1 ]; then write_args+=(--dry-run); fi
rc=0
"$node_bin" "$here/data.mjs" write "${write_args[@]}" || rc=$?
if [ "$rc" -ne 0 ]; then failed=1; fi

if [ "$real" -eq 1 ] && [ "$dry" -eq 0 ]; then
  phase="reloading udev and systemd"
  udevadm control --reload
  systemctl daemon-reload
fi

if [ "$dry" -eq 1 ]; then
  echo "dry run: nothing was changed."
  exit "$failed"
fi
cat << EOF
done. Next:
  - reboot with the key stick in: the data unlocks by itself at boot (INSERT KEY on the bar means it did not);
  - without the stick in, plug it in later (the unlock starts by itself) or run: sudo bash $dir/pi/unlock.sh
  - then run pi/install.sh again if its hooks were skipped, and sign in to Claude Code again (docs/REVOKE.md).
EOF
if [ "$failed" -eq 1 ]; then
  echo "data-setup.sh: something was refused or failed (see above); fix it and run again" >&2
  exit 1
fi
exit 0
