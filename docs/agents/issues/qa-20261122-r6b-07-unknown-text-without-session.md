---
status: closed (2026-11-23, work/qa6-fixes: see DECISIONS "QA round 6b"; not yet re-run by QA)
id: qa-20261122-r6b-07
title: With no session at all the bar says UNKNOWN "Not known until Claude's next step" above the boot note
severity: polish
area: view unknown (src/view/view.js fixed note), board after RevviewBootDone with no session
how to reproduce: no revview tmux server; `REVVIEW_START=/tmp/qa6b-s/repos/nope node src/server/index.js 8331 --dev-bridge --sessions --boot`; screenshot at 1280x400 (also with REVVIEW_START unset)
evidence: /tmp/qa6b-shots/r6-01-missing-note.png, /tmp/qa6b-shots/r6b-boot-claude-dies.png
---

## Seen

UNKNOWN (cyan) / "Not known until Claude's next step" / "Key-on session not started: start folder missing". There
is no Claude: nothing will make a "next step". The useful line is the second one. Same after a key-on Claude died
(r6b-02): UNKNOWN / "Not known until Claude's next step" / "Push-to-talk does nothing: no revview session".

## Expected

With no session on the board, the first line says so ("No session") or is left out, so the note is the first thing
read in a glance. Cosmetic; the note itself is readable at 1280x400 (one line, body text size).
