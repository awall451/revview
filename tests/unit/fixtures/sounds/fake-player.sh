#!/bin/sh
# A stand-in cue player for tests. Usage: fake-player.sh [options...] <file.wav>
# The record directory comes from REVVIEW_FAKE_PLAYER_DIR, the playing time in ms from REVVIEW_FAKE_PLAYER_MS (default 0),
# the exit code from REVVIEW_FAKE_PLAYER_EXIT (default 0). Records (each written whole, then renamed):
#   start.<pid>  the last argument (the file) and the start time in ms      end.<pid>  the end time in ms
out=$REVVIEW_FAKE_PLAYER_DIR
ms=${REVVIEW_FAKE_PLAYER_MS:-0}
code=${REVVIEW_FAKE_PLAYER_EXIT:-0}
for last; do :; done
now() { date +%s%3N; }
put() { cat > "$out/.tmp.$$" && mv "$out/.tmp.$$" "$out/$1.$$"; }
printf '%s %s\n' "$last" "$(now)" | put start
if [ "$ms" -gt 0 ]; then
  sleep "$(awk "BEGIN{print $ms/1000}")" &
  wait $!
fi
now | put end
exit "$code"
