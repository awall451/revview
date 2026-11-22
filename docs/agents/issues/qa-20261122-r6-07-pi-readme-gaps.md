---
status: closed (2026-11-22, work/qa6-fixes: pi/README: clone over Wi-Fi or copy from a laptop, no npm ci (no runtime package, checked), full undo list; not yet re-run by QA)
id: qa-20261122-r6-07
title: pi/README gaps for an owner with only a fresh SD card: how the repository gets to /opt/revview, an `sudo npm ci` that only installs dev tools, an incomplete Undo
severity: minor
area: pi/README.md steps 5 and "Day to day"; pi/install.sh header
how to reproduce: read pi/README.md as the owner, step by step; `grep` the runtime imports of src/, hooks/, pi/
evidence: package.json (only devDependencies), pi/README.md lines quoted below
---

## Seen

1. Step 5: "**The repository**: put it in `/opt/revview` ..., owned by root and readable by everyone". It does not
   say how (clone from where? copy from a laptop with `scp`/`rsync`? what owner/mode commands?). Nobody here can push
   to a remote, so there is no URL to clone. This is the step where someone with only a fresh SD card stops.
2. Step 5 then says `cd /opt/revview && sudo npm ci`, and install.sh's header says REVVIEW_DIR should be "with npm ci
   done". `package.json` has no `dependencies`, only `devDependencies` (`@playwright/test`, `eslint`), and nothing
   under src/, hooks/ or pi/ imports a package (server README: "Node standard library only"). So the step downloads
   Playwright and ESLint over the phone hotspot and runs their install scripts as root, for nothing the Pi uses.
   Either drop it or say `npm ci --omit=dev` and why.
3. "Undo: the `.revview-backup` copies are the files as they were before the first install." Files the installer
   creates (udev rules, user unit and its enable link, the linger file, server.env, the hooks in
   `~/.claude/settings.json`; on a fresh Pi also `~/.config/labwc/autostart`, which had no backup) are not listed for
   removal. No BENCH item tries an undo.

Checked and fine: step 7's dry run, a real run and a second run on a fake root built from
`tests/unit/fixtures/pi/` (second run prints only `unchanged`, cmdline stays one line, backups made once, CRLF becomes
LF, `--rotate 270 --output HDMI-A-2` rewrites all three rotation parts and drops the old `video=HDMI-A-1:...rotate=90`);
odd user names (`Car`, `1car`, `a.b`, `../../etc`, 41 chars, empty) and rotations (`180`, `0`, `-90`, `"90 "`) are
refused with exit 2 and nothing written; cmdline without `root=` and an empty one are left byte-identical, rc=1.
