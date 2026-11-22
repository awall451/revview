#!/bin/sh
# A stand-in speech engine for tests. Usage: fake-engine.sh <outdir> [sleep-seconds] [exit-code]
# Writes into <outdir>, each file written whole under a temporary name and then renamed, so a test can poll:
#   pid.<pid>    its own pid          child.<pid>  the pid of the background sleep it started
#   argv.<pid>   its arguments, one per line      text.<pid>   what arrived on stdin (written last)
# Then it waits for the sleep (default 30 seconds) and exits with the exit code (default 0).
out=$1
secs=${2:-30}
code=${3:-0}

put() { # put <name> : the content comes on stdin
  cat > "$out/.tmp.$$" && mv "$out/.tmp.$$" "$out/$1.$$"
}

sleep "$secs" &
kid=$!
echo "$kid" | put child
echo "$$" | put pid
printf '%s\n' "$@" | put argv
put text
wait "$kid"
exit "$code"
