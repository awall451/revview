#!/bin/bash
# Install the revview unit and the dongle udev rule on the Pi. UNTESTED: written without a Pi.
# Usage: sudo bash pi/install.sh [REVVIEW_DIR]     (REVVIEW_DIR defaults to this repository)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dir="$(cd "${1:-$here/..}" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root: sudo bash $0" >&2
  exit 1
fi
for need in node python3 tmux; do
  command -v "$need" > /dev/null || echo "warning: $need not found (the server needs node, the grab needs python3, sessions need tmux)" >&2
done
case "$dir" in
  *[[:space:]@\|]*) echo "REVVIEW_DIR must not contain spaces, @ or |: $dir" >&2; exit 1 ;;
esac

# A service user without a login, in the input group.
if ! id revview > /dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin --groups input revview
else
  usermod --append --groups input revview
fi

install -m 0644 "$here/70-revview-dongle.rules" /etc/udev/rules.d/70-revview-dongle.rules
sed "s|@REVVIEW_DIR@|$dir|g" "$here/revview.service" > /etc/systemd/system/revview.service
chmod 0644 /etc/systemd/system/revview.service

udevadm control --reload
udevadm trigger --subsystem-match=input
systemctl daemon-reload
systemctl enable --now revview.service

echo "installed. Check: systemctl status revview; journalctl -u revview -n 50"
echo "Fill in the dongle's real USB ids in /etc/udev/rules.d/70-revview-dongle.rules and config/buttons.json."
