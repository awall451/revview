#!/bin/bash
# Run the revview emulator on a laptop (Linux or WSL2): starts the server with the dev key bridge and the laptop
# key map, opens the 1280x400 page in its own browser window, and stops everything when the window closes.
# Needs only Node 22+ and a Chromium, Chrome or Edge. See emulator/README.md.
#
# NOTE: all WSL2 detection and the Windows browser paths below are written from memory and are untested on a
# real WSL2 (and nothing here has run on a real laptop yet).
set -u

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=$(dirname "$here")
usage_line='usage: bash emulator/run.sh [--port N] [--no-browser] [--scale S] [--keys] [--help]'

usage() {
  cat <<USAGE
$usage_line

  --port N       listen on this loopback port (default: a free one)
  --no-browser   only serve: print the URL and keep serving until Ctrl+C
  --scale S      make the window S times bigger on screen (positive number, e.g. 1.5);
                 the page keeps its 1280x400 viewport
  --keys         print the key cheatsheet and exit
  --help         this text

Environment:
  REVVIEW_BROWSER           path or command of the browser to use
  REVVIEW_QUICK_EXIT_SECS   a browser that exits sooner than this (default 3) is taken to have
                            handed the URL to an already running instance; the server keeps going
  TMPDIR                    where the profile and log are made (removed on exit)

The script stops when the browser window closes, or on Ctrl+C / TERM / HUP. Exit codes: 0 after the
window closed or after Ctrl+C / TERM / HUP; 1 on a start failure (Node too old, server did not start);
2 on a bad option.
USAGE
}

bad() {
  echo "run.sh: $1" >&2
  echo "$usage_line" >&2
  exit 2
}

port=
no_browser=
scale=
want_keys=
while [ $# -gt 0 ]; do
  case "$1" in
    --help | -h) usage; exit 0 ;;
    --keys) want_keys=1 ;;
    --no-browser) no_browser=1 ;;
    --port)
      [ $# -ge 2 ] || bad "--port needs a value"
      port=$2; shift
      if ! [[ "$port" =~ ^[0-9]+$ ]] || [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then bad "bad port: $port"; fi
      ;;
    --scale)
      [ $# -ge 2 ] || bad "--scale needs a value"
      scale=$2; shift
      [[ "$scale" =~ ^([0-9]+\.?[0-9]*|\.[0-9]+)$ ]] || bad "bad scale: $scale"
      awk -v s="$scale" 'BEGIN { exit !(s > 0) }' || bad "scale must be positive: $scale"
      ;;
    *) bad "unknown option: $1" ;;
  esac
  shift
done

quick=${REVVIEW_QUICK_EXIT_SECS:-3}
[[ "$quick" =~ ^[0-9]+$ ]] || bad "REVVIEW_QUICK_EXIT_SECS must be a whole number: $quick"

# Node 22+
node_v=$(node --version 2> /dev/null) || {
  echo "run.sh: node not found. Node 22 or newer is needed (install it and put it on PATH)." >&2
  exit 1
}
node_major=${node_v#v}
node_major=${node_major%%.*}
if ! [[ "$node_major" =~ ^[0-9]+$ ]] || [ "$node_major" -lt 22 ]; then
  echo "run.sh: found Node $node_v, but Node 22 or newer is needed." >&2
  exit 1
fi

keymap="$root/config/buttons.laptop.json"

if [ -n "$want_keys" ]; then
  # shellcheck disable=SC2016  # the JS has its own template strings
  node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const hold = { back: "home", "read-aloud": "stop", cancel: "Ctrl+C" };
    console.log("Keys (focus the emulator window first). tap = press and release; hold = about 0.4 s; long hold = about 1 s.");
    for (const b of m.buttons) {
      const kind = b.longHold ? "long hold" : b.hold ? "hold" : "";
      const extra = kind ? `, ${kind}: ${hold[b.button] || "(see config)"}` : "";
      console.log(`  ${String(b.key).padEnd(12)} tap: ${b.button}${extra}`);
    }
  ' "$keymap" || exit 1
  exit 0
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/revview-emu.XXXXXX") || { echo "run.sh: cannot make a temp dir" >&2; exit 1; }
log="$work/server.log"
spid=
bpid=
winprofile=

# shellcheck disable=SC2317  # called through the EXIT trap
cleanup() {
  trap '' INT TERM HUP
  if [ -n "$bpid" ] && kill -0 "$bpid" 2> /dev/null; then
    command -v pkill > /dev/null 2>&1 && pkill -P "$bpid" 2> /dev/null
    kill "$bpid" 2> /dev/null
    wait "$bpid" 2> /dev/null
  fi
  if [ -n "$spid" ]; then
    kill "$spid" 2> /dev/null
    wait "$spid" 2> /dev/null
  fi
  [ -n "$winprofile" ] && rm -rf "$winprofile"
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 0' INT TERM HUP

node "$root/src/server/index.js" "${port:-0}" --dev-bridge --dev-keys "$keymap" > "$log" 2>&1 &
spid=$!

fail() {
  echo "run.sh: $1" >&2
  [ -s "$log" ] && tail -n 15 "$log" >&2
  exit 1
}
answers() { # a bare HTTP GET over /dev/tcp, no curl needed
  local line
  exec 3<> "/dev/tcp/127.0.0.1/$1" 2> /dev/null || return 1
  printf 'GET / HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n' >&3
  IFS= read -r -t 3 line <&3
  exec 3<&- 3>&-
  [[ "$line" == HTTP/* ]]
}

# Wait for the server: its "view:" line gives the port, then the page must answer.
actual=
deadline=$((SECONDS + 15))
while :; do
  kill -0 "$spid" 2> /dev/null || fail "the server stopped while starting"
  if [ -z "$actual" ]; then
    url_line=$(grep -m1 '^view:' "$log" 2> /dev/null)
    if [[ "$url_line" =~ :([0-9]+)/?$ ]]; then actual=${BASH_REMATCH[1]}; fi
  fi
  [ -n "$actual" ] && answers "$actual" && break
  [ "$SECONDS" -lt "$deadline" ] || fail "the server did not answer within 15 s"
  sleep 0.1
done

# Browser choice. WSL2 detection and the Windows paths are from memory, untested on a real WSL2.
is_wsl=
if [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qiE 'microsoft|wsl' /proc/sys/kernel/osrelease /proc/version 2> /dev/null; then
  is_wsl=1
fi
browser=
host=127.0.0.1
windows_browser=
if [ -n "${REVVIEW_BROWSER:-}" ]; then
  browser=$REVVIEW_BROWSER
else
  for c in chromium chromium-browser google-chrome google-chrome-stable microsoft-edge microsoft-edge-stable; do
    if command -v "$c" > /dev/null 2>&1; then browser=$c; break; fi
  done
  if [ -n "$is_wsl" ] && { [ -z "$browser" ] || { [ -z "${WAYLAND_DISPLAY:-}" ] && [ -z "${DISPLAY:-}" ]; }; }; then
    browser=
    for c in "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" \
      "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
      "/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe"; do
      if [ -x "$c" ]; then browser=$c; windows_browser=1; host=localhost; break; fi
    done
  fi
fi

page="http://$host:$actual/?devkeys=1"
serve_on() {
  echo "Serving until Ctrl+C."
  while kill -0 "$spid" 2> /dev/null; do
    sleep 0.2 &
    wait $!
  done
  fail "the server stopped"
}
if [ -n "$no_browser" ] || [ -z "$browser" ]; then
  [ -z "$no_browser" ] && echo "run.sh: no browser found (set REVVIEW_BROWSER, or install Chromium, Chrome or Edge)."
  echo "view:  $page"
  serve_on
fi

profile="$work/profile"
if [ -n "$windows_browser" ]; then
  wtemp=$(cmd.exe /c 'echo %TEMP%' 2> /dev/null | tr -d '\r')
  wbase=$(wslpath -u "$wtemp" 2> /dev/null)
  if [ -n "$wbase" ] && winprofile=$(mktemp -d "$wbase/revview-emu.XXXXXX" 2> /dev/null); then
    profile=$(wslpath -w "$winprofile")
  else
    winprofile=
  fi
fi

args=("--app=$page" '--window-size=1280,400' "--user-data-dir=$profile" --no-first-run --no-default-browser-check)
[ -n "$scale" ] && args+=("--force-device-scale-factor=$scale")

echo "view:  $page"
start=$SECONDS
"$browser" "${args[@]}" > /dev/null 2>&1 &
bpid=$!
wait "$bpid"
brc=$?
bpid=
if [ $((SECONDS - start)) -lt "$quick" ]; then
  if [ "$brc" -ne 0 ]; then
    echo "run.sh: the browser ($browser) exited at once with status $brc; open the view: line above in a browser yourself."
  else
    echo "run.sh: the browser exited at once; the window may be open in another browser instance."
  fi
  serve_on
fi
exit 0
