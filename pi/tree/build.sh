#!/bin/bash
# Build a file tree from the REAL Raspberry Pi OS Trixie arm64 packages (unpacked, never installed), so the pi/
# scripts can be checked against it (pi/tree/check.sh). Run on request only: it downloads about 200 MB; the gate
# never runs it. Nothing from the tree is ever executed: it is read with grep, awk, zcat and the host's own tools.
#
# Usage: bash pi/tree/build.sh [--refresh] OUT
#   OUT        a new or empty directory OUTSIDE the repository (for example /tmp/pi-tree). It gets:
#                OUT/index/{d,r}/   InRelease and Packages of each archive
#                OUT/debs/          the downloaded .deb files
#                OUT/pkg/<name>/    each package unpacked on its own (dpkg-deb -x)
#                OUT/root/          all of them unpacked on top of each other (the "real" tree)
#                OUT/MANIFEST       archive, name, version, sha256 of each package used
#   --refresh  pick the newest version of each name in pi/tree/packages.list from today's indexes and rewrite
#              pi/tree/packages.lock (otherwise the lock's versions and hashes must still be in the archive)
# Archives (both must be allowed by the proxy; nothing else is tried):
#   d = http://deb.debian.org/debian            trixie main, binary-arm64 (Packages.xz)
#   r = http://archive.raspberrypi.com/debian   trixie main, binary-arm64 (Packages.gz; holds the arch-all packages too)
# On a Pi a package in r wins over the Debian one of the same name (r's versions carry +rpt and are higher).
# Verification: the Packages file's SHA256 must match the one listed in InRelease, and each .deb's SHA256 must
# match both the index and the lock. The InRelease signature is checked with gpgv only when a keyring is given
# (REVVIEW_TREE_KEYRING_D / REVVIEW_TREE_KEYRING_R, a .gpg keyring file); this VM has neither archive's key, so
# without them it says "signature NOT verified" and relies on the hashes pinned in the lock.
# Exit: 0 built; 2 bad arguments; 1 a download or a hash check failed (OUT is left as it is: delete it).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
list="$here/packages.list"
lock="$here/packages.lock"
D_URL="http://deb.debian.org/debian"
R_URL="http://archive.raspberrypi.com/debian"

die() { echo "build.sh: $*" >&2; exit 2; }
fail() { echo "build.sh: $*" >&2; exit 1; }

refresh=0
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --refresh) refresh=1; shift ;;
    -*) die "unknown option $1" ;;
    *) [ -z "$out" ] || die "only one OUT"; out="$1"; shift ;;
  esac
done
[ -n "$out" ] || die "usage: build.sh [--refresh] OUT"
mkdir -p "$out"
out="$(cd "$out" && pwd -P)"
case "$out/" in "$repo"/*) die "OUT must be outside the repository: $out" ;; esac
[ -z "$(ls -A "$out")" ] || die "OUT must be empty (each build gets a fresh directory): $out"
mkdir -p "$out/index/d" "$out/index/r" "$out/debs" "$out/pkg" "$out/root"

fetch() { # URL FILE
  curl -fsS --retry 2 -o "$2" "$1" || fail "download failed: $1"
}

# index ARCHIVE URL INDEXNAME DECOMPRESS: InRelease, signature (if a keyring is given), Packages with its hash.
index() {
  local a="$1" url="$2" name="$3" dec="$4" dir="$out/index/$1" want got keyring
  fetch "$url/dists/trixie/InRelease" "$dir/InRelease"
  if [ "$a" = d ]; then keyring="${REVVIEW_TREE_KEYRING_D:-}"; else keyring="${REVVIEW_TREE_KEYRING_R:-}"; fi
  if [ -n "$keyring" ]; then
    gpgv --keyring "$keyring" "$dir/InRelease" > /dev/null 2>&1 || fail "$a: InRelease signature did not verify with $keyring"
    echo "$a: InRelease signature verified with $keyring"
  else
    echo "$a: InRelease signature NOT verified (no keyring given); hashes below are checked against it"
  fi
  want="$(awk -v f="main/binary-arm64/$name" '/^SHA256:/ { s = 1; next } /^[^ ]/ { s = 0 } s && $3 == f { print $1 }' "$dir/InRelease")"
  [ -n "$want" ] || fail "$a: no SHA256 for main/binary-arm64/$name in InRelease"
  fetch "$url/dists/trixie/main/binary-arm64/$name" "$dir/$name"
  got="$(sha256sum "$dir/$name" | cut -d' ' -f1)"
  [ "$got" = "$want" ] || fail "$a: $name hash $got is not the InRelease one $want"
  $dec < "$dir/$name" > "$dir/Packages"
  echo "$a: $name sha256 ok ($(grep -c '^Package: ' "$dir/Packages") package entries)"
}

index d "$D_URL" Packages.xz "xz -dc"
index r "$R_URL" Packages.gz "gzip -dc"

# entries ARCHIVE NAME: "version filename sha256" for every entry of NAME in that archive's index.
entries() {
  awk -v want="$2" '
    /^Package: / { p = $2; v = f = s = "" }
    /^Version: / { v = $2 }
    /^Filename: / { f = $2 }
    /^SHA256: / { s = $2 }
    /^$/ { if (p == want && v != "") print v, f, s; p = "" }
    END { if (p == want && v != "") print v, f, s }' "$out/index/$1/Packages"
}

if [ "$refresh" -eq 1 ]; then
  [ -r "$list" ] || die "missing $list"
  tmp="$(mktemp)"
  {
    echo "# archive name version sha256 filename. Written by pi/tree/build.sh --refresh on $(date -u +%Y-%m-%d) from"
    echo "# the trixie main binary-arm64 indexes of d=$D_URL and r=$R_URL (newest version of each name, r and d compared)."
  } > "$tmp"
  grep -Ev '^[[:space:]]*(#|$)' "$list" | while read -r name _; do
    best_a="" best_v="" best_f="" best_s=""
    for a in d r; do
      while read -r v f s; do
        [ -n "$v" ] || continue
        if [ -z "$best_v" ] || dpkg --compare-versions "$v" gt "$best_v"; then best_a="$a" best_v="$v" best_f="$f" best_s="$s"; fi
      done < <(entries "$a" "$name")
    done
    [ -n "$best_v" ] || fail "--refresh: $name is in neither index"
    echo "$best_a $name $best_v $best_s $best_f"
  done >> "$tmp"
  mv "$tmp" "$lock"
  echo "wrote $lock"
fi

[ -r "$lock" ] || die "missing $lock (run with --refresh once)"
: > "$out/MANIFEST"
grep -Ev '^[[:space:]]*(#|$)' "$lock" | while read -r a name ver sha file; do
  case "$a" in d) url="$D_URL" ;; r) url="$R_URL" ;; *) fail "lock: bad archive $a for $name" ;; esac
  [[ "$file" =~ ^pool/[A-Za-z0-9._+~/-]+\.deb$ ]] || fail "lock: bad file name for $name: $file"
  entries "$a" "$name" | grep -qxF "$ver $file $sha" ||
    fail "$name $ver ($a) is no longer in the index with that file and hash; run with --refresh into a new OUT"
  deb="$out/debs/$(basename "$file")"
  fetch "$url/$file" "$deb"
  got="$(sha256sum "$deb" | cut -d' ' -f1)"
  [ "$got" = "$sha" ] || fail "$name: .deb hash $got is not the pinned $sha"
  mkdir "$out/pkg/$name"
  dpkg-deb -x "$deb" "$out/pkg/$name"
  echo "$a $name $ver $sha" >> "$out/MANIFEST"
  echo "unpacked $name $ver ($a)"
done

# Merge into OUT/root without ever writing through a symlink: first every directory and regular file of every
# package (no symlink exists in root yet, so every parent is a real directory; a later package overwrites a file of
# an earlier one), then the symlinks, never replacing anything that is already there (a link at a path that another
# package ships as a directory is dropped and listed in OUT/merge-conflicts).
: > "$out/merge-conflicts"
for p in "$out"/pkg/*/; do
  (cd "$p" && find . -mindepth 1 ! -type l -print0 | tar --null --no-recursion -T - -cf -) | tar -C "$out/root" -xf -
done
for p in "$out"/pkg/*/; do
  (cd "$p" && find . -type l -print0 | tar --null --no-recursion -T - -cf -) |
    tar -C "$out/root" --skip-old-files -xf - 2>> "$out/merge-conflicts" || true
done
echo "built $out/root from $(grep -c '' "$out/MANIFEST") packages (unpacked only, nothing installed or run)"
