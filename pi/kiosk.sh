#!/bin/bash
# Kiosk respawn loop: Chromium on the revview boot page, restarted when it exits. Started by the labwc
# autostart that pi/install.sh writes. UNTESTED on a Pi: written without one.
#
# - URL: file://<repo>/src/view/boot.html?port=$REVVIEW_PORT (default 8138). The boot page waits for the server,
#   then goes to http://127.0.0.1:<port>/ (it shows NO LINK meanwhile).
# - Pause (for development): while either marker file exists NO NEW browser is started (checked every 5 s). A
#   Chromium that is already running is not stopped: close it, and it is not restarted while a marker exists.
#     ${XDG_CONFIG_HOME:-$HOME/.config}/revview/kiosk-paused
#     /boot/firmware/revview-kiosk-paused   (can be created from another computer on the SD card)
# - Profile: ${XDG_RUNTIME_DIR:-/tmp}/revview-kiosk (tmpfs: fresh at each boot, no restore prompt after a
#   power cut, no writes to the SD card). The crash marks are cleared in Preferences before each launch.
# - Browser: $REVVIEW_KIOSK_BROWSER, else the first of chromium, chromium-browser on PATH.
# - Respawn: sleep 1 s; if the browser lived under 10 s, double the sleep up to 30 s; reset after 10 s or more.
#
# Test seam (tests only): REVVIEW_KIOSK_RUNS=N exits after N loop iterations (a paused check counts as one)
# and makes all sleeps 0. REVVIEW_KIOSK_BOOT_MARKER overrides the /boot/firmware marker path.
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/.." && pwd)"
port="${REVVIEW_PORT:-8138}"
url="file://$repo/src/view/boot.html?port=$port"
user_marker="${XDG_CONFIG_HOME:-$HOME/.config}/revview/kiosk-paused"
boot_marker="${REVVIEW_KIOSK_BOOT_MARKER:-/boot/firmware/revview-kiosk-paused}"
profile="${XDG_RUNTIME_DIR:-/tmp}/revview-kiosk"
max_runs="${REVVIEW_KIOSK_RUNS:-}"

log() { echo "revview-kiosk: $*" >&2; }
nap() { if [ -n "$max_runs" ]; then sleep 0; else sleep "$1"; fi; }

# Switch names checked against chromium 1:156.0.8078.108-1~deb13u1+rpt1 (Raspberry Pi archive) binary strings;
# behaviour untested on the Pi.
flags=(
  --kiosk
  --ozone-platform=wayland
  --noerrdialogs
  --disable-infobars
  --no-first-run
  --no-default-browser-check
  --hide-crash-restore-bubble
  --password-store=basic
  --disable-features=Translate
  --check-for-update-interval=31536000
  --disable-pinch
  --overscroll-history-navigation=0
  "--user-data-dir=$profile"
)

find_browser() {
  if [ -n "${REVVIEW_KIOSK_BROWSER:-}" ]; then echo "$REVVIEW_KIOSK_BROWSER"; return 0; fi
  local b
  for b in chromium chromium-browser; do
    if command -v "$b" > /dev/null 2>&1; then echo "$b"; return 0; fi
  done
  return 1
}

clear_crash_flags() {
  local prefs="$profile/Default/Preferences"
  [ -f "$prefs" ] || return 0
  sed -i -e 's/"exited_cleanly":false/"exited_cleanly":true/' -e 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "$prefs" 2> /dev/null || true
}

delay=1
paused_logged=0
runs=0
while :; do
  if [ -n "$max_runs" ] && [ "$runs" -ge "$max_runs" ]; then exit 0; fi
  runs=$((runs + 1))

  if [ -e "$user_marker" ] || [ -e "$boot_marker" ]; then
    if [ "$paused_logged" -eq 0 ]; then log "paused"; paused_logged=1; fi
    nap 5
    continue
  fi
  if [ "$paused_logged" -eq 1 ]; then log "resumed"; paused_logged=0; fi

  if ! browser="$(find_browser)"; then
    log "no chromium or chromium-browser on PATH; retrying in 10 s"
    nap 10
    continue
  fi

  clear_crash_flags
  started=$SECONDS
  log "starting $browser"
  "$browser" "${flags[@]}" "$url"
  code=$?
  lived=$((SECONDS - started))
  log "browser exited with $code after ${lived} s"
  if [ "$lived" -ge 10 ]; then delay=1; fi
  nap "$delay"
  if [ "$lived" -lt 10 ]; then
    delay=$((delay * 2))
    if [ "$delay" -gt 30 ]; then delay=30; fi
  fi
done
