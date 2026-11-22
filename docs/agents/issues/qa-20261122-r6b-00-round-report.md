---
id: qa-20261122-r6b-00
title: QA round 6b report: re-run of r6-01..r6-07, boot/lock trapping, STARTING until the first hook, --data-lock, pi/README and REVOKE, on work/qa6-fixes 5e7d1ce
severity: n/a (report)
area: server --boot / --data-lock / part D, board notes, pi/install.sh, pi/data-setup.sh, pi/readonly.sh, pi/README.md, docs/REVOKE.md, BENCH-TEST
how to reproduce: worktree of 5e7d1ce (removed after the round); helper scripts in /tmp/qa6b-s (run.sh, start.sh, case.sh, key.sh, shot.mjs, stand-in claude in bin-ok / bin-fail / bin-late / bin-hook, slow tmux wrapper in slow/, stub lsblk and cryptsetup in stub/, mkroot.sh for a fake Pi root); tmux under private TMUX_TMPDIR (/tmp/qa6b-tmux*), real tmux 
evidence: /tmp/qa6b-shots/*.png (1280x400, deviceScaleFactor 1), server logs /tmp/qa6b-s/log-<port>.txt
---

## Verdict

No blocker, no major. The r6 major (r6-01) is fixed as filed: in every case STARTING ends, the buttons work and the
note is readable at panel size. No local POST could make presses drop for good or end a real boot hold. New: 5 minor,
3 polish. Nothing here was run on a Pi; nothing in this report is a claim about hardware. `tools/check` not re-run
(per the task; the lead reports 1262 passed).

## r6 issues re-run

| id | held? | what I did and saw |
|---|---|---|
| r6-01 (major) | held | `--dev-bridge --sessions --boot`, no tmux server: REVVIEW_START unset -> `unknown`, note "No session yet: open the menu for New session" from 0.5 s; missing folder -> "Key-on session not started: start folder missing"; `relative/dir` -> "...: start folder must be an absolute path"; `claude` exiting 1 at once -> "...: see the server log". Menu, press, up: `dropped: false` in all four; menu opens, New session list opens ("No projects: add paths to the projects file" with no projects file). Screenshots r6-01-*.png: each note one line in the body text size, readable at 1280x400. Log reason for the failing claude is only a tmux error (r6b-02) |
| r6-02 | held | `~/.config/labwc` -> outside dir: skipped, "is a symlink; not written through it", rc=1, target dir empty. Also a symlinked home: autostart skipped, rc=1 |
| r6-03 | held | autostart is a directory: "setup.mjs failed part way (exit 3) ... hooks were not installed", rc=3, no "done". Two-line cmdline, missing cmdline, missing config: skipped, rc=1. Message order is confusing (r6b-06) |
| r6-04 | held | `host:99999`, `a b`, `[::1]:443`: log "... using api.anthropic.com:443", server still up after 3 s |
| r6-05 | held | 330-character StopFailure message: 199 code points + "…" in `/state` and on the bar (r6-05-failed-long.png) |
| r6-06 | held | one surviving window, tmux wrapper 1.5 s per call, /state every 100 ms: `starting` (12 polls) -> `starting` alpha, crossed mic, no note (12) -> `unknown` alpha "No events from this session yet". No "No session chosen" flash |
| r6-07 | held | no `npm ci`; clone or copy with chown/chmod; full undo list. Remaining README gaps in r6b-05 |

## Trapping (task 2)

`RevviewBootBegin`, `RevviewBootDone`, `RevviewLaunching`, `RevviewLaunchExpired`: 403 with and without
`--dev-bridge`. Posted `RevviewStarting` after the boot: STARTING shown, presses not dropped. During a real boot hold
(slow tmux): a posted `RevviewStarting` and a forged `SessionStart` did not end the hold harmfully; the boot finished
and selected its own session (the forged one showed as another session, 1/2). With `--data-lock`, posted
`{"locked":false}`: 204, still INSERT KEY, no session. Left over: r6b-08 (polish).

## Part D (task 3)

Menu New session with a `claude` that never hooks: STARTING, crossed mic, 1/1 alpha, "Not ready for voice yet";
push-to-talk -> "Claude is still starting: push-to-talk not sent", log `not done (session starting)`; at 36 s UNKNOWN
and push-to-talk is sent; but the refusal note stays (r6b-01). With a hook after 8 s the session leaves STARTING
at once. A window killed while STARTING: after about 3 s "beta ended", the other session shown. Key-on Claude dying
after 1 s: STARTING about 5 s, then UNKNOWN with no session and no reason anywhere (r6b-02).

## --data-lock (task 4)

Unmounted dir: INSERT KEY "Data locked" from the first poll, menu and New session list work, New session refused
(no tmux server created), `--boot` does not trap (view insert-key, presses not dropped), push-to-talk refused
("no session selected"). Note text not helpful (r6b-03).

## Pi docs and scripts (task 5)

`data-setup.sh --dry-run` on a fake root with stub lsblk (fixture) and a stub cryptsetup that only logs: the good case
prints every step and asks nothing; refused with a plain reason, rc=2: root partition, boot partition, whole disk,
same device twice, key device not USB/no FS/no UUID, wrong `--confirm`, a bare `mmcblk0p3`, unknown user, non-LUKS
without `--format`. Only `cryptsetup isLuks` was called. `readonly.sh status` on a fake root: plain, overlay mounted,
missing /proc/mounts, missing or two-line cmdline, a root path with a space, a bad verb: all answer, nothing crashes.
README/REVOKE gaps: r6b-04, r6b-05.

## Findings

| id | severity | title |
|---|---|---|
| r6b-01 | minor | stale "still starting: push-to-talk not sent" note after the 30 s fallback |
| r6b-02 | minor | key-on Claude that exits after a second: no note, no reason in the log |
| r6b-03 | minor | New session while locked: "see the server log" instead of the known reason |
| r6b-04 | minor | REVOKE (c) new key slot with default PBKDF; the slot-telling rule then fails |
| r6b-05 | minor | Updating never refreshes the data set-up's files; BENCH B1-B7 used twice; clone access unstated |
| r6b-06 | polish | installer: "fix and run again" then "done. Next: reboot"; any dangling ~/.claude called "locked" |
| r6b-07 | polish | UNKNOWN "Not known until Claude's next step" with no session at all |
| r6b-08 | polish | posted RevviewDataLock without --data-lock / posted RevviewStarting with no session stay |

BENCH-TEST: the new behaviour has items (P15-P20, B4, B17); r6b-01 would make P20 as written fail; r6b-02 is
invisible to P17 (both outcomes pass); no item covers REVOKE (c) or an update that changes the data set-up files.
