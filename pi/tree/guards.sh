# shellcheck shell=bash
# Guards of pi/tree/build.sh, sourced by it and by tests/unit/pi-tree-guards.test.js. Needs fail() from the caller.

# check_member_names LABEL: reads member names on stdin; fails when one is absolute or has a ".." component.
check_member_names() {
  local label="$1" bad
  bad="$(awk '{ n = $0; sub(/^\.\//, "", n) } n ~ /^\// || n ~ /(^|\/)\.\.(\/|$)/ { print; exit }')"
  [ -z "$bad" ] || fail "$label: member name \"$bad\" is absolute or has a .. component; refusing to unpack it"
}

# check_deb_names DEB: lists the package's files with dpkg-deb -c (columns: perms owner size date time name
# [-> target]; only the name is checked) and applies check_member_names.
check_deb_names() {
  local deb="$1" list
  list="$(dpkg-deb -c "$deb")" || fail "cannot list $deb"
  printf '%s\n' "$list" | awk '{ n = $6; for (i = 7; i <= NF && $i != "->" && $i != "link"; i++) n = n " " $i; print n }' |
    check_member_names "$(basename "$deb")"
}

# merge_links PKGDIR ROOT CONFLICTS: copies the symlinks of PKGDIR into ROOT, never replacing anything that is
# already there (such a link is appended to CONFLICTS). Any failure of find or tar is fatal.
merge_links() {
  local pkg="$1" root="$2" conflicts="$3" l list
  list="$(mktemp)"
  (cd "$pkg" && find . -type l -print0) | while IFS= read -r -d '' l; do
    if [ -e "$root/$l" ] || [ -L "$root/$l" ]; then
      echo "$l" >> "$conflicts"
    else
      printf '%s\0' "$l"
    fi
  done > "$list" || fail "merge: listing the symlinks of $pkg failed"
  if [ -s "$list" ]; then
    (cd "$pkg" && tar --null --no-recursion -T "$list" -cf -) | tar -C "$root" -xf - ||
      fail "merge: copying the symlinks of $pkg into $root failed (disk full? permissions?); the tree is incomplete"
  fi
  rm -f "$list"
}
