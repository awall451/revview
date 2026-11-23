---
id: qa-20261123-r7-00
title: QA round 7 report: re-run of r6b-01..08 on gate/main a85c6bf, the owner's Pi document set read as one walk-through, glance view regression pass with the recorded sessions
severity: n/a (report)
area: server --boot / --data-lock / New session, board notes, pi/install.sh, pi/README.md, docs/REVOKE.md, docs/BENCH-TEST.md, hooks/README.md, README.md, view
how to reproduce: worktree /tmp/qa-r7 of gate/main a85c6bf (removed after the round); `npm ci`; `bash tools/check /tmp/qa-r7-check-out`; helpers in /tmp/qa-r7-tools (key.sh: POST /dev/key down/up; shot.mjs: Playwright Chromium at 1280x400; replay.mjs: posts each recorded session to a fresh `node src/server/index.js <port>` (no dev bridge) and compares /state with the .expected.json after every event); stand-in `claude` in /tmp/qa-r7-s/bin (never hooks), binA (exit 1 after 1 s), binB (exit 1 at once); real tmux under private TMUX_TMPDIR=/tmp/qa-r7-tmux; fake Pi roots /tmp/qa-r7-root* (passwd `car`, fixtures from tests/unit/fixtures/pi)
evidence: /tmp/qa-r7-shots/*.png (1280x400), server logs /tmp/qa-r7-s/log*, installer output /tmp/qa-r7-s/inst*.txt, /tmp/qa-r7-check-out
---

## Verdict

All eight r6b fixes held as decided. `tools/check` on a fresh worktree: rc 0, 957 unit + 313 emulator passed, 0
skipped. The glance view shows no regression: 112 recorded events in 6 sessions, /state equal to the expected file
after every event, 0 mismatches, no page wider or taller than 1280x400. New: 3 major (all documents), 4 minor,
1 polish. Nothing was run on a Pi; nothing here claims hardware behaviour. No doc claims that anything works on
hardware (grep for "works on the Pi / tested on / verified on / confirmed": no hit).

## r6b re-run

| id | held? | how checked |
|---|---|---|
| r6b-01 | held | `--dev-bridge --sessions --projects`, stand-in never hooks; menu, press, press; F13 at 2 s: "Claude is still starting: push-to-talk not sent", log `not done (session starting)`; at 32 s UNKNOWN "No events from this session yet" (refusal note gone, r7-01-expired.png), F13 then `done` |
| r6b-02 | held as decided | `--boot`, REVVIEW_START: (a) exit after 1 s: STARTING 4 s, then note "alpha ended", log `owned sessions: window of session ... (alpha) disappeared (Claude exited or the window was closed)`; (b) exit at once: note "Key-on session ended at once: see the server log", log "Claude exited at once, its window disappeared before it could be set up (...)". No exit status or stderr (left on purpose, DECISIONS). Driver view of (a): r7-01 |
| r6b-03 | held | `--data-lock` on an empty dir, menu, New session: "New session not started: data locked, insert the key stick" under INSERT KEY (r7-03-locked-new.png); no tmux server created |
| r6b-04 | held | REVOKE (c) step 3 has `luksAddKey --pbkdf pbkdf2 --iter-time 500`, step 1 asks to write slot numbers down and re-run luksDump; matches data-setup's luksFormat options (tests/unit/pi-data-setup.test.js); bench S4B-19 added. Not run (cryptsetup on a device) |
| r6b-05 | held, partly | Updating step 6 gives the data-setup re-run and its order; S4B-18 added; clone sentence says public (not checkable here); the B ids are unique now. The same duplicate-id problem remains for H1-H7: r7-04 |
| r6b-06 | held | fake root: symlinked `~/.config/labwc`, dangling `~/.claude`, `cmdline.txt` without `root=`: each rc 1 and the last line is "not done: some files were refused ... Do not reboot for this yet."; dangling link message names the target ("which does not exist; if that is the locked data partition ...") |
| r6b-07 | held | missing start folder, no session: UNKNOWN with only the note "Key-on session not started: start folder missing" (fixed line gone); with a session present the fixed line stays (r7-01-expired.png) |
| r6b-08 | held | no dev bridge: posted RevviewStarting 403, RevviewDataLock 403, state unchanged. With dev bridge: 204, applied. RevviewBootBegin/BootDone/Launching/LaunchExpired 403 with dev bridge. `--data-lock` without dev bridge, posted `locked:false`: 204, still INSERT KEY (S4B-17 holds) |

"<repo> ended" when the only session ends: shown, but it gives the driver no next step, hides the push-to-talk
"does nothing" line after a tap, and for a key-on Claude that dies after ~1 s it does not point to the log: r7-01.

## Document set (owner at the bench, fresh Pi)

Read in order README.md -> pi/README.md -> hooks/README.md -> REVOKE.md -> BENCH-TEST.md, and checked against
`pi/install.sh` on fake roots (dry run writes nothing; real run; re-run all "unchanged"/same; exit codes 0/1 as
documented) and the data-setup/readonly tests.

- Flash to "bar on screen": pi/README steps 1-9 are in order and match the installer's flags (`--user`, `--rotate`,
  `--output`, `--root`, `--dry-run`, `--no-apt`), its files and its exit codes. The undo list matches what the
  installer writes. Old `revview` system user/unit: only mentioned as "no longer used" and removed by the installer.
- But the README never links pi/README.md, and BENCH-TEST has no order: r7-07 (major).
- "Bar on screen" to "drive a task by voice": no step; `/voice tap`, keeping Space and the recorder tool are not in
  the walk-through: r7-02 (major).
- Dongle ids: installer says edit /etc, README says edit the repo; both are lost at the next update: r7-03 (major).
- BENCH: 149 items, all `untested`. Duplicate ids H1-H7 (r7-04); five expected results out of date and about 12
  duplicates/superseded items (r7-05); items that start a second server crash on the installed Pi (r7-06).
  Before the first useful drive about 11 items (P1, P4, P5, D1, D5, D6, W1, P14, S1, P13, S3), about 13 with the
  overlay (S4B-1) and the in-car glance (26).
- Relative script paths in REVOKE (c) and some bench items: r7-08 (polish).

## Glance view (regressions only)

replay.mjs, real server without dev bridge, one fresh server per recording: working-turn, permission-prompt,
permission-interrupted, idle-prompt, compaction, subagent-permission; a screenshot at each change of view
(replay-*.png). Every view fits 1280x400; band word, chip, repo, tool, command and output as in the gallery. Hand
check: working-turn's Edit (1 line replaced) + Write of a new 3-line file = +4 -1, the bar shows "+4 −1". Live
STARTING, UNKNOWN (with and without a session), INSERT KEY and the notes above also looked at in screenshots.
