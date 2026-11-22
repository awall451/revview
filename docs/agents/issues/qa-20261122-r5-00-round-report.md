---
id: qa-20261122-r5-00
title: QA round 5 report, re-run of round 4's majors with real tmux, and round 3 spot checks, on gate/main adedbbd
severity: n/a (report)
area: sessions, board selection/nav, answered mark, permission rows, offline, command wrapping
how to reproduce: scripts in /tmp/qa5-scripts/ (lib.mjs, r1a, r1b, r2, r3b, r4, r5, r6, r7), run dir /tmp/qa5-run (stand-in claude, projects file, server logs)
evidence: /tmp/qa5-shots/*.png (1280x400, scale 1)
---

## Verdict

One MAJOR remains: r5-01 (the r4-04 Allowed/Denied fix fails for any non-Bash request once a Bash command ran in the
turn). Milestone 1 does not close on this round.

## Setup

- Worktree of gate/main (adedbbd) at /tmp/qa5, `npm ci`, `bash tools/check /tmp/qa5-check`: setup, lint, seed, unit,
  emulator, shots all ok, `TESTS_PASSED=862`.
- Live server `node src/server/index.js 8310 --dev-bridge --start <alpha> --start <beta> --projects <file>`, later
  restarted twice with `--sessions`. Real tmux 3 on `TMUX_TMPDIR=/tmp/qa5-tmux` (private `-L revview`).
- Sessions: a real `claude` 2.1.330 is installed, but I did NOT run it (no hooks configured for it, and it would
  spend the shared sign-in). Instead a stand-in `claude` first on PATH (copied from round 4) that logs argv and
  every byte it receives, so key delivery is checked byte by byte. Hook events: `fixtures/sessions/*.jsonl`
  re-targeted to the tmux windows' uuids; PermissionRequest POSTed to `/permission` as a long poll, as the hook does.
  Non-Bash requests (Edit, Write, WebFetch, MCP, subagent Bash) were built from the recorded payloads by changing
  tool_name/tool_input/agent_id (not recordings).
- Chromium (preinstalled Playwright) at 1280x400, page `/?devkeys=1`, F13-F23 by CDP key events; one tap through
  `POST /dev/key`.

## Round 4 majors, re-run

| Issue | Verdict | What I did and saw |
|---|---|---|
| r4-01 restart hides sessions | HELD | 3 owned windows, SIGTERM, restart with `--sessions`: all 3 on the bar as UNKNOWN placeholders (list shows 3 rows; Settings "3 on the bar, 3 started by revview"). Choosing a row selected it; push-to-talk sent exactly one `20` to that window; right moved to the next and its window got the Space; home worked. With one window left: log `selected: <id>`, `/state` `voice: here`, a bridge tap delivered the Space. Minor left: r5-03. |
| r4-02 list cursor | HELD | List open with highlight on beta; alpha (row above, also the selected session) ended (tmux window killed + SessionEnd): highlight stayed on beta (row 0 now), press chose beta. Highlighted session ended: list closed with "Highlighted session ended: list closed". Minor left: r5-04. |
| r4-03 New session feedback | HELD | Menu > New session > gamma: the new window is selected at once (UNKNOWN, mic, 2/2, "No events from this session yet"); push-to-talk went to the new window, not the old one. Missing folder: "New session not started: project folder missing" shown, still there 7 s later, bar stays on the old session. Cosmetic left: r5-07. Folder-trust question still not proven (bench V10 untested). |
| r4-04 deny vs allow | NOT HELD in general | Holds for r4-04's exact Bash case: "Denied: Bash" through WORKING and DONE, "Allowed: Bash" + output after allow. Fails for an Edit after a Bash ran in the turn: no mark, DONE with the old command's output (r5-01, major). |

## Round 3 spot checks

- Permission rows (r3-01): Edit `src/app.py`, Write `docs/notes.md`, WebFetch, `mcp__github__create_issue`,
  subagent Bash `touch marker.txt && echo made`, each after a Bash with output: no stale command or output under any
  of them. HELD. (WebFetch/MCP show no target: r5-05.)
- Permission while offline (r3-04): NEEDS PERMISSION stays, crossed mic, "No network" row. HELD. (No confirmation
  after a deny while offline: r5-02.)
- Untied prompt (r3-06): a `/permission` request with no PreToolUse showed NEEDS PERMISSION `rm -rf build`; the
  agent's next PreToolUse (Read) cleared it at once and the long poll returned 204 (no answer, so the terminal
  dialog would stay); a press 2 s later answered nothing. HELD.
- Command wrapping (r3-09): a 230-character `npx playwright test --flag=...` command wrapped at spaces in 5 rows,
  no flag split. HELD; an over-long path token breaks between letters (r5-06, cosmetic).

## Hand checks

- Positions: 3 owned windows -> "3/3" on the last, list order alpha, beta, gamma (owned order); after alpha's end
  "1/2"; after gamma's "1/1". Matches the tmux window list.
- Key bytes: every push-to-talk I sent while a session was selected added exactly one `20` to that window's log and
  nothing to others; taps with `voice: none` added nothing.

## Findings

Major: r5-01. Minor: r5-02, r5-03, r5-04, r5-05. Cosmetic: r5-06, r5-07.

## Not tested / notes

- Real Claude Code in the tmux windows (voice, real hooks, folder trust V10). Untested risk worth a recording in
  stage 2: if `/clear` ends a session and continues under a new session id in the same window, the window's
  `@revview_id` no longer matches, so that session would show as "not a revview session" and the old id stays
  ended. I saw the related mechanism: a posted SessionEnd for a live owned window hides it from the bar until the
  next server restart (owned poll does not bring it back) - the known WB4 reviewer follow-up (2), wider than
  "placeholder" only.
- `espeak-ng` is now installed here (`/usr/bin/espeak-ng`; server logs "read aloud: espeak-ng"); STATE still says
  the package request is pending. Read aloud was not tested in this round.
- Nothing on the Pi, panel, buttons or car. No code changed. My server ran on 8310 only and was stopped; my private
  tmux server was killed; the /tmp/qa5 worktree was removed (shots and scripts kept in /tmp/qa5-shots, /tmp/qa5-scripts).
