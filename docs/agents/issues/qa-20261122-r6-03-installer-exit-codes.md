---
id: qa-20261122-r6-03
title: Installer exit codes mislead: a crash in setup.mjs is reported as "files were refused (see the skipped lines)" with no skipped line and later files never written; a missing or two-line cmdline.txt is skipped with exit 0
severity: minor
area: pi/install.sh (setup_rc handling), pi/setup.mjs `edit`/`main`
how to reproduce: fake root /tmp/qa6-root as in r6-02; cases below
evidence: installer output quoted below
---

## Steps and seen

1. **A crash is called a refusal.** `mkdir ~/.config/labwc/autostart` (a directory where the file goes), run
   `bash pi/install.sh --user car --root /tmp/qa6-root`:

       Error: EISDIR: illegal operation on a directory, read
       install.sh: some files were refused (see the skipped lines above); fix them and run it again
       rc=1

   There is no `skipped` line: node died with an uncaught exception (exit 1, the same code setup.mjs uses for "a
   file was refused"), and install.sh goes on to the hooks and prints "done. Next: reboot". Everything after the
   crash point is silently not done (here the kiosk autostart, so after a reboot there is no bar). The same happened
   with `--root` on a fake root whose passwd uid is not mine: `EPERM: chown '.../home/car/.config'` (stack trace,
   "some files were refused", autostart not written, rc=1). That one is a test-only case (as root chown works), but
   pi/README says `--root` "works on a copy of a file tree (tests)" and install.sh says "no root needed": it only
   works when the fake user's uid is your own.

2. **Skipped boot files exit 0.** `cmdline.txt` with two lines (someone added a second line):
   `skipped .../cmdline.txt: cmdline.txt must be one line, found several`, rc=0. Missing `cmdline.txt`:
   `skipped .../cmdline.txt: missing`, rc=0. Missing `config.txt` likewise. In each case quiet boot and the rotated
   console are not applied, but the run ends "done. Next:" with exit 0, while the no-`root=` case of the same file
   exits 1 with "fix them and run it again".

## Expected

- An unexpected error in setup.mjs is its own exit code (not 1), install.sh stops or says clearly that setup failed
  part way and which files were not done.
- Every "skipped" boot file that leaves the appliance half set up (cmdline.txt, config.txt) makes the run end non-zero
  with the same "fix and run again" line, as the no-`root=` case does. P1 in BENCH-TEST asks the owner to "note any
  `skipped` line", but exit 0 and "done" invite them not to.
