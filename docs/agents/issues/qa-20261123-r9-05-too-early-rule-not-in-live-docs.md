---
id: qa-20261123-r9-05
title: Live docs and --keys say Enter allows / N denies a shown prompt; a press within 1.5 s of it appearing (or of Left/Right to it) is refused with "Too early: press again"
severity: polish
area: docs/EMULATOR-LAPTOP.md (Live), --keys sheet
---
Reproduce (stand-in claude): after a PermissionRequest shows (NEEDS PERMISSION), POST /dev/key N down/up within ~0.5 s,
or switch with Left/Right and press Enter 1 s later.
Seen: no decision reaches Claude; note "Too early: press again"; a press after >=1.5 s works (allow and deny files checked).
By design (src/sessions/permissions.js MIN_SHOWN_MS = 1500) but the owner-facing Live text and the sheet do not mention it,
so the first quick tap on a laptop looks like a lost key. Add one sentence.
Related observations (not defects): a session that has sent no hook yet shows UNKNOWN ("No events from this session yet"),
not STARTING; Enter then opens the session list. A closed Claude window is noticed after about 7 s (5 s poll).

Status: fixed on work/qa9-live (see docs/DECISIONS.md "QA round 9")
