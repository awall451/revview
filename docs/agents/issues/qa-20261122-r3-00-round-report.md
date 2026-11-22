# QA round 3, 2026-11-22, on gate/main 72a2d13

Setup as the README says, in a fresh worktree of gate/main: `npm ci`, then `bash tools/check /tmp/qa-r3-check-out`
(setup, lint, seed, unit, emulator and shots all ok; TESTS_PASSED=423, of which 225 are Playwright tests, all passed). Live server
`npm start` on 127.0.0.1:8138, plus fresh servers on random ports for isolated scenarios. Everything below was driven in
Playwright Chromium at 1280x400, device scale 1, by POSTing hook events and screenshotting the live page after each one.
Screenshots, scenario files and the driver are outside the repo: `/tmp/qa-r3-shots/`, `/tmp/qa-r3-scen/`,
`/tmp/qa-r3-tools/` (`drive.mjs` = POST + wait for `data-seq` + screenshot + visible text, CSS cuts, off-panel boxes).

## Used

- All six recordings in `fixtures/sessions/` through 8138, screenshot after every event (112 events).
- The newer recordings in `fixtures/buttons/` (Esc, Ctrl+C, hook allow/deny/terminal, two `--bg` sessions) through the view.
  Hook events only; no wheel buttons were tested.
- Own sequences: permission for Edit/WebFetch after a Bash; commands of 30-372 characters, heredoc, unbroken 290 x, emoji and
  CJK, with 0/1/3 output lines; output with CRLF, `\r` progress bars, ANSI, tabs, stderr-only, stdout and stderr, 300-character
  lines, RTL and combining marks, a PostToolUseFailure; two and eleven sessions (idle second session, permission in the other,
  answer, Stop, idle_prompt, SessionEnd of a session with a prompt pending); parallel subagents with two prompts and a duplicate
  PermissionRequest; out-of-order, duplicate, malformed, id-less and input-less events; a 45-character CJK repo with an emoji branch
  and an MCP tool with a 150-segment path; OFFLINE over a prompt; server SIGKILL with the page open, two reloads while it
  was down, then a restart; a POST cut halfway, a chunked POST and a POST body that never finishes.

## Recomputed by hand

- Diffs: working-turn `+4 −1` (Edit structuredPatch +1 −1, Write create of 3 lines); s09 `+1 −3` then `+3 −4`; duplicate
  case `+3 −1` (shown `+6 −2`, issue 07). All other shown diffs match.
- Type: 40 px / (1280/190 px/mm) = 5.94 mm and 23 px = 3.41 mm, the same as emulator.log and DECISIONS. Rows: 84 + 8 + 7 x 40 + 8 = 380 of 400.
- Contrast: `#ff7a7a` on black 8.31:1 (table 8.32, rounding), `#b8b8b8` 10.6:1.

## Findings

| id | severity | title |
|---|---|---|
| 01 | major | NEEDS PERMISSION for a non-Bash tool shows the previous Bash command and its output, as if that were the request |
| 02 | minor | After Esc or Ctrl+C mid-turn (recorded) the bar keeps showing WORKING and the interrupted command |
| 03 | minor | NEEDS PERMISSION for an Edit shows the turn's diff, which reads as the size of the asked edit; rest of the view empty |
| 04 | minor | OFFLINE hides NEEDS PERMISSION; the prompt survives only as a 3.4 mm note |
| 05 | minor | A failed turn (StopFailure) shows a plain WAITING FOR ME |
| 06 | minor | A PermissionRequest after its PostToolUse (or with the Post lost) keeps NEEDS PERMISSION through later tools until Stop |
| 07 | cosmetic | A duplicated PostToolUse doubles the diff and shows it as exact |
| 08 | cosmetic | A late PostToolUse after Stop and idle_prompt flips WAITING FOR ME back to WORKING |
| 09 | cosmetic | Wrapped commands break after "--" (already in STATE.md as a follow-up) |
| 10 | cosmetic | Docs still describe the pre-dense layout (no wrapping, MIN_MM 10.5/6.0, "line 3") |

1 major, 5 minor, 4 cosmetic.

## Round 2 fixes, re-checked in the emulator

| round 2 | verdict | what was checked |
|---|---|---|
| 01 idle session outranks working | fixed | A works, B SessionStart and B idle_prompt: the bar stays `WORKING +1 revview` (s04 01-02); recording events-e with a third helper session: stays on the working one |
| 02 subagent prompt vanishes | fixed | subagent-permission recording: NEEDS PERMISSION `touch marker.txt` stays through 9 sibling events, a main Stop and a driver prompt, and clears at its own PostToolUse; s05 two prompts in two subagents plus a duplicate: shown in order, each cleared by its own Post |
| 03 which session | fixed by the dense layout | the repo stays in the band next to NEEDS PERMISSION +1 / +7, even with a 45-character repo (cut with an ellipsis); `#session` did not show (issue 10) |
| 04 detail lines flip | fixed | two working sessions, events interleaved: the bar stays on the last one spoken to; a permission in the other one takes the bar and gives it back to the one spoken to after the answer |
| 05 branch of ended session | fixed | a new session in another repo shows no branch; STARTING after an end still shows the old repo/branch (same Pi, accepted) |
| 06 compaction | fixed | compaction recording: WORKING through 3 PreCompact/SessionStart compact pairs, DONE stays DONE after a compaction after Stop |
| 07 SessionEnd of unseen | fixed | UNKNOWN and STARTING stay |
| 08 reload while down | fixed in the emulator | SIGKILL, two reloads 2 s apart: NO LINK from the service worker each time, no error page; restart: UNKNOWN, then the next hook shows WORKING/DONE. BENCH H8 stays untested |
| 09 command cut | gone | own rows now |
| 10 first paint | fixed | index.html carries the NO LINK markup |
| 11 `≥ +0 −0` | fixed | `+? −?` with nothing counted |
| 12, 13, 14 | fixed | 9+ and 9-session cap (11 sessions gave +7), offline notes `Claude exited` / `Claude: not known` |
| 15 stale docs | partly | STATE.md is current; the view and emulator READMEs and BENCH H9 are stale after the dense layout (issue 10) |

## Dense layout, judged

- One-second glance: the state word (5.94 mm), the band colour and the shape are the only large things and read first in
  every state screenshotted (all 10 looks plus boot). Whether 6 mm / 3.4 mm works at 700-800 mm is the owner's call and
  bench item 26 (untested). The emulator cannot judge it.
- Wrapped command: correct row limits in every case (6 rows with no output, 5 with one line, 3 with three; end ellipsis only when
  cut; `data-full` keeps the text; the state core cuts at 300 code points first). Only the hyphen break (09).
- Output lines: the last 3 non-empty lines, oldest first, with ANSI, `\r` progress and CRLF cleaned, each cut with an ellipsis. They
  differ from the command only by font (sans vs mono) and the missing indent. That was readable in the screenshots.
- Sparse states: WAITING at session start and NEEDS PERMISSION for a file tool use 1 of 7 rows. Empty is fine. Misleading content
  is not (01, 03).
- Nothing overflowed the panel or overlapped in any screenshot (checked per element: no box outside 1280x400). Clipping is
  always with a visible ellipsis.
- Server: a cut-off POST and a malformed POST change nothing (400, seq unchanged); a chunked POST is accepted. A POST body
  that never finishes gets no answer for at least 10 s (node's default request timeout). Loopback only, so not filed.

## Not tested

- Anything on the Pi, panel, kiosk or in a car, including legibility at 3.4 mm (bench 26) and the service worker (H8).
- Wheel buttons (design only). The button recordings were used only as hook-event input.
- Real Claude sessions: no new recordings were made, to save the owner's usage. Unrecorded: idle_prompt after an
  interrupt (02), StopFailure (05), duplicate hook delivery (07).

## Milestone 1

Not met: this round on current main found one major (01). It is small and local: the pending entry should not
inherit the session's last command and output for a non-Bash request. Once 01 is fixed, the next round can close
the milestone, unless the Cancel button lands first and makes 02 major.
