#!/bin/bash
# Check the pi/ scripts against the REAL Raspberry Pi OS Trixie arm64 packages unpacked by pi/tree/build.sh.
# Usage: bash pi/tree/check.sh OUT [--write-facts FILE]
#   OUT          the directory build.sh made (OUT/root, OUT/pkg, OUT/MANIFEST)
#   --write-facts FILE  also write the names found (paths, commands, units, chromium switches, raspi-config
#                functions and sed lines) as a fixture; tests/unit/pi-real-tree.test.js reads only that file.
# Output: one line per check: "ok <what>", "DIFF <what>" (the scripts and the real packages disagree),
#   "NOTE <what>" (something the tree cannot show, or a fact worth knowing), then a summary.
# Exit: 0 no DIFF; 1 at least one DIFF; 2 bad arguments.
# SAFETY: the tree is untrusted data. Nothing inside it is executed, sourced or put on PATH: it is read with
# grep, awk, sed, zcat, ls and test. The host's own tools (systemd-analyze, bash, node) get tree paths as
# arguments only. Never writes into OUT or the repository (only --write-facts FILE, and a temp directory).
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
export LC_ALL=C

out=""
facts_file=""
while [ $# -gt 0 ]; do
  case "$1" in
    --write-facts) [ $# -ge 2 ] || { echo "usage: check.sh OUT [--write-facts FILE]" >&2; exit 2; }; facts_file="$2"; shift 2 ;;
    -*) echo "check.sh: unknown option $1" >&2; exit 2 ;;
    *) [ -z "$out" ] || { echo "check.sh: only one OUT" >&2; exit 2; }; out="$1"; shift ;;
  esac
done
[ -n "$out" ] || { echo "usage: check.sh OUT [--write-facts FILE]" >&2; exit 2; }
{ [ -d "$out/root" ] && [ -f "$out/MANIFEST" ]; } || { echo "check.sh: $out has no root/ and MANIFEST (run pi/tree/build.sh first)" >&2; exit 2; }
out="$(cd "$out" && pwd -P)"
tree="$out/root"
case "$out/" in "$repo"/*) echo "check.sh: OUT must be outside the repository" >&2; exit 2 ;; esac
for f in pi/install.sh pi/readonly.sh pi/kiosk.sh pi/revview.service pi/revview-unlock.service tests/unit/pi-readonly.test.js; do
  [ -f "$repo/$f" ] || { echo "check.sh: $repo/$f is missing" >&2; exit 2; }
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
work="$tmp/work"
mkdir -p "$work"
fx="$tmp/facts"
mkdir -p "$fx"
for f in paths cmds units switches fns seds; do : > "$fx/$f"; done

n_ok=0
n_diff=0
n_note=0
ok() { echo "ok $*"; n_ok=$((n_ok + 1)); }
diff_() { echo "DIFF $*"; n_diff=$((n_diff + 1)); }
note() { echo "NOTE $*"; n_note=$((n_note + 1)); }
section() { echo; echo "== $*"; }
has() { [ -e "$tree/$1" ] || [ -L "$tree/$1" ]; }

# fact_path REL: record REL and all its ancestors (REL must exist in the tree).
fact_path() {
  local p="$1"
  while [ -n "$p" ] && [ "$p" != . ]; do echo "/$p" >> "$fx/paths"; p="$(dirname "$p")"; done
}
# chk_path REL WHAT: REL (no leading /) must exist in the real tree.
chk_path() {
  if has "$1"; then ok "path /$1 exists in the packages ($2)"; fact_path "$1"; else diff_ "path /$1 ($2): not in the real packages"; fi
}

echo "pi/tree/check.sh: tree $out"
echo "packages: $(wc -l < "$out/MANIFEST") (see $out/MANIFEST)"
sysd_ver="$(awk '$2 == "systemd" { print $3 }' "$out/MANIFEST")"
echo "The Pi has systemd $sysd_ver; this host's systemd-analyze is $(systemd-analyze --version 2> /dev/null | head -n 1); keys new in 257 would show as unknown here."

# ---------------------------------------------------------------- 1. work root
section "1. work root: a writable copy of etc, var, initramfs-tools and the systemd units of the real tree"
mkdir -p "$work/usr/share" "$work/usr/lib/systemd"
cp -a "$tree/etc" "$work/etc"
cp -a "$tree/var" "$work/var"
cp -a "$tree/usr/share/initramfs-tools" "$work/usr/share/initramfs-tools"
cp -a "$tree/usr/lib/systemd/system" "$work/usr/lib/systemd/system"
cp -a "$tree/usr/lib/systemd/user" "$work/usr/lib/systemd/user"
chmod -R u+w "$work"
ok "copied etc, var, usr/share/initramfs-tools, usr/lib/systemd/{system,user} from the real tree"

fixt="$repo/tests/unit/fixtures/pi"
mkdir -p "$work/boot/firmware" "$work/home/pi" "$work/proc" "$work/run/lock"
cp "$fixt/cmdline.txt" "$fixt/config.txt" "$work/boot/firmware/"
note "seeded: image builder, not from a package: boot/firmware/cmdline.txt and config.txt (copies of tests/unit/fixtures/pi/)"
{
  echo "proc /proc proc defaults 0 0"
  echo "PARTUUID=1a2b3c4d-01 /boot/firmware vfat defaults 0 2"
  echo "PARTUUID=1a2b3c4d-02 / ext4 defaults,noatime 0 1"
} > "$work/etc/fstab"
note "seeded: image builder, not from a package: etc/fstab (proc, /boot/firmware vfat, / ext4)"
bp="$tree/usr/share/base-passwd"
if [ -f "$bp/passwd.master" ] && [ -f "$bp/group.master" ]; then
  { cat "$bp/passwd.master"; echo "pi:x:1000:1000:,,,:/home/pi:/bin/bash"; } > "$work/etc/passwd"
  { cat "$bp/group.master"; echo "pi:x:1000:"; } > "$work/etc/group"
  note "seeded: image builder, not from a package: etc/passwd and etc/group (base-passwd masters plus the user pi, uid 1000), home/pi"
else
  diff_ "base-passwd masters missing in the tree (usr/share/base-passwd/{passwd,group}.master)"
fi
{
  echo "/dev/mmcblk0p2 / ext4 rw,noatime 0 0"
  echo "/dev/mmcblk0p1 /boot/firmware vfat rw,relatime 0 0"
} > "$work/proc/mounts"
note "seeded: image builder, not from a package: proc/mounts (ext4 root, boot rw: what the kernel shows)"

# ---------------------------------------------------------------- 2. install.sh
section "2. pi/install.sh --root <copy of the tree> --user pi --no-apt"
(cd "$work" && find . | sort) > "$tmp/before.list"
install_log="$tmp/install.log"
bash "$repo/pi/install.sh" --root "$work" --user pi --no-apt "$repo" > "$install_log" 2>&1
rc=$?
if [ "$rc" -eq 0 ]; then ok "pi/install.sh exits 0 against the real tree's etc and var"; else diff_ "pi/install.sh exited $rc: $(tail -n 3 "$install_log" | tr '\n' ' ')"; fi
(cd "$work" && find . | sort) > "$tmp/after.list"

ld="$work/etc/lightdm/lightdm.conf"
changes="$(diff "$tree/etc/lightdm/lightdm.conf" "$ld" | grep -E '^[<>]' || true)"
n_changes="$(printf '%s\n' "$changes" | grep -c . || true)"
n_other="$(printf '%s\n' "$changes" | grep -v -E '^[<>] ?#?[[:space:]]*autologin-user=' | grep -c . || true)"
if [ "$n_changes" -ge 1 ] && [ "$n_changes" -le 2 ] && [ "$n_other" -eq 0 ]; then
  ok "lightdm.conf: only the autologin-user line changed ($(printf '%s' "$changes" | tr '\n' '|'))"
else
  diff_ "lightdm.conf: expected one autologin-user line to change, the diff is: $(printf '%s' "$changes" | tr '\n' '|')"
fi
sec="$(awk '/^[[:space:]]*\[/ { s = $0 } /^autologin-user=pi$/ { print s }' "$ld")"
if [ "$sec" = "[Seat:*]" ]; then ok "lightdm.conf: autologin-user=pi is inside [Seat:*]"; else diff_ "lightdm.conf: autologin-user=pi is in section '${sec:-none}', not [Seat:*]"; fi
if grep -q '^\[Seat:\*\]' "$tree/etc/lightdm/lightdm.conf"; then ok "the real lightdm.conf has a [Seat:*] section"; else diff_ "the real lightdm.conf has no [Seat:*] section (install would append one)"; fi
if grep -Eq '^#?autologin-user=' "$tree/etc/lightdm/lightdm.conf"; then ok "the real lightdm.conf has an autologin-user line (commented) to replace"; else note "the real lightdm.conf has no autologin-user line: install inserts one after [Seat:*]"; fi
if [ -e "$ld.revview-backup" ]; then note "install saved lightdm.conf.revview-backup next to it (a new file by design)"; fi

for f in etc/lightdm/lightdm.conf etc/udev/rules.d/70-revview-dongle.rules etc/udev/rules.d/71-revview-touch.rules \
  etc/systemd/user/revview.service etc/systemd/user/default.target.wants/revview.service \
  var/lib/systemd/linger/pi etc/revview/server.env etc/revview/buttons.json home/pi/.config/labwc/autostart; do
  if [ -e "$work/$f" ] || [ -L "$work/$f" ]; then ok "install wrote /$f"; else diff_ "install did not write /$f"; fi
done
# directories install created: shipped by no package of the tree
created_dirs="$(comm -13 "$tmp/before.list" "$tmp/after.list" | while read -r p; do
  if [ -d "$work/$p" ] && [ ! -L "$work/$p" ]; then echo "${p#./}"; fi
done)"
for d in $created_dirs; do
  if has "$d"; then continue; fi
  case "$d" in
    etc/revview | var/lib/revview) note "install created /$d: revview's own directory, no package ships it" ;;
    home/pi/*) note "install created /$d: inside the user's home, made by the image builder, not a package" ;;
    *) note "install created /$d: no package in the tree ships it (it is made at run time or by install; the parents above it are shipped)" ;;
  esac
done
for f in etc/lightdm etc/udev/rules.d etc/systemd/user etc/systemd/user/default.target.wants var/lib/systemd/linger etc/revview var/lib/revview; do
  if has "$f"; then ok "parent /$f is shipped by the packages"; fact_path "$f"; fi
done
chk_path var/lib/systemd "parent of the linger directory install creates"
# pi/data.mjs destinations
for f in etc/profile.d etc/udev/rules.d etc/systemd/system; do chk_path "$f" "pi/data.mjs writes into it"; done
has etc/systemd/system/multi-user.target.wants || note "/etc/systemd/system/multi-user.target.wants: no package ships it (pi/data.mjs creates the enable link there, like systemctl enable)"

# ---------------------------------------------------------------- 3. units
section "3. systemd units (the Pi has $sysd_ver)"
render_dir="$tmp/units"
mkdir -p "$render_dir"
check_refs() { # FILE KIND LABEL: every unit name in the dependency keys must exist in the packages
  local f="$1" kind="$2" label="$3" key val name
  while IFS='=' read -r key val; do
    for name in $val; do
      name="${name#-}"
      if has "usr/lib/systemd/$kind/$name"; then
        ok "$label: $key=$name exists as a $kind unit in the packages"
        echo "$kind $name" >> "$fx/units"
      else
        diff_ "$label: $key=$name is not a $kind unit in usr/lib/systemd/$kind of the packages"
      fi
    done
  done < <(grep -E '^(After|Before|Wants|Requires|WantedBy|RequiredBy|PartOf|BindsTo|Conflicts|Requisite|Upholds)=' "$f")
}
check_refs "$repo/pi/revview.service" user "pi/revview.service"
check_refs "$work/etc/systemd/user/revview.service" user "written user unit"
check_refs "$repo/pi/revview-unlock.service" system "pi/revview-unlock.service"
if [ -L "$work/etc/systemd/user/default.target.wants/revview.service" ]; then
  tgt="$(readlink "$work/etc/systemd/user/default.target.wants/revview.service")"
  if [ "$tgt" = /etc/systemd/user/revview.service ]; then ok "enable link points to /etc/systemd/user/revview.service"; else diff_ "enable link points to $tgt"; fi
fi

classify_verify() { # LABEL FILE-WITH-OUTPUT
  local label="$1" line
  if [ ! -s "$2" ]; then ok "$label: systemd-analyze verify printed nothing"; return; fi
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$line" in
      *"Unknown key"* | *"Unknown section"* | *"Unknown lvalue"* | *"Invalid"* | *"Failed to parse"* | *"not a valid"* | *"Unknown "*)
        diff_ "$label: systemd-analyze: $line" ;;
      *"is not executable: No such file"*)
        local cmd="${line#*Command }"
        cmd="${cmd%% is not executable*}"
        if [ -e "$tree$cmd" ]; then
          note "$label: systemd-analyze: $line (expected: $cmd is in the packages; the copy given to --root holds only etc, var and the unit directories)"
        elif [ "$cmd" = /usr/bin/node ]; then
          note "$label: systemd-analyze: $line (expected: Node comes from NodeSource, not a Pi OS package)"
        else
          diff_ "$label: systemd-analyze: $line ($cmd is in no package of the tree either)"
        fi
        ;;
      *run-lock.mount*)
        note "$label: systemd-analyze: $line (expected: needs the host's /run/lock mount, not a unit problem)" ;;
      *)
        note "$label: systemd-analyze: $line (unclassified: read it)" ;;
    esac
  done < "$2"
}
verify_ran=0
# system unit: with the copy of the tree as --root
mkdir -p "$work/etc/systemd/system"
sed -e 's#@REVVIEW_DIR@#/opt/revview#' "$repo/pi/revview-unlock.service" > "$work/etc/systemd/system/revview-unlock.service"
systemd-analyze --root="$work" --man=no --generators=no verify revview-unlock.service > "$tmp/v1.out" 2>&1
if ! grep -q -e 'Failed to initialize' "$tmp/v1.out"; then
  verify_ran=1
  echo "method: systemd-analyze --root=<copy of the tree> --man=no --generators=no verify revview-unlock.service (host systemd 255)"
  classify_verify "pi/revview-unlock.service" "$tmp/v1.out"
fi
# user unit: --user cannot be combined with --root on this host ("Failed to lookup RuntimeDirectory"), so it runs
# without --root on the written file with a temporary XDG_RUNTIME_DIR; dependency names are checked against the tree above.
mkdir -p "$tmp/xdg"
chmod 700 "$tmp/xdg"
XDG_RUNTIME_DIR="$tmp/xdg" systemd-analyze --user --man=no --generators=no verify "$work/etc/systemd/user/revview.service" > "$tmp/v2.out" 2>&1
if ! grep -q -e 'Failed to initialize' "$tmp/v2.out"; then
  verify_ran=1
  echo "method: XDG_RUNTIME_DIR=<temp> systemd-analyze --user --man=no --generators=no verify <the unit install wrote> (no --root: it fails with --user; dependency names are checked against the tree above)"
  classify_verify "written user unit" "$tmp/v2.out"
fi
[ "$verify_ran" -eq 1 ] || note "systemd-analyze verify could not run here; only the man page key check below was done"
# key names against the man pages of the real tree (second method, always run)
man_ok=1
for m in unit service exec kill; do [ -f "$tree/usr/share/man/man5/systemd.$m.5.gz" ] || { man_ok=0; note "man page systemd.$m.5.gz is not in the tree"; }; done
if [ "$man_ok" -eq 1 ]; then
  zcat "$tree"/usr/share/man/man5/systemd.{unit,service,exec,kill}.5.gz > "$tmp/man.txt" 2> /dev/null
  for f in "$repo/pi/revview.service" "$repo/pi/revview-unlock.service"; do
    while IFS= read -r key; do
      if grep -a -F -q -- "$key=" "$tmp/man.txt"; then ok "$(basename "$f"): key $key= is in the systemd man pages of the packages"; else diff_ "$(basename "$f"): key $key= is not in systemd.{unit,service,exec,kill}(5) of the packages"; fi
    done < <(grep -E '^[A-Za-z]+=' "$f" | cut -d= -f1 | sort -u)
  done
  note "second method for keys: zcat systemd.{unit,service,exec,kill}.5.gz | grep -F 'Key=' (man pages of systemd $sysd_ver, the Pi's version)"
fi

# ---------------------------------------------------------------- 4. readonly.sh and raspi-config
section "4. pi/readonly.sh against the copy; raspi-config text"
ro() { env -u REVVIEW_RASPI_CONFIG bash "$repo/pi/readonly.sh" "$@" --root "$work"; }
ro_out="$(ro status 2>&1)"
if printf '%s\n' "$ro_out" | grep -q '^overlay: off$'; then ok "readonly.sh status: overlay off"; else diff_ "readonly.sh status: expected 'overlay: off', got: $(printf '%s' "$ro_out" | tr '\n' '|')"; fi
ro_out="$(ro enable --dry-run 2>&1)"
rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$ro_out" | grep -q 'would run: raspi-config nonint do_overlayfs 0'; then ok "readonly.sh enable --dry-run: exit 0, would run do_overlayfs 0"; else diff_ "readonly.sh enable --dry-run: exit $rc: $(printf '%s' "$ro_out" | tr '\n' '|')"; fi
ro_out="$(ro disable --dry-run 2>&1)"
rc=$?
if [ "$rc" -eq 0 ]; then ok "readonly.sh disable --dry-run: exit 0 ($(printf '%s' "$ro_out" | tr '\n' '|'))"; else diff_ "readonly.sh disable --dry-run: exit $rc: $(printf '%s' "$ro_out" | tr '\n' '|')"; fi
chk_path usr/share/initramfs-tools/scripts/init-bottom/overlayroot "readonly.sh enable looks for it"

rcf="$tree/usr/bin/raspi-config"
if [ -f "$rcf" ]; then
  for fn in do_overlayfs enable_bootro disable_bootro enable_overlayfs disable_overlayfs; do
    if grep -q "^$fn() {" "$rcf"; then ok "raspi-config defines $fn()"; echo "$fn" >> "$fx/fns"; else diff_ "raspi-config has no function $fn()"; fi
  done
  if grep -q '^nonint() {' "$rcf" && grep -Eq '^[[:space:]]*nonint \| batch\)' "$rcf"; then ok "raspi-config has nonint() and the 'nonint | batch)' dispatch"; else diff_ "raspi-config: nonint() or its dispatch is missing"; fi
  if grep -Fq 'if [ -e /boot/firmware/config.txt ]' "$rcf"; then ok "raspi-config switches on /boot/firmware/config.txt (FIRMWARE=/firmware)"; else diff_ "raspi-config: the /boot/firmware switch is missing"; fi
  awk '/^(enable_overlayfs|disable_overlayfs|enable_bootro|disable_bootro)\(\) \{/ { fn = $1; sub(/\(\).*/, "", fn); on = 1; next }
       on && /^}/ { on = 0 }
       on && /sed -i/ { l = $0; sub(/^[[:space:]]*/, "", l); print fn ": " l }' "$rcf" | while IFS= read -r l; do echo "  real $l"; done
  # (function, expression) pairs; $FIRMWARE is /firmware on a Pi image (the switch above), so it is normalised to that
  awk '/^(enable_overlayfs|disable_overlayfs|enable_bootro|disable_bootro)\(\) \{/ { fn = $1; sub(/\(\).*/, "", fn); on = 1; next }
       on && /^}/ { on = 0 }
       on && /sed -i/ { l = $0; sub(/^.*-e "/, "", l); sub(/"[[:space:]]*$/, "", l); gsub(/\$FIRMWARE/, "/firmware", l); print fn " " l }' "$rcf" | sort -u > "$fx/seds"
  if [ "$(wc -l < "$fx/seds")" -eq 4 ]; then ok "found one sed expression in each of the four functions"; else diff_ "expected 4 sed expressions in raspi-config, found $(wc -l < "$fx/seds")"; fi
  node -e '
    const fs = require("fs");
    const t = fs.readFileSync(process.argv[1], "utf8");
    const set = new Set();
    for (const m of t.matchAll(/-e\s+(["\x27])(.*?)\1/g)) set.add(m[2].replace(/\\\\/g, "\\"));
    for (const e of set) console.log(e);
  ' "$repo/tests/unit/pi-readonly.test.js" > "$tmp/stub.seds"
  while IFS= read -r l; do
    fn="${l%% *}"
    expr="${l#* }"
    if grep -a -F -x -q -- "$expr" "$tmp/stub.seds"; then ok "pi-readonly.test.js stub has the real sed of $fn"; else diff_ "pi-readonly.test.js stub lacks the real sed of $fn: $expr"; fi
  done < "$fx/seds"
else
  diff_ "usr/bin/raspi-config is missing in the tree"
fi

# ---------------------------------------------------------------- 5. kiosk.sh
section "5. pi/kiosk.sh switches against the real chromium binary"
kdir="$tmp/kiosk"
mkdir -p "$kdir/home" "$kdir/run"
cat > "$kdir/browser" << EOF
#!/bin/bash
printf '%s\n' "\$@" > '$kdir/args'
EOF
chmod +x "$kdir/browser"
env -u XDG_CONFIG_HOME HOME="$kdir/home" XDG_RUNTIME_DIR="$kdir/run" REVVIEW_KIOSK_RUNS=1 REVVIEW_KIOSK_BROWSER="$kdir/browser" \
  REVVIEW_KIOSK_BOOT_MARKER="$kdir/no-such-marker" bash "$repo/pi/kiosk.sh" > "$kdir/log" 2>&1
if [ -s "$kdir/args" ]; then ok "kiosk.sh ran the recording browser stub"; else diff_ "kiosk.sh did not start the browser stub: $(tr '\n' '|' < "$kdir/log")"; : > "$kdir/args"; fi
chromium_bin="$tree/usr/lib/chromium/chromium"
if [ -f "$chromium_bin" ]; then ok "usr/lib/chromium/chromium exists"; else diff_ "usr/lib/chromium/chromium is missing in the tree"; fi
while IFS= read -r flag; do
  case "$flag" in --*) ;; *) continue ;; esac
  name="${flag#--}"
  name="${name%%=*}"
  cnt="$(grep -a -c -F -- "$name" "$chromium_bin" 2> /dev/null || true)"
  if [ "${cnt:-0}" -gt 0 ]; then ok "chromium switch $name is in the real chromium binary ($cnt lines)"; echo "$name" >> "$fx/switches"; else diff_ "chromium switch $name (kiosk.sh passes $flag) is not in the real chromium binary"; fi
done < "$kdir/args"
chk_path usr/bin/chromium "find_browser tries chromium first"
note "a switch name found as a string in the binary shows that the name exists, not that it behaves as kiosk.sh expects"
note "files in /etc/chromium.d: $(find "$tree/etc/chromium.d" -mindepth 1 -maxdepth 1 -printf '%f\n' 2> /dev/null | sort | tr '\n' ' ')"
while IFS= read -r flag; do
  case "$flag" in --*) ;; *) continue ;; esac
  name="${flag#--}"
  name="${name%%=*}"
  hits="$(grep -a -h -o -- "--${name}[=A-Za-z0-9_.,-]*" "$tree"/etc/chromium.d/* "$tree/usr/bin/chromium" 2> /dev/null | sort -u | tr '\n' ' ')"
  [ -z "$hits" ] || note "/etc/chromium.d or the /usr/bin/chromium wrapper also names: $hits (kiosk.sh passes $flag; read the wrapper: --user-data-dir is added only with its own --temp-profile option)"
done < "$kdir/args"
for sw in ozone-platform password-store; do
  if ! grep -a -q -- "$sw" "$tree/usr/bin/chromium" "$tree"/etc/chromium.d/* 2> /dev/null; then note "neither the wrapper nor /etc/chromium.d sets --$sw: kiosk.sh's value is the only one"; fi
done

# ---------------------------------------------------------------- 6. commands
section "6. commands the pi/ scripts call"
cmds="tmux python3 espeak-ng wlr-randr rec aplay chromium raspi-config vcgencmd usermod getent udevadm systemctl journalctl lsblk mountpoint flock runuser mount umount cryptsetup e2fsck mkfs.ext4 stat curl sed grep awk id dpkg apt-get bash sh install mkdir rm cp chmod chown cat head cut tr sort sleep sync readlink dirname mktemp ln node claude"
for c in $cmds; do
  found=""
  for d in usr/bin usr/sbin bin sbin; do
    if has "$d/$c"; then found="/$d/$c"; break; fi
  done
  case "$found" in /bin/* | /sbin/*) found="/usr$found" ;; esac # /bin and /sbin are links to usr/
  if [ -n "$found" ]; then
    ok "command $c: $found"
    echo "$c $found" >> "$fx/cmds"
  elif [ "$c" = node ]; then
    note "command node: in no package of the tree (Node 22 comes from NodeSource)"
  elif [ "$c" = claude ]; then
    note "command claude: in no package of the tree (Claude Code has its own installer)"
  elif [ "$c" = awk ]; then
    if has usr/bin/mawk; then
      note "command awk: Debian makes /usr/bin/awk with update-alternatives at install time; accepted /usr/bin/mawk"
      echo "awk /usr/bin/mawk" >> "$fx/cmds"
    else
      diff_ "missing package for awk: neither /usr/bin/awk nor /usr/bin/mawk"
    fi
  else
    diff_ "missing package for $c: no $c in usr/bin, usr/sbin, bin or sbin of the packages in pi/tree/packages.list"
  fi
done
# the list must not rot: each command is still mentioned by pi/ outside comments
grep -h -v -E '^[[:space:]]*(#|//|\*)' "$repo"/pi/*.sh "$repo"/pi/*.mjs "$repo"/pi/*.service "$repo"/pi/*.rules > "$tmp/pi-code.txt" 2> /dev/null
for c in $cmds; do
  if ! grep -q -w -F -- "$c" "$tmp/pi-code.txt"; then note "command $c: no pi/ code calls it (comments only); checked because Claude Code or the server uses it, or remove it from check.sh's list"; fi
done

# ---------------------------------------------------------------- 7. paths
section "7. paths pi/ expects on the image"
for p in etc/profile.d etc/udev/rules.d etc/systemd/user etc/xdg/labwc/autostart etc/lightdm/lightdm.conf \
  usr/share/initramfs-tools/scripts/init-bottom/overlayroot usr/lib/udev/rules.d/60-persistent-storage.rules \
  usr/lib/udev/rules.d/60-input-id.rules usr/share/wayland-sessions/rpd-labwc.desktop usr/bin/labwc-pi \
  usr/lib/systemd/user/default.target; do
  chk_path "$p" "pi/ refers to it"
done
# units: all targets (the referenced ones were recorded above)
for k in system user; do
  (cd "$tree/usr/lib/systemd/$k" && ls) | grep -E '\.target$' | sed "s/^/$k /" >> "$fx/units"
done

echo
echo "summary: $n_ok ok, $n_diff DIFF, $n_note NOTE"

# ---------------------------------------------------------------- 8. facts
if [ -n "$facts_file" ]; then
  {
    echo "# Extracted by pi/tree/check.sh from the real Raspberry Pi OS Trixie arm64 packages on $(date -u +%Y-%m-%d)"
    awk '{ print "# package " $1 " " $2 " " $3 }' "$out/MANIFEST" | sort
    {
      sort -u "$fx/paths" | sed 's/^/path /'
      sort -u "$fx/cmds" | sed 's/^/cmd /'
      sort -u "$fx/units" | sed 's/^/unit /'
      sort -u "$fx/switches" | sed 's/^/chromium-switch /'
      sort -u "$fx/fns" | sed 's/^/raspi-config-fn /'
      sort -u "$fx/seds" | sed 's/^/raspi-config-sed /'
    } | sort -u
  } > "$facts_file"
  echo "facts written to $facts_file"
fi

[ "$n_diff" -eq 0 ]
