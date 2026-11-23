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
usage_line='usage: bash emulator/run.sh [--port N] [--no-browser] [--scale S] [--demo | --live] [--keys] [--print-aliases] [--stop] [--help]'

usage() {
  cat <<USAGE
$usage_line

  --port N       listen on this loopback port (default: a free one)
  --no-browser   only serve: print the URL and keep serving until Ctrl+C
  --scale S      make the window S times bigger on screen (positive number, e.g. 1.5);
                 the page keeps its 1280x400 viewport
  --demo         (default) play a looping demo of the bar's states: a demo player posts the recorded
                 Claude Code sessions (fixtures/sessions) to the server; nothing is sent to a Claude
  --live         a real session is asked for: no demo player; the server waits for
                 real Claude Code hook events posted to its port (the one in the view: line). Not with --demo
  --keys         print the key cheatsheet (and the demo keys) and exit
  --print-aliases  print a block of shell aliases (revview, revview-keys, revview-stop) with this
                 clone's path filled in, ready to paste into ~/.bashrc, and exit. Only prints
  --stop         stop EVERY run.sh of this user that is running (from another terminal): prints
                 "stopped (pid N)" for each, or "not running", and exits 0; exits 1 if one did not
                 stop within 5 s
  --help, -h     this text

Environment:
  REVVIEW_BROWSER           path or command of the browser to use
  REVVIEW_QUICK_EXIT_SECS   a browser that exits sooner than this (default 3) is taken to have
                            handed the URL to an already running instance; the server keeps going
  TMPDIR                    where the profile and log are made (removed on exit)

The script stops when the browser window closes, or on Ctrl+C / TERM / HUP. Exit codes: 0 after the
window closed or after Ctrl+C / TERM / HUP; 1 on a start failure (Node too old, server did not start)
or when the server stops while running; 2 on a bad option.
A running script writes its pid and start time to <pid>.pid in a private directory (mode 700, yours):
\$XDG_RUNTIME_DIR/revview-emu, else \${TMPDIR:-/tmp}/revview-emu-<uid>, else /tmp/revview-emu-<uid>. It is
removed on exit; --stop reads those files.
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
mode=
want_keys=
want_aliases=
want_stop=
while [ $# -gt 0 ]; do
  case "$1" in
    --help | -h) usage; exit 0 ;;
    --keys) want_keys=1 ;;
    --print-aliases) want_aliases=1 ;;
    --stop) want_stop=1 ;;
    --no-browser) no_browser=1 ;;
    --demo | --live)
      [ -z "$mode" ] || [ "$mode" = "${1#--}" ] || bad "--demo and --live cannot be used together"
      mode=${1#--}
      ;;
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

uid=$(id -u)
# where a pid file can be, in the order the writer tries: a private directory of the user
# (REVVIEW_EMU_FALLBACK_TMP only lets the tests keep the last place out of the real /tmp)
pid_dir_candidates() {
  {
    if [ -n "${XDG_RUNTIME_DIR:-}" ] && [ -d "$XDG_RUNTIME_DIR" ] && [ -w "$XDG_RUNTIME_DIR" ]; then
      echo "$XDG_RUNTIME_DIR/revview-emu"
    fi
    echo "${TMPDIR:-/tmp}/revview-emu-$uid"
    echo "${REVVIEW_EMU_FALLBACK_TMP:-/tmp}/revview-emu-$uid"
  } | awk '!seen[$0]++'
}
# a real directory (not a symlink) that is the user's own and closed to group and others; with $2 = make, an absent
# one is made (mode 700)
pid_dir_safe() {
  local d=$1 mode
  # a failed mkdir is not an error here: another run.sh may have just made it; the checks below decide
  if [ "${2:-}" = make ] && [ ! -e "$d" ] && [ ! -L "$d" ]; then (umask 077; mkdir -m 700 -- "$d") 2> /dev/null; fi
  [ -d "$d" ] && [ ! -L "$d" ] && [ -O "$d" ] || return 1
  mode=$(stat -c %a -- "$d" 2> /dev/null) || return 1
  [[ "$mode" =~ ^[0-7]+$ ]] && [ $((8#$mode & 8#077)) -eq 0 ]
}
# the start time of a process: field 22 of /proc/<pid>/stat, counted after the last ")" (the name may hold one)
start_time() {
  local s f
  { s=$(< "/proc/$1/stat"); } 2> /dev/null || return 1
  s=${s##*) }
  read -r -a f <<< "$s"
  [ -n "${f[19]:-}" ] || return 1
  echo "${f[19]}"
}

if [ -n "$want_aliases" ]; then
  # only prints; the path is quoted for the shell, then for the alias's single quotes
  q=$(printf '%q' "$root/emulator/run.sh")
  alias_line() { printf "alias %s='%s'\n" "$1" "${2//\'/\'\\\'\'}"; }
  echo "# revview emulator"
  alias_line revview "bash $q"
  alias_line revview-keys "bash $q --keys"
  alias_line revview-stop "bash $q --stop"
  exit 0
fi

if [ -n "$want_stop" ]; then
  # Stop EVERY run.sh of this user that is running. A pid file is "pid start-time"; it is only trusted when it is a
  # regular file of ours in a safe directory, and the pid is signalled only when that process still has that start
  # time (a reused pid has another). A stale file is removed; the file of a live run.sh never is (it removes its own).
  found=0
  while IFS= read -r d; do
    pid_dir_safe "$d" || continue
    for f in "$d"/*.pid; do
      { [ -f "$f" ] && [ ! -L "$f" ] && [ -O "$f" ]; } || continue
      p=
      st=
      read -r p st < "$f" 2> /dev/null
      if [[ "$p" =~ ^[0-9]+$ ]] && [[ "$st" =~ ^[0-9]+$ ]] && [ "$(start_time "$p")" = "$st" ]; then
        kill -TERM "$p" 2> /dev/null
        n=0
        while kill -0 "$p" 2> /dev/null && [ "$(start_time "$p")" = "$st" ] && [ "$n" -lt 50 ]; do sleep 0.1; n=$((n + 1)); done
        if kill -0 "$p" 2> /dev/null && [ "$(start_time "$p")" = "$st" ]; then echo "run.sh: pid $p did not stop within 5 s" >&2; exit 1; fi
        echo "stopped (pid $p)"
        found=1
      fi
      rm -f -- "$f"
    done
  done < <(pid_dir_candidates)
  [ "$found" = 1 ] || echo "not running"
  exit 0
fi

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
  node "$here/keys-sheet.js" "$keymap" || exit 1
  exit 0
fi

work=
spid=
dpid=
bpid=
bgrp=
winprofile=
pidfile=

# shellcheck disable=SC2317  # called through the EXIT trap
cleanup() {
  trap '' INT TERM HUP
  if [ -n "$bgrp" ]; then
    # the browser was started in its own process group: stop it and everything it started
    kill -- "-$bgrp" 2> /dev/null
  elif [ -n "$bpid" ] && kill -0 "$bpid" 2> /dev/null; then
    command -v pkill > /dev/null 2>&1 && pkill -P "$bpid" 2> /dev/null
    kill "$bpid" 2> /dev/null
  fi
  if [ -n "$bpid" ]; then wait "$bpid" 2> /dev/null; fi
  if [ -n "$dpid" ]; then
    kill "$dpid" 2> /dev/null
    wait "$dpid" 2> /dev/null
  fi
  if [ -n "$spid" ]; then
    kill "$spid" 2> /dev/null
    wait "$spid" 2> /dev/null
  fi
  if [ -n "$winprofile" ]; then rm -rf "$winprofile"; fi
  if [ -n "$work" ]; then rm -rf "$work"; fi
  if [ -n "$pidfile" ]; then rm -f "$pidfile"; fi
}
trap cleanup EXIT
trap 'exit 0' INT TERM HUP

work=$(mktemp -d "${TMPDIR:-/tmp}/revview-emu.XXXXXX") || { echo "run.sh: cannot make a temp dir" >&2; exit 1; }
log="$work/server.log"
# the pid file for --stop: the first safe directory that takes it; if none does, say so and run on
mystart=$(start_time $$)
while IFS= read -r d; do
  pid_dir_safe "$d" make || continue
  rm -f -- "$d/$$.pid" # a leftover of an earlier run.sh with this pid; noclobber below refuses anything planted since
  if (umask 077; set -o noclobber; printf '%s %s\n' "$$" "$mystart" > "$d/$$.pid") 2> /dev/null; then pidfile="$d/$$.pid"; break; fi
done < <(pid_dir_candidates)
[ -n "$pidfile" ] || echo "run.sh: no pid file; --stop will not find this run" >&2

server_args=(--dev-bridge --dev-keys "$keymap")
[ "$mode" = live ] || server_args+=(--dev-demo)
node "$root/src/server/index.js" "${port:-0}" "${server_args[@]}" > "$log" 2>&1 &
spid=$!

fail() {
  echo "run.sh: $1" >&2
  [ -s "$log" ] && tail -n 15 "$log" >&2
  exit 1
}
answers() { # a bare HTTP GET over /dev/tcp, no curl needed
  local line
  { exec 3<> "/dev/tcp/127.0.0.1/$1"; } 2> /dev/null || return 1
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

if [ "$mode" = live ]; then
  echo "live mode: no demo; the server waits for real Claude Code hook events posted to 127.0.0.1:$actual"
else
  node "$root/emulator/demo/player.js" --url "http://127.0.0.1:$actual" &
  dpid=$!
  echo "demo mode: 1-7 scenes, P pause, [ ] slower/faster; see --keys"
fi
player_noted=
note_player() { # the demo player stopped by itself while the server is up: the bar still works
  if [ -n "$dpid" ] && [ -z "$player_noted" ] && ! kill -0 "$dpid" 2> /dev/null; then
    player_noted=1
    echo "run.sh: the demo player stopped; the bar keeps serving without the demo."
  fi
}

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
    note_player
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
if command -v setsid > /dev/null 2>&1; then
  setsid "$browser" "${args[@]}" > /dev/null 2>&1 &
  bgrp=$!
else
  "$browser" "${args[@]}" > /dev/null 2>&1 &
fi
bpid=$!
# watch the server as well as the browser
while kill -0 "$bpid" 2> /dev/null && kill -0 "$spid" 2> /dev/null; do
  note_player
  sleep 0.2 &
  wait $!
done
kill -0 "$spid" 2> /dev/null || fail "the server stopped"
wait "$bpid"
brc=$?
if [ $((SECONDS - start)) -lt "$quick" ]; then
  if [ "$brc" -ne 0 ]; then
    echo "run.sh: the browser ($browser) exited at once with status $brc; open the view: line above in a browser yourself."
  else
    echo "run.sh: the browser exited at once; the window may be open in another browser instance."
  fi
  serve_on
fi
exit 0 # the EXIT trap stops what is left of the browser's process group
