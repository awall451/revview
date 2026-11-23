---
status: closed (2026-11-23, work/qa7-bench: see DECISIONS "QA round 7"; not yet re-run by QA)
id: qa-20261123-r7-03
title: install.sh tells the owner to put the dongle ids in /etc/udev/rules.d/70-revview-dongle.rules, but the next install.sh run (Updating step 7) silently rewrites that file from the template; the README's own way (edit files inside the root-owned repo) is undone by the documented update
severity: major
area: pi/install.sh closing "Next:" lines, pi/README.md step 10 and "Updating" step 4, pi/revview.service (ExecStart hard-codes @REVVIEW_DIR@/config/buttons.json)
how to reproduce: fake root (passwd `car` with my uid, fixtures from tests/unit/fixtures/pi); `bash pi/install.sh --user car --root R --no-apt /tmp/qa-r7`; `sed -i s/1d50/abcd/g R/etc/udev/rules.d/70-revview-dongle.rules`; run install.sh again; `grep -c abcd R/etc/udev/rules.d/70-revview-dongle.rules`
evidence: second run prints `wrote .../70-revview-dongle.rules`, grep count 0 (the edit is gone); both runs end with "- fill in the dongle's real USB ids in /etc/udev/rules.d/70-revview-dongle.rules and config/buttons.json."
---

## Seen

- The installer's last lines send the owner to the INSTALLED rule in `/etc`. Any later `install.sh` (pi/README
  "Updating" step 7, a rotation change, a re-run after a skipped hook) overwrites it with `pi/70-revview-dongle.rules`
  without a warning, so the dongle rule silently goes back to the placeholder ids.
- pi/README step 10 says the other thing: edit `pi/70-revview-dongle.rules` and `config/buttons.json` in the repo
  and re-run the installer. The two documents disagree.
- Either way the owner's ids then live as local edits in tracked files of `/opt/revview` (root-owned). The service
  reads `/opt/revview/config/buttons.json` (ExecStart). Updating step 4 "copy the new version over /opt/revview"
  overwrites both files; `sudo git -C /opt/revview pull` refuses to merge if upstream touched either file (the team
  will touch `config/buttons.json` once the bench reports key codes). Nothing in Updating says to keep or re-apply them.

Result after a normal update: NO BUTTONS (or wrong keys) in the car, i.e. no push-to-talk, with nothing pointing at
the cause. Not run on a Pi; the overwrite is shown on a fake root.

## Expected

One place for the owner's device ids and key map that survives updates (e.g. a file under `/etc/revview/` that the
installer writes only when missing, as it does for `server.env`, and that the unit passes to `--input`), and one
instruction in both the installer's "Next:" and pi/README step 10. If the repo copy stays the place, Updating must
say how to keep the edits.
