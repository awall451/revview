---
status: closed (2026-11-23, work/qa7b-fixes: see DECISIONS "QA round 7b"; not yet re-run by QA)
id: qa-20261123-r7b-00
title: QA round 7b report: re-test of r7-01..08 on gate/main e33cbfa
severity: n/a (report)
area: board notes, pi/install.sh, pi/README.md, docs/BENCH-TEST.md, README.md, docs/REVOKE.md
how to reproduce: worktree /tmp/qa-7b (removed); fake root /tmp/qa7b-root passwd alice; real server ports 8391-8394 with --dev-bridge --sessions --boot, stand-in claude, private TMUX_TMPDIR; Playwright 1280x400
evidence: bash tools/check /tmp/check-qa7b: rc 0, TESTS_PASSED=1293
---

| id | held? | how checked |
|---|---|---|
| r7-01 | held | key-on claude exits after 1 s and after 6 s while STARTING: note "Key-on session ended at once: see the server log", log has the "disappeared" line. Quiet session dying after the 30 s limit: note "alpha ended: open the menu for New session"; F13 tap: log "not done (no session selected)", note replaced, screenshot "Push-to-talk does nothing: no revview session". Limit: see r7b-02 |
| r7-02 | held | pi/README "First drive (parked)": /voice tap, keep Space, sox (install.sh package list has sox), P21, S1, P13, P14 named |
| r7-03 | held | fake root, run 1, edit vendor/product/F13, run 2: buttons.json kept, rule has the new ids, one note: line; bad id "zz": rule left, exit 1; name-only device: note, exit 0; unit ExecStart --input /etc/revview/buttons.json |
| r7-04 | held | uniq -d of ids: empty; HW1-HW7, H1-H10 together |
| r7-05 | held | P13, P17, V3, V10, HW7 now match the server behaviour measured above; superseded marks present (13); user-unit commands in D4, R13 |
| r7-06 | held (see r7b-01 for the remaining mix) | note at top of BENCH-TEST, and in items 20, 21, 28, 32, S1 |
| r7-07 | held | README "On the Pi" reading order links pi/README, BENCH-TEST First afternoon, REVOKE, hooks/README; First afternoon: 18 steps, every id exists once |
| r7-08 | held | no `bash pi/` left in REVOKE or BENCH-TEST; only `node hooks/install.mjs` in S3 (r7b-01) |

New: r7b-01 minor, r7b-02 polish, r7b-03 polish. Nothing hardware-only was claimed as proven.
