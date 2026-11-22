---
id: qa-20261122-r6-00
title: QA round 6 report: re-run of the core-small-14 fixes, --boot and --netmon, the Pi installer, glance pass, on gate/main e550418
severity: n/a (report)
area: view (wrapping, failed turn, band, notes, lists), server --boot/--netmon, pi/install.sh + setup.mjs, pi/README, BENCH-TEST
how to reproduce: scripts in /tmp/qa6-scripts/ (lib.mjs, boot*.mjs, r1-r8.mjs, nm.mjs), run dir /tmp/qa6-run (stand-in claude, slow and failing tmux/claude wrappers, projects file, server logs), fake Pi root /tmp/qa6-root
evidence: /tmp/qa6-shots/*.png (1280x400, scale 1)
---

## Verdict

One new MAJOR: r6-01 (with `--boot` and no key-on session the bar is stuck on STARTING and drops every button; this is
the installed default, since server.env ships with REVVIEW_START commented out). All seven re-tested fixes held.

## Setup

- Worktree of gate/main (e550418) at /tmp/qa-r6, `npm ci`, `bash tools/check /tmp/qa6-check` once: setup, lint,
  seed, unit, emulator (66 s), shots all ok, `TESTS_PASSED=1064`.
- Live server `node src/server/index.js 8320 --dev-bridge --sessions ...` on real tmux (`TMUX_TMPDIR=/tmp/qa6-tmux`,
  `-L revview`), restarted ten times with different flags. Stand-in `claude` (logs argv and bytes); the real Claude
  was not run. Hook events posted by hand from the recorded payload shapes. Chromium at 1280x400, `/?devkeys=1`,
  wheel keys through `POST /dev/key`.
- No hardware. Nothing here says anything about the Pi.

## Re-tested (closed, never re-run by QA)

| Issue | Verdict | What I did and saw |
|---|---|---|
| r5-06 long tokens | HELD | 190-char playwright command: breaks after `/` and `-` only (`test-results-with-a-` / `very-long-...`), flags whole (r1-01). A token with no separator for 90 letters breaks between letters, unavoidable (r1-02). |
| r5-07 MISSING | HELD | Menu > New session: `does-not-exist` row ends in MISSING, bold base name then grey path on every row (r2-04); choosing it: "New session not started: project folder missing". Menu > Projects shows no MISSING (as the view README says, New session only). |
| r5b-02 failed-turn message | HELD | 330-char rate-limit message wraps over 3 rows under "Turn failed: rate limit" (r1-03). Cut at 200 chars without a mark: r6-05. |
| r5-03 no session chosen | HELD | Two owned windows, restart with `--sessions --boot`: crossed mic, "No session chosen: press up to open the list" (r5-01); up opened the list, press chose it, mic back. |
| r4-05 band count | HELD | One other session needing permission: triangle + `1`, position `2/2`, data-full "1 other Claude session needs permission" (r3-06). With 9, 10, 11 others: `9`, `9+`, `9+`, data-full gives 10 and 11 (r3-07-band-*). Hand count: selected foreign-2 of 12, permission sessions = alpha + 10 foreign = 11, others = 10, shown `9+`: right. |
| r4-07 too early | HELD | Press 300 ms after the prompt: "Too early: press again" (r3-01), log `allow: not done (too-early)`; answer in the terminal (PostToolUse): note gone, WORKING (r3-03); a second prompt, early press then a press after 1.6 s: allowed, poll got `{"behavior":"allow"}`, note gone, "Allowed: Bash" (r3-04). A deny tap on DONE gives no "too early". |
| r4-10 gap | HELD | NEEDS PERMISSION word ends at x 693, `▲9+` starts at 725 (32 px), then mic and `5/12`, repo right (r4-02). |

## --boot and --netmon

- `--boot`, no tmux, REVVIEW_START valid: `starting` for about 1 s (seen by polling /state with a slow tmux wrapper),
  then the window. **Between the window appearing and its first hook the bar shows UNKNOWN, live mic, 1/1, "Not
  known until Claude's next step / No events from this session yet"** (b2-window-no-hook.png); the SessionStart
  hook turns it into WAITING FOR ME. This is DECISIONS' "known gap" and P13 lists it; note that push-to-talk is
  live during it, while the real Claude may still be loading.
- One surviving window: nothing started, it is selected (after a short "No session chosen" step: r6-06). Two
  windows: nothing started, none selected, the r5-03 note. REVVIEW_START unset / missing / relative / claude failing:
  STARTING forever, buttons dropped: **r6-01**.
- `--netmon` end to end: this VM has no default route, so the probe fails on the route check whatever port I open:
  OFFLINE at 10.6 s (two failed probes, 10 s apart), as documented. Recovery could not be run end to end (no root to
  add a route). With the real `createDefaultProbe` on a fake route file and a local port I opened and closed
  (/tmp/qa6-scripts/nm.mjs, intervals shortened): online at once; port closed -> OFFLINE after the second failure;
  port open -> ONLINE on the next probe; one lost probe does not go OFFLINE; two calls share one in-flight probe.
  Bad `REVVIEW_NETMON_HOST` values exit 2: r6-04.

## Pi installer (fake root only)

Walked pi/README steps 1-10. Dry run on a fake root: lists 10 files, writes none. Real run twice: second run only
`unchanged`. Rotation 270 + HDMI-A-2 rewrites cmdline, autostart and touch rule together. Bad users/rotations refused
with exit 2. cmdline without `root=` or empty: untouched, rc=1. CRLF -> LF. Symlink at the final path: refused, rc=1;
symlinked parent: followed (r6-02). Exit codes for a crash or a missing/two-line cmdline: r6-03. README gaps: r6-07.

BENCH-TEST: P1-P14 cover each Pi-only step I found (quiet boot, rotation x3, autologin, kiosk, respawn, pause markers,
lingering, netmon on the hotspot, hooks, groups/audio). Not covered: the no-REVVIEW_START boot (r6-01), a bad
server.env value (r6-04), undo (r6-07).

## Glance pass

Three sessions: WAITING / WORKING / DONE each with its colour, chip and word in the list (r8-02); stderr with ANSI
codes shown clean ("error: boom"); long-hold back goes home to DONE beta (permission > waiting > done > working, none
waiting other than the selected): right. OFFLINE over waiting, working and done with "Claude: <state>", `+3−2` and
"No network" (r7-*); hand check of the diff: structuredPatch with 3 `+` and 2 `-` lines -> `+3−2`. Not-owned session
with NEEDS PERMISSION: crossed mic and "Buttons do nothing here: not a revview session". No regressions seen.

## Findings

| File | Severity | Title |
|---|---|---|
| qa-20261122-r6-01-starting-traps-the-bar.md | major | STARTING forever, buttons dropped, without a key-on session |
| qa-20261122-r6-02-installer-follows-symlinked-dirs.md | minor | symlink guard checks the last component only |
| qa-20261122-r6-03-installer-exit-codes.md | minor | crash reported as refusal; skipped boot files exit 0 |
| qa-20261122-r6-04-bad-netmon-host-kills-bar.md | minor | bad optional REVVIEW_NETMON_HOST stops the server |
| qa-20261122-r6-07-pi-readme-gaps.md | minor | repo delivery, needless `sudo npm ci`, incomplete undo |
| qa-20261122-r6-05-failed-message-cut-without-mark.md | cosmetic | failed-turn message cut at 200 chars without "…" |
| qa-20261122-r6-06-restart-flashes-no-session-chosen.md | cosmetic | "No session chosen" flash before boot selects the one window |
