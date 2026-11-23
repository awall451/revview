---
id: qa-20261123-r7-05
title: BENCH-TEST items whose expected result no longer matches the software (P13, P17, V3, V10, Stage-2 H7) and about 12 duplicate or superseded items still listed as separate work
severity: minor
area: docs/BENCH-TEST.md
how to reproduce: compare each item below with the real server at a85c6bf (stand-in `claude` on PATH, private TMUX_TMPDIR, `--dev-bridge --sessions [--boot] --projects <file>`, presses via POST /dev/key)
evidence: /tmp/qa-r7-s/logv3 and /state lines below; /tmp/qa-r7-shots/r7-02A.png, r7-02B.png, r7-01-starting-ptt.png
---

## Expected results that are wrong today (an owner would report a pass as a failure, or the reverse)

- **P13** expects "UNKNOWN 'No events from this session yet' until Claude's first hook, a known gap". Since part D
  the session shows STARTING until its first hook (up to 30 s), as P20 says. P13 and P20 contradict each other.
- **P17** (Claude not signed in) expects either "Key-on session not started: ..." or UNKNOWN "Push-to-talk does
  nothing: no revview session". Since r6b-02 the bar shows "Key-on session ended at once: see the server log"
  (exit at once) or "<repo> ended" (exit after ~1 s; measured with a stand-in). Neither text is in P17.
- **V3** expects "the bar selects the new session once its first hook event arrives (not before)". Measured: after
  New session the new session is selected at once, STARTING (`starting beta {'index': 2, 'count': 2}` with alpha
  also running).
- **V10** expects "the bar stays quiet, UNKNOWN with the note 'No events from this session yet'" before the trust
  question is answered; today it is STARTING for 30 s, then that UNKNOWN.
- **H7 (Stage 2)**: "stays until a new session pushes it out or `RevviewStarting`": a posted `RevviewStarting` is now
  403 without `--dev-bridge` (r6b-08, checked: 403).

## Duplicates and superseded items (the owner would do the same test twice)

3 ~ S4B-3 (power cut); 6 ~ S4B-4 + S4B-5 (boot without stick, plug in); 7 ~ S4B-6 (pull stick); 5 ~ P12 (hotspot
off); 21 ~ H3 (server restart); 22 ~ H1 + H2 + P10 (boot order); 34 ~ S1 (voice tap); 35 vs S2 (35 "may fail",
S2 "NOT BUILT": contradictory); 37 ~ S3 (allow/deny); H4 (Honest) ~ H4 (Stage 2); 1 and 2 superseded by 27 and 29
(the note row says so, item 1 still says "note the key name for keyd", which DESIGN replaced). Old system-unit
commands remain in D4, R1, R13 and Stage 2 H4 (`sudo systemctl ... revview`, `journalctl -u revview`), covered only
by a "read X as Y" paragraph in the 4A section, which an owner who jumps to D4 will not see.

## Expected

Fix the five expected results; mark superseded items `superseded by <id>` (keep them, do not delete history);
write the user-unit commands in the items themselves.
