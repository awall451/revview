#!/bin/bash
# Unlock the encrypted data partition with the key stick and mount it. Run as root by revview-unlock.service
# (at boot) and again by the udev rule 72-revview-key.rules when the stick is plugged in later.
# UNTESTED on a Pi: written without one. Only the logic is tested, against a fake root and stub commands
# (tests/unit/pi-unlock.test.js). From memory, not checked against any documentation or device:
#   - cryptsetup: `cryptsetup open --type luks2 --key-file FILE DEVICE NAME`
#   - mountpoint -q DIR (exit 0 when DIR is a mount point)
#   - udev's /dev/disk/by-uuid/<UUID> links: the LUKS UUID for a LUKS partition, the file system UUID for FAT
#     (XXXX-XXXX), exFAT/NTFS (16 hex digits) and ext4 (36 chars)
#   - e2fsck -p exit status: 0 clean, 1 errors fixed, 2 fixed and a reboot is advised, 4 or more not fixed
#   - mount options ro,nosuid,nodev,noexec (stick) and noatime,nosuid,nodev (data)
# Usage: unlock.sh [--root DIR]
#   --root  act on this tree instead of / (tests: device nodes are checked with -e, not -b; no uid check)
# Reads /etc/revview/data.conf as DATA, never sourced: lines KEY=value, '#' comments and blank lines ignored,
#   unknown keys ignored, DATA_UUID, KEY_UUID and KEY_FILE each exactly once, each checked against an allow-list.
# The key is never copied, printed or logged: only its path is handed to cryptsetup.
# Exit: 0 unlocked (or already), or the stick is simply not there; 1 any refusal or error (the data stays
#   locked or unmounted); 2 bad arguments.
set -euo pipefail

CONF=/etc/revview/data.conf
MAPPER_NAME=revview-data
MAPPER=/dev/mapper/$MAPPER_NAME
MNT=/srv/revview-data
KEYDIR=/run/revview-key
LOCK=/run/revview-unlock.lock
POKE_URL=http://127.0.0.1:8138/event

root="/"
while [ $# -gt 0 ]; do
  case "$1" in
    --root)
      [ $# -ge 2 ] || { echo "unlock.sh: --root needs a value" >&2; exit 2; }
      root="$2"
      shift 2
      ;;
    *)
      echo "unlock.sh: unknown argument $1" >&2
      exit 2
      ;;
  esac
done
[ -d "$root" ] || { echo "unlock.sh: --root is not a directory: $root" >&2; exit 2; }
given_root="$root"
root="$(cd "$root" && pwd -P)"
if [ "$root" = "/" ] && [ "$given_root" != "/" ]; then
  echo "unlock.sh: --root $given_root resolves to /; pass exactly / for a real run" >&2
  exit 2
fi
real=0
rp=""
if [ "$root" = "/" ]; then real=1; else rp="$root"; fi
if [ "$real" -eq 1 ] && [ "$(id -u)" -ne 0 ]; then
  echo "unlock.sh: run as root" >&2
  exit 2
fi

fail() {
  echo "unlock.sh: $*" >&2
  exit 1
}

# A device node: a block device on a real root, any file in a fake root.
is_dev() { if [ "$real" -eq 1 ]; then [ -b "$1" ]; else [ -e "$1" ]; fi; }

# $1 true|false (locked). The server re-reads the mount table itself; the value is not trusted.
poke() {
  command -v curl > /dev/null 2>&1 || return 0
  curl -s -m 2 -o /dev/null -X POST -H 'content-type: application/json' \
    --data "{\"hook_event_name\":\"RevviewDataLock\",\"locked\":$1}" "$POKE_URL" > /dev/null 2>&1 || true
}

# One instance at a time (boot and the udev rule can race).
mkdir -p "$rp/run"
exec 9> "$rp$LOCK"
flock 9

# Configuration, strict.
conf="$rp$CONF"
{ [ -f "$conf" ] && [ ! -L "$conf" ]; } || fail "$CONF is missing (or a symlink): run pi/data-setup.sh"
data_uuid="" key_uuid="" key_file=""
seen_d=0 seen_k=0 seen_f=0
while IFS= read -r line || [ -n "$line" ]; do
  if [[ "$line" =~ ^[[:space:]]*(#.*)?$ ]]; then continue; fi
  [[ "$line" == *=* ]] || fail "$CONF: a line without '=' (only comments and blank lines are allowed)"
  k="${line%%=*}"
  v="${line#*=}"
  case "$k" in
    DATA_UUID) seen_d=$((seen_d + 1)); data_uuid="$v" ;;
    KEY_UUID) seen_k=$((seen_k + 1)); key_uuid="$v" ;;
    KEY_FILE) seen_f=$((seen_f + 1)); key_file="$v" ;;
    *) ;;
  esac
done < "$conf"
[ "$seen_d" -eq 1 ] || fail "$CONF: DATA_UUID must appear exactly once"
[ "$seen_k" -eq 1 ] || fail "$CONF: KEY_UUID must appear exactly once"
[ "$seen_f" -eq 1 ] || fail "$CONF: KEY_FILE must appear exactly once"
uuid36='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
[[ "$data_uuid" =~ $uuid36 ]] || fail "$CONF: bad DATA_UUID"
if ! [[ "$key_uuid" =~ ^[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}$ ]] && ! [[ "$key_uuid" =~ ^[0-9A-Fa-f]{16}$ ]] \
  && ! [[ "$key_uuid" =~ $uuid36 ]]; then
  fail "$CONF: bad KEY_UUID"
fi
[[ "$key_file" =~ ^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$ ]] || fail "$CONF: bad KEY_FILE"
IFS=/ read -r -a key_parts <<< "$key_file"
for part in "${key_parts[@]}"; do
  case "$part" in . | ..) fail "$CONF: bad KEY_FILE (no . or .. components)" ;; *) ;; esac
done

if mountpoint -q "$rp$MNT"; then
  echo "already unlocked"
  poke false
  exit 0
fi

stick="$rp/dev/disk/by-uuid/$key_uuid"
if ! is_dev "$stick"; then
  echo "data locked: key stick not found (insert it; it unlocks by itself)"
  poke true
  exit 0
fi

stick_mounted=0
release_stick() {
  if [ "$stick_mounted" -eq 1 ]; then
    umount "$rp$KEYDIR" || echo "unlock.sh: could not unmount the key stick at $KEYDIR" >&2
    stick_mounted=0
  fi
  rmdir "$rp$KEYDIR" 2> /dev/null || true
}

if [ ! -e "$rp$MAPPER" ]; then
  data_dev="$rp/dev/disk/by-uuid/$data_uuid"
  is_dev "$data_dev" || fail "data partition not found ($data_uuid)"
  kd="$rp$KEYDIR"
  if [ -L "$kd" ]; then fail "$KEYDIR is a symlink: refused"; fi
  if [ -e "$kd" ]; then
    [ -d "$kd" ] || fail "$KEYDIR is not a directory: refused"
    if [ "$real" -eq 1 ] && [ "$(stat -c %u "$kd")" != "0" ]; then fail "$KEYDIR is not owned by root: refused"; fi
  else
    mkdir -m 0700 "$kd"
  fi
  trap release_stick EXIT
  trap 'exit 1' INT TERM
  mount -o ro,nosuid,nodev,noexec "$stick" "$kd" || fail "cannot mount the key stick"
  stick_mounted=1

  key="$kd"
  for part in "${key_parts[@]}"; do
    key="$key/$part"
    if [ -L "$key" ]; then fail "key path contains a symlink: refused"; fi
  done
  [ -f "$key" ] || fail "the key file is not a regular file on the stick: refused"
  size="$(stat -c %s "$key")"
  { [[ "$size" =~ ^[0-9]+$ ]] && [ "$size" -ge 32 ] && [ "$size" -le 8192 ]; } || fail "the key file has a wrong size: refused"

  if ! cryptsetup open --type luks2 --key-file "$key" "$data_dev" "$MAPPER_NAME" > /dev/null; then
    fail "the key on the stick does not open the data partition"
  fi
  release_stick
  trap - EXIT
fi

fsck_rc=0
e2fsck -p "$rp$MAPPER" || fsck_rc=$?
if [ "$fsck_rc" -ge 4 ]; then
  fail "file system check failed: run e2fsck by hand"
elif [ "$fsck_rc" -eq 2 ]; then
  echo "file system repaired, a reboot is advised"
fi

{ [ -d "$rp$MNT" ] && [ ! -L "$rp$MNT" ]; } || fail "$MNT is missing or not a plain directory"
mount -o noatime,nosuid,nodev "$rp$MAPPER" "$rp$MNT" || fail "cannot mount the data partition"
echo "unlocked"
poke false
exit 0
