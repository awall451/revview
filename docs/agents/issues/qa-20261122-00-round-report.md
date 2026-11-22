# QA round 2026-11-22 on gate/main 0f38005

Setup as the README says, in a fresh worktree: `npm ci`, `bash tools/check /tmp/qa2-check-out` (STEP tests ok,
TESTS_PASSED=3; inside it 162 Playwright tests passed, the unit tests had 0 failures), `npm start` on 127.0.0.1:8138.
Everything below was driven in Playwright Chromium at 1280x400, device scale 1, by POSTing hook events to
the live server. QA kept its screenshots outside the repo (/tmp/qa2-shots, not committed).

Used: the three recordings in fixtures/sessions/ to the end (every event screenshotted); server SIGTERM and
SIGKILL mid-session with restart (reconnect 735 ms, UNKNOWN, then the next hook); boot.html from file://
before the server (NO LINK, then live in about 0.5 s; painted frames captured); two and three sessions
interleaved with subagent events and a permission prompt in the quieter session; SessionEnd in unknown,
starting, working, permission, done, offline and insert-key, and late events after it; oversize Write/Edit/Bash
bodies, also through curl `--data-binary @-` (1.68 MB, 413, marked `≥`); long Latin, CJK and emoji repo, branch,
file and command text in every state with +1; the cap (9 working, 12 permission sessions); 1000 sequential and
300 concurrent POSTs (no error, final state right); 40 reloads; 8 foreign SSE streams (kiosk NO LINK, back
980 ms after one closes); a client that never reads.

Recomputed by hand: every WCAG ratio in the DECISIONS contrast tables (all 13 colours match to two decimals);
the diff lower bound in f-03 (true +173456, shown `≥ +123k −0`, correct and rounded down).

## Findings

| id | severity | title |
|---|---|---|
| 01 | major | An idle or just-opened second session outranks the working one: WAITING FOR ME +N while the driver's Claude works |
| 02 | major | A permission prompt in one subagent is hidden as soon as a parallel subagent runs a tool |
| 03 | minor | With +N, WAITING FOR ME and NEEDS PERMISSION never show which repo needs the driver |
| 04 | minor | Two working sessions make the detail lines and diff flip between repos on every event |
| 05 | minor | The branch of an ended session is shown next to other repos, even after RevviewStarting |
| 06 | minor | SessionStart source "compact" mid-turn shows WAITING FOR ME while Claude works |
| 07 | minor | SessionEnd of an unseen session on an UNKNOWN/STARTING board claims CLAUDE EXITED |
| 08 | minor | A reload of the live page while the server is down leaves a white error page for good |
| 09 | minor | Line 3 cuts a short command at 40% although there is no output |
| 10 | polish | Every live-page load paints an empty grey band first; the hand-over is not "no flash" |
| 11 | polish | "≥ +0 −0" after a lost diff with nothing counted; an id-less lost event marks every session |
| 12 | polish | "+11" next to NEEDS PERMISSION runs off the panel and reads "+1"; view README says N ≤ 7 |
| 13 | polish | The branch becomes a bare "·…" when the repo nearly fills the band |
| 14 | polish | OFFLINE over the new looks reads "Claude: claude exited" / "Claude: unknown" |
| 15 | polish | BENCH 20-22, the view README and STATE.md still describe STARTING / the old behaviour |

## Round-1 issues, re-checked

| id | verdict | what was checked |
|---|---|---|
| 01 restart shows STARTING | fixed | SIGTERM and SIGKILL restarts: NO LINK while away, UNKNOWN "Push-to-talk may still work" after, next hook shows the real state (b-01..b-11) |
| 02 link down looks like STARTING | fixed | NO LINK inverted look at 1.5 s and 10 s without the server |
| 03 sessions mixed | partly | per-session board works and a permission in another session wins (d-09..d-17); but see new 01 (idle outranks working), 02 (inside a session), 03 (which session) |
| 04 SessionEnd ignored | fixed | CLAUDE EXITED after SessionEnd in every state; late events after it ignored; edge case in new 07 |
| 05 page before server | fixed for boot | boot.html from file:// shows NO LINK and hands over by itself; residue in new 08 (reload) and 10 (grey frame) |
| 06 line 3 runs together | fixed | `$ pnpm --filt… → FAIL src/…` with a grey arrow; residue in new 09 |
| 07 MCP stub | fixed | the tool name now uses the free line (`mcp__github__create_pull_re…`) |
| 08 branch stub | fixed | middle cut keeps the end (`x · featur…tial-captures`); residue in new 13 |
| 09 file name double cut | fixed | one middle cut keeping the base name (`PartialC…onAdapter.test.ts`) |
| 10 late Post after Stop | fixed | DONE stays after a late PostToolUse with and without an open tool id |
| 11 dropped event diff | fixed | `≥` lower bound on 413 for Write and Edit, reset at the next prompt; residue in new 11 |
| 12 empty Bash command | fixed | blank command clears command and output |
| 13 contrast table | fixed | table rows now give per-state minimums; all ratios recomputed and matching |
| 14 bench gaps | fixed | BENCH 24 (emoji font) and 25 (Node version) added |
| 15 STATE.md stale | not fixed (again) | STATE.md on 0f38005 still says round-1 issues are open and SessionEnd is ignored (new 15) |

## Not tested

- Anything on the Pi, panel, Chromium kiosk or in a car (BENCH-TEST), including how long the grey frame of 10 lasts there.
- Real interactive Claude Code flows not in the recordings: a denied permission (what hooks follow), `/clear` (whether the
  session id is kept), auto-compaction mid-turn (06), parallel subagents with a prompt (02). These need new
  recordings; QA did not run Claude to avoid spending the owner's usage.
- Hook wiring, push-to-talk and the Pi image: not built yet.
