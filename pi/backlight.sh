#!/usr/bin/env bash
# UNTESTED: never run on the Pi or on the panel. Written from the package tree and from memory
# (docs/PI-FACTS.md, "Backlight and clock"). Not wired into any service or installer.
#
# Usage: backlight.sh day|night|<percent 5-100>
#
# Tries, in this order:
#   1. /sys/class/backlight/*/brightness, scaled from max_brightness. Needs write access to that file
#      (raspberrypi-sys-mods' 60-backlight.rules makes it group video writable; no sudo is used here).
#      The official DSI display has such a device (rpi_backlight, from memory). An HDMI panel normally has none.
#   2. ddcutil setvcp 10 (DDC/CI over HDMI), if ddcutil is installed. Many small HDMI panels do not support it.
# If neither exists it says so and exits 3. The Waveshare 7.9" HDMI panel very likely has no software
# backlight at all (a hardware control or PWM pad only).
#
# Exit codes: 0 done, 2 bad argument, 3 no software backlight found, 4 a control was found but failed.

DAY_PERCENT=100
NIGHT_PERCENT=25
MIN_PERCENT=5 # a lower value can leave the panel dark

usage() {
  echo "usage: ${0##*/} day|night|<percent 5-100>   (UNTESTED)" >&2
}

if [ "$#" -ne 1 ]; then
  usage
  exit 2
fi

case "$1" in
  day) percent=$DAY_PERCENT ;;
  night) percent=$NIGHT_PERCENT ;;
  *[!0-9]* | '')
    usage
    exit 2
    ;;
  *)
    percent=$1
    ;;
esac

if [ "$percent" -gt 100 ]; then
  echo "percent must be $MIN_PERCENT-100" >&2
  exit 2
fi
if [ "$percent" -lt "$MIN_PERCENT" ]; then
  echo "percent $percent is too low: below $MIN_PERCENT the panel may be dark and cannot be read; use $MIN_PERCENT-100" >&2
  exit 2
fi

failed=0
for dev in /sys/class/backlight/*; do
  [ -e "$dev/brightness" ] || continue
  [ -r "$dev/max_brightness" ] || continue
  max=$(cat "$dev/max_brightness")
  value=$((max * percent / 100))
  if echo "$value" > "$dev/brightness"; then
    echo "backlight: $dev set to $value of $max ($percent%)"
    exit 0
  fi
  echo "backlight: cannot write $dev/brightness (needs write access, e.g. group video)" >&2
  failed=1
done

if command -v ddcutil > /dev/null 2>&1; then
  if ddcutil setvcp 10 "$percent"; then
    echo "backlight: ddcutil set brightness (VCP 10) to $percent%"
    exit 0
  fi
  echo "backlight: ddcutil failed (the panel may not support DDC/CI, or no access to /dev/i2c-*)" >&2
  failed=1
fi

if [ "$failed" -eq 1 ]; then
  exit 4
fi
echo "backlight: no software backlight found (no /sys/class/backlight device, no ddcutil)." >&2
echo "backlight: the panel may only have a hardware brightness control." >&2
exit 3
