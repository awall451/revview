---
id: qa-20261122-r6b-05
title: pi/README and BENCH gaps for the owner: Updating never refreshes the data set-up's files; BENCH-TEST uses B1-B7 twice; the clone URL's access is not stated
severity: minor
area: pi/README.md "Updating" and step 5, pi/data-setup.sh (without --format), docs/BENCH-TEST.md item ids, docs/REVOKE.md
how to reproduce: read pi/README.md top to bottom as the owner; `grep -n "data.env\|data-setup\|revview-unlock" pi/install.sh` (no match except a comment); `grep -n "^| B[1-7] " docs/BENCH-TEST.md`
evidence: quoted below
---

## Seen

1. **Updating does not refresh the data set-up.** The unlock unit, the stick's udev rule, `/etc/revview/data.env`,
   `data.conf` and `/etc/profile.d/revview-claude.sh` are written only by `data-setup.sh` (`pi/data.mjs`);
   `install.sh` does not touch them. "Updating" step 6 says only "Run `install.sh` again". After a `git pull` that
   changes `pi/data.mjs` or `pi/unlock.sh` templates, the Pi keeps the old unit/rule/env. If re-running
   `data-setup.sh` (no `--format`) is the way, Updating must say so, and it must say when: REVOKE (c) step 4 says
   `data-setup.sh` "refuses while the data is open", while Updating step 5 needs the data unlocked for
   `claude update`. So the order would be: update with the stick in, then reboot without it, run data-setup, reboot
   with it. None of that is written. B13 (the update bench item) does not include it either.
   (`pi/unlock.sh` itself runs from `/opt/revview`, so a change there does take effect; units and rules do not.)
2. **BENCH-TEST has two items each called B1 to B7**: "Several sessions and subagents" (line 101-107) and "Stage 4B"
   (line 236-242). pi/README and DECISIONS say "bench B1-B17" for part B; an owner reporting "B4 failed" is
   ambiguous.
3. **Step 5's clone** `sudo git clone https://github.com/awall451/revview /opt/revview` is the published remote
   (`owner-publish status`: published e550418). The README does not say whether the repository is public; if it is
   private, an HTTPS clone as root on the Pi asks for credentials, and the push credentials the README later puts in
   `~/.ssh` are for the Claude repositories, not this one. One sentence would close it. Not verified from here (GitHub
   is not reachable from the VM).

Checked and fine: steps 1-10 are in order; there is no `npm ci` any more and src/, hooks/, pi/ need no package;
the undo list now names every file the installer and data-setup create (checked against the install output on a
fake root: udev 70/71, user unit and its wants link, linger file, server.env, autostart, hooks); `readonly.sh` usage,
`data-setup.sh` refusals and REVOKE (a), (b), (d) read clearly.
