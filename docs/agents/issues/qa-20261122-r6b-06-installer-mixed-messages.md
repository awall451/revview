---
id: qa-20261122-r6b-06
title: install.sh prints "fix them and run it again" and then "done. Next: reboot"; a dangling ~/.claude link is always called "the locked data partition"
severity: polish
area: pi/install.sh (end of run after setup.mjs exit 4; hooks_locked message)
how to reproduce: fake root (passwd user `car` with my uid, fixtures from tests/unit/fixtures/pi); (a) `ln -s /tmp/qa6b-elsewhere <root>/home/car/.config/labwc` or a two-line cmdline.txt, then `bash pi/install.sh --user car --root <root>`; (b) `ln -s /tmp/qa6b-else2 <root>/home/car/.claude` (target not in the root), same command
evidence: installer output below
---

## Seen

(a) The refusal is correct (r6-02 and r6-03 hold, rc=1, nothing written through the link), but the run ends:

    install.sh: some files were refused (see the skipped lines above); fix them and run it again
    .../.claude/settings.json: revview hooks installed
    done. Next:
      - reboot to start everything (kiosk, server, boot screen);

The last thing the owner reads is "done. Next: reboot". With the autostart refused there is no kiosk after that reboot.

(b) `skipped hooks: ~/.claude points to the locked data partition; insert the key stick (or run pi/unlock.sh) and run
this again`, rc=1, for a link that points anywhere that does not exist (here a plain folder that was never part of a
data set-up). The message assumes the cause.

## Expected

When the final exit will be 1, end with the refusal line (or "not done: N files refused, see above") instead of
"done. Next: reboot". For (b), say what was found ("~/.claude is a link to X, which does not exist; if that is the
locked data partition, insert the key stick ...").
