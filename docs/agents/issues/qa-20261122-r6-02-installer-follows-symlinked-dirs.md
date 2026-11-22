---
status: closed (2026-11-22, work/qa6-fixes: the writer refuses a symlink at any component of the path below the root (home included); not yet re-run by QA)
id: qa-20261122-r6-02
title: The installer's symlink guard checks only the last path component; a symlinked ~/.config/labwc (or ~/.config) is followed and root writes a user-owned 0755 file at the link target
severity: minor
area: pi/setup.mjs `write`/`mkdirp`/`atomicWrite` (stage 4A review fix "symlink-safe writes"), pi/README step 7
how to reproduce: fake root /tmp/qa6-root (passwd user `car`, fixtures from tests/unit/fixtures/pi), `ln -s /tmp/qa6-elsewhere /tmp/qa6-root/home/car/.config/labwc`, `bash pi/install.sh --user car --root /tmp/qa6-root`
evidence: installer output and `ls -la /tmp/qa6-elsewhere` (below)
---

## Steps

1. Build a fake root with a home `/home/car`; make `~/.config/labwc` a symlink to another directory
   (`/tmp/qa6-elsewhere`).
2. Run `bash pi/install.sh --user car --root /tmp/qa6-root`.

## Expected

pi/README step 7: "It never writes through a symlink: a target that is a symlink (also `~/.config/labwc/autostart`)
is skipped, a warning is printed and the exit code is 1."

## Seen

    wrote /tmp/qa6-root/home/car/.config/labwc/autostart
    rc=0
    /tmp/qa6-elsewhere/autostart  -rwxr-xr-x  (owned by the user, 504 bytes)

`isLink(p)` is `lstat` of the final path only. A symlinked parent directory is followed by `mkdirp` (existsSync),
`readOr`, the temp file and the rename. Only a symlink AT `autostart` itself is refused (I checked: that case is
skipped, rc=1, as documented).

Why it matters: on the Pi the installer runs as root and the home is controlled by the kiosk user (or by whatever
ran as that user). `~/.config/labwc -> /etc/cron.hourly` would make root create `/etc/cron.hourly/autostart`, mode
0755, chowned to the kiosk user, which the user can then edit. The kiosk user usually has sudo on Raspberry Pi OS,
so the practical risk is small, but the README states a guarantee the code does not give. Either check every
component under the home (O_NOFOLLOW / lstat each parent, or write as the user with `runuser` like the hooks), or
narrow the wording.

Same for `/boot/firmware` being a symlinked directory (followed; there it is harmless).
