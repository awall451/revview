# JOURNAL

## 2026-11-21: one-shot cycle

Owner message 20261121T174544Z-o-f9471a (backlog 7715eb). Stack recorded in `docs/DECISIONS.md`, skeleton laid (`work/skeleton`), the two package requests sent (shellcheck, playwright browsers). Owner issue 20261121T174540Z-i-306187 tracks it.

- 2026-11-21 (lead, same one-shot cycle): `ready/skeleton` merged by the gate as f2bca35 (2 tests: seed.sh, unit.sh). Done by area-lead-platform on Sonnet, no reviewer (docs + skeleton, no tools/check change). Both owner-packages requests still waiting at the end of the cycle. Owner issue 20261121T174540Z-i-306187 set to done. Next when the team runs again: the real `tools/check` on its own branch (held for approval), then the emulator once `/opt/ms-playwright` exists.

## 2026-11-21: one-shot cycle 2 (state core)

Owner message 20261121T180747Z-o-a0651c (backlog 5ffe86, owner issue 20261121T174717Z-i-600daa). area-lead-core (Opus) recorded three real Claude Code 2.1.330 sessions in a throwaway repo under /tmp (headless working turn; interactive permission prompt; idle prompt) and built the pure reducer with one builder. Findings worth remembering: Notification has `message` + `notification_type` (no title), key on `notification_type`; PermissionRequest fires before the permission notification; `idle_prompt` comes about 60 s after Stop; Edit/Write results carry `structuredPatch`; MultiEdit does not exist in 2.1.330; no payload carries the branch. Decisions (in DECISIONS.md): Stop -> `done`, idle notification -> `waiting`, no timers; diff is per turn, counted on PostToolUse; `offline`/`insert-key` overlay the Claude state. Reviewer (Sonnet) found one blocking bug (CRLF output gave no last line) and three small ones; all fixed by a second area-lead-core run (Sonnet). `ready/state-core` merged as 4b18e29 (2 gate tests, 66 node tests). Three bench items added to BENCH-TEST.md. Process note: spawned agents get their own isolated worktree and cannot work in another agent's; to continue a branch, free it (remove the finished worktree) and tell the next agent to `git switch` to it.

## 2026-11-21: one-shot cycle 3 (panel emulator)

Owner message 20261121T174854Z-o-c280c2 (backlog d1780d). area-lead-core (Opus) with two Sonnet builders built it in about 10 minutes: `emulator/panel.js` (one uniform scale 1280/190 = 6.737 px/mm, so 400 px reads as 59.4 mm: conservative), `textSizeMm` measures cap height (ink of a capital H), fixtures are reducer output from `emulator/fixtures/recipes.js` and a unit test keeps them in step, a dependency-free static server `emulator/serve.js` (one per Playwright worker, free port), developer page with diagonal or credit-card calibration. Reviewer (Sonnet): approve, no blocking findings, three small follow-ups (in STATE.md). `ready/panel-emulator` merged first try as 64dfbbf (3 gate tests; 30 Playwright, 81 unit). `tools/check` untouched. Bench items 11-15 added (Pi fonts, daylight, real active area, no scaling, strip vs. panel). Not proven: running as the gate's user was only proven by the gate itself; nothing on hardware. Process note: a finished agent's worktree holds no branch if it detaches; the lead removes the worktree afterwards.

## 2026-11-21: one-shot cycle 4 (the real tools/check)

Owner message 20261121T174915Z-o-4e2539 (backlog bb4fa3, owner issue 20261121T174905Z-i-49aed7). area-lead-platform (Opus) with one Sonnet builder rewrote `tools/check` in about 5 minutes: steps setup (npm ci once), lint (eslint + shellcheck on tracked shell scripts), seed, unit (count from node's junit reporter, leaf tests, skipped/todo excluded), emulator (count from Playwright's json reporter, `expected + flaky`), shots (`REVVIEW_SHOTS_DIR=<outdir>/shots`, cleared first; fails if a state from `FIXTURE_IDS` or `emulator/fixtures/*.json` has no non-empty PNG). One commit 95815d3 on `work/real-check`, only `tools/check`. Measured on a fresh clone with `env -i` (PATH, HOME, proxy): about 7 s, TESTS_PASSED=112 (main: 3), 7 shots. Proven to fail: broken unit test, broken Playwright test, eslint error, shellcheck error, state without screenshot, failed npm ci; skipped tests not counted. Reviewer (Sonnet, fresh context) repeated the breakages: approve, no blocking findings; non-blocking ones are in STATE.md follow-up (d). Submitted as `ready/real-check`; the gate ran it as its own user (all six steps ok, 112) and HOLDS it for the owner. Not proven: a machine without shellcheck. Process note: `owner-gate explain <topic>` only works after `ready/<topic>` exists (create the branch first, then explain). `tests/unit.sh` and `tests/emulator.sh` are left in place but no longer run by the new check.

- 2026-11-21 (lead, same cycle, a mistake of mine): the notes commit 41e3f70 was made with `git add -A` and so included the area lead's worktree `.claude/worktrees/agent-af03c2039440df9d8` as an embedded-repository entry; the gate merged it before I could amend. This follow-up removes the entry (nothing else was affected; the worktree itself is removed). Never use `git add -A` in the main workspace while agent worktrees exist: add the files by name. Because main moved after `real-check` was submitted, `ready/real-check` was rebased once onto the final main (identical `tools/check`) and explained again, before any approval.

## 2026-11-21: one-shot cycle 5 (glance view part 2)

Owner message 20261121T174926Z-o-2d6551 (backlog 527068, owner issue 20261121T174921Z-i-1ce288). area-lead-core (Opus, three Sonnet builders, about 17 minutes) built the real view (`src/view/`: band with colour + shape + state word + repo and branch; line 2 tool and file with a middle cut, `+N −N`; line 3 command and last output line), type sizes in mm set from the measured cap height (`src/view/type.js`; panel constants moved to `src/view/panel.js`), the live server `src/server/index.js` (standard library, POST /event, SSE /events, 127.0.0.1:8138, 1 MiB body limit, Origin/Host checks) and `emulator/tests/live.spec.js`. Reviewer (Opus, fresh context; diff about 1500 lines, touches tests and a network endpoint): changes needed, one blocking finding (the "every state has its own shape" test could not fail) and five small ones (prototype keys in the view, grapheme-safe cuts, 500 when the state core throws, a cap of 8 SSE clients and dropping stalled ones, no `host` option); it broke eight things on purpose and the tests caught each. Fixed by a second area-lead-core run (Sonnet). `ready/glance-view` merged first try as fedb689 (3 gate tests; under the held check: 209 = 1 seed + 106 unit + 102 Playwright, 17 shots). `tools/check` untouched. QA (Opus) on fedb689 replayed the sessions and about 60 awkward events at the panel size: 15 findings, 5 major (restart/link loss shown as STARTING, sessions mixed, SessionEnd ignored, blank page when opened before the server); recomputed cap heights (10.69 / 6.23 mm) and contrast ratios match DECISIONS. Issue 15 (STATE.md stale) is fixed by this notes commit and its file removed. Not fixed this cycle, by the owner's plan: the QA follow-up round. Not proven: no test for dropping a stalled SSE client; nothing on hardware (bench items 16-23 untested). The gallery still does not get the screenshots until the owner approves `ready/real-check`. Process note: QA files issues on its own branch; the lead stacks the notes commit on it and submits both as one `ready/lead-notes-<n>`.

## 2026-11-22: cycle 6 (QA round 1 fixes, QA round 2)

A normal cycle (no new owner message; 20261121T174915Z-o-4e2539 stays `planned`, waiting for the approval of `real-check`). Two area-lead-core runs in parallel: "the bar never lies about what it knows" (Opus, three Sonnet builders, about 27 minutes: QA 01-05, 10, 11) and "detail lines" (Sonnet, about 4 minutes: QA 06-09, 12-14). The two branches conflicted in `src/view/view.js` and the two docs, so a third run (Sonnet) joined them as `work/qa-round-1` and added tests for the combinations (new looks with long text, `+N`, `≥` diff). Reviewer (Opus, fresh context; 2000 lines, core logic, changed tests, network endpoint): changes needed, two blocking (the live page still drew STARTING while connecting; the 8-session cap could drop a pending permission prompt) and four small ones (ended-session memory of 16, a late diff event without id after Stop, id-less events as a false `+1`, field-order assumption of the oversized-event scan); all fixed in one Sonnet run. `ready/qa-round-1` merged first try as 0f38005 (3 gate tests; with the held check script run by hand in a fresh clone: 320 = 1 + 157 + 162, 22 shots, all steps ok). Decisions are in DECISIONS.md ("Honest states", "Detail lines polish"); bench items 24, 25 and H1-H7 added, all untested.

QA round 2 (Opus) on 0f38005: 12 of the 14 round-1 issues truly fixed, 03 partly; 15 new findings, 2 major (an idle session outranks the working one; a subagent's permission prompt vanishes when a sibling subagent runs a tool). Both majors come from the new session board; 02 and 06 rest on assumed Claude Code behaviour and need real recordings first. Planned as the next cycle's first goal (STATE.md, Next).

Not proven: nothing on hardware; the boot page from `file://` only in this Chromium; no screenshot or timing test for the boot hand-over.

Process notes:
- The gate REJECTS a held branch as soon as main moves (seen at 02:14 for `real-check`), so the owner's pending approval is voided by every merge. From now on `real-check` is rebased and explained again as the last act of every cycle that merged something (STATE.md, In flight). The owner was told in the reply to the open message.
- A scout of the first area lead stopped early saying it had seen an "[agent-kit owner notice]". The lead received no notice and the inbox had no new message; treated as not from the owner, nothing was acted on.
- Parallel area leads on the same view file cost one extra integration run; next time split by files that do not overlap, or run them one after the other.
- An empty leftover directory `.claude/worktrees/agent-af03c2039440df9d8` from cycle 4 was removed at the start.

## 2026-11-22: cycle 7 (reconstructed) and cycle 8 (dense layout)

Cycle 7 left no notes (cut short). From the gate and the git log: the owner approved `real-check` (merged 03:49 as f1fc82b, 320 tests; the gallery gets screenshots since then), and `qa-round-2` merged 04:24 as 15dd3f0 (384 tests): all 15 round 2 issues closed, three more real recordings (async subagents with a prompt, Esc'd prompt, auto and manual compaction), a service worker for reload while the server is down. At 04:29 the owner sent priority message 20261122T042927Z-o-d9a077 (text far too big: state word about 6 mm, the rest about 3.5 mm, more lines, lower the tested minimums, show screenshots). An area lead had started on it in a worktree (`work/dense-layout`, 36 files uncommitted) when the cycle was killed.

Cycle 8: the lead committed that leftover as a wip checkpoint on `work/dense-layout`, removed the worktree, and gave the branch to a new area-lead-core (Opus, two Sonnet builders, about 12 minutes). It kept most of the wip, fixed two bugs in it (an empty notes element took a row and silently cut the ellipsis row of the command; reserved slots left empty rows) and recommitted as three commits. Result: state word 5.94 mm, other text 3.41 mm (whole-pixel measurement; 24 px is the nearest to 3.5 mm), two-sided ranges in the tests (5.8-6.3, 3.3-3.7), band 84 px, rows of 40 px: tool/file/diff, full command wrapped over up to 6 rows, last 3 output lines; core keeps `outputLines` (3, CRLF-safe, 80 per line) and commands up to 300 code points. Reviewer (Sonnet, fresh context; core logic and tests touched): approve, no blocking findings; it broke four things on purpose (bigger type, third output line dropped, command overflow, CRLF) and tests caught each; four non-blocking notes are in STATE.md Next 2. `ready/dense-layout` merged first try as 3e8f199 (423 tests, 22 shots). `tools/check` untouched. Owner message answered `done` with four screenshots.

Not proven: legibility of 3.4 mm text on the real panel (bench item 26, untested); the per-state shots are sparse for permission/waiting because the recordings are; no QA round has used main since 0f38005 (next cycle).

Process notes:
- A killed cycle leaves a locked worktree with uncommitted work: `git add -u` + a wip commit inside it (check for untracked files first), `git worktree unlock`, `remove --force`, then hand the branch to a new area lead. The lead's shell loses its cwd if it was inside the removed worktree: `cd` back before spawning agents.
- When only one product branch is in flight, waiting about 3 minutes for the gate before writing notes lets the notes say "merged" and be based on the new main.

## 2026-11-22: one-shot cycle (wheel buttons 1: the design note)

Owner message 20261122T061547Z-o-e2cf26 (backlog abb749, plan 20261122T060852Z-p-dcd34d, owner issue 20261122T061545Z-i-08da9f). Docs and recordings only; nothing built, no product code, `tools/check` untouched. area-lead-core (Opus; one Haiku scout for the package, two Sonnet builders for recordings and writing; about 14 minutes) wrote `docs/BUTTONS.md` (the owner's 8 questions as 8 sections, each statement labelled recorded / source / untested hardware / proposal), recorded Claude Code 2.1.330 in tmux (`fixtures/buttons/`, with a README), updated the DESIGN.md Button row and "second button" note to the two pods, added DECISIONS "Wheel buttons", bench items 27-39 (untested) and the scope escalation. No reviewer (docs only, as the job said); the lead scanned the diff for secrets and read the escalation and section 8.

Recorded facts worth remembering:
- Esc mid-turn stops the turn (no Stop hook event), the session stays usable. One Ctrl+C mid-turn does the same; two Ctrl+C at the idle prompt EXIT the session, so a button never sends two.
- A PermissionRequest hook that waits can answer allow or deny; meanwhile the terminal dialog stays answerable and the first answer wins. A hook killed by its `timeout` leaves the dialog open (nothing allowed or denied). Hook deny ends the turn with Stop, with no PostToolUse and no PermissionDenied. The default timeout was not pinned: set one explicitly.
- `claude agents --json` gives {pid, id, cwd, kind, startedAt, sessionId, name, status, state}; `claude attach` in a tmux pane with `tmux send-keys` reaches only that session. There is no way to interrupt a turn without keystrokes.

Decisions (designed, not built; DECISIONS.md): revview owns plain `claude` sessions in a private tmux server (not the `--bg` hub); every button action goes to the session the driver selected and only the driver changes the selection; the bar names it (position "2/3" and a mic mark), which closes the "cannot say where push-to-talk will land" limit as a rule; its own evdev reader with an exclusive grab replaces keyd; allow/deny by hook, push-to-talk (tap mode), Esc and Ctrl+C by keys.

Scope: the menu, session switching, starting sessions, projects, settings, cancel, deny and read-aloud on demand go beyond charter stage 3. Written in ESCALATIONS.md and asked as 20261122T063053Z-a-wheel-buttons-scope with the default "stage 3 only until answered". Scope is not widened.

Not proven: `/voice` in any mode (no microphone), hold-to-talk, voice inside tmux, Remote Control (source only), the default hook timeout, `agents --json` still saying "working" after an interrupt, anything on hardware.

Process note: one area lead for research + recordings + writing worked well for a docs job; the scout hit its turn limit on the minified package and needed one nudge.

## 2026-11-22: cycle 9 (wheel buttons 2, QA round 3 and its fixes)

Owner message 20261122T064434Z-o-942fed (priority, answer to the scope question): build all of the wheel buttons as phased in BUTTONS.md section 8. All backlog items WB2-6 show approved. Replied `planned`.

Dispatched in parallel: area-lead-core (Opus, four Sonnet builders, about 51 minutes) for WB2 on `work/wb2-input`, and QA round 3 (Opus, about 44 minutes) on 72a2d13. Both took far longer than earlier runs.

QA round 3: 1 major (a non-Bash permission request showed the previous Bash command and output as if it were the request; the gate's own `worst-big-diff-permission` shot had it), 5 minor, 4 cosmetic; all round 2 fixes held; the dense layout reads at a glance. Fixes by a second area-lead-core (Opus, two Sonnet builders, 12 minutes) on `work/qa-round-3`, based on the WB2 branch to avoid the conflict of cycle 6: 01, 03, 04, 06, 09, 10 closed; 02, 05, 07, 08 left open (unrecorded Claude Code behaviour, or WB3).

Reviewer (Sonnet, fresh context, 2 minutes) on WB2: changes needed. Blocking: `POST /event` with `RevviewButton` was accepted as a gesture in the kiosk configuration, so any local process (a Bash command run by Claude itself) could later have answered its own permission prompt once WB3 acts on gestures. Also: faked presence, no retry backoff, the grab helper could outlive the server, half a debounce. A third run (Sonnet lead, 6 minutes) fixed all seven on `work/wb2-qa3` on top of the QA fixes; spot-checked by the lead (403 without `--dev-bridge`, test present). Submitted as one topic `wb2-qa3`: merged 07:58 as 2406ab9, 552 tests (was 423).

Not proven: nothing on hardware; a successful EVIOCGRAB was never seen; the event layout is assumed for 64-bit Pi OS; device ids and key codes are unverified; all input traces are constructed; the grab helper's parent-death exit has no automated test (bench W5); the tests for the 403 gating were not run against the old code to see them fail.

Process notes:
- The reviewer earned its cost: the area lead and its builders did not see the injection path. Keep an independent review for every phase that touches the gesture or permission path.
- Basing the second branch on the first (instead of main) and submitting the stack as one topic avoided a merge run. The untracked QA issue files in the main checkout were read there by the fixing lead and committed on its branch; the lead deleted the untracked copies before `reset --hard`.
- Leftover `worktree-agent-*` branches and three agent worktrees were removed at the end.

## 2026-11-22: one-shot cycle (wheel buttons 2, started after it had merged)

Owner message 20261122T061619Z-o-a96099 (backlog cf3327, owner issue 20261122T061604Z-i-e011ec) started at 08:04, seconds after cycle 9 had already built and merged WB2 (2406ab9) from the owner's scope answer. Nothing was rebuilt. The cycle 9 notes branch `lead-notes-9` was still waiting for the gate; it merged as 135b100.

Done here: a second reviewer (default model, fresh context, 10 minutes) on the merged input layer against the job's six steps and the HTTP gating rule: approve, all met, no real bug. It broke 13 things on purpose: 9 caught (among them the 403 gate, which cycle 9 had not seen fail), 4 survived (helper kill on close, the two threshold comparisons, reset on `SYN_DROPPED`). One area-lead-core run (Sonnet, 2.5 minutes, no builders) closed findings 1-6 on `work/wb2-review2`: merged first try as 98d7fc2, 563 tests (was 552). `tools/check` untouched. Finding 7 (the `dropped` mark trusts a postable `RevviewStarting`) is noted for WB3 in STATE.md.

Not proven: unchanged from cycle 9 (nothing on hardware, no successful EVIOCGRAB seen, constructed traces); the helper's exit after its parent dies stays bench W5.

Process notes: an owner one-shot can arrive for work a normal cycle has just finished; check gate/main and the ready branches before dispatching. A leftover clean worktree `/tmp/rv-wb2` (detached, commit in main) was removed.

## 2026-11-22: one-shot cycle (wheel buttons 3: sessions and actions)

Owner message 20261122T061803Z-o-0ba39d (backlog f07db5, owner issue 20261122T061752Z-i-845780). One topic, `wb3-sessions`, merged first try as c609518 (666 tests, was 563). `tools/check` untouched.

Dispatched: area-lead-core (Opus, five Sonnet builders, a Haiku scout, about 27 minutes) built the session runner, the actions, the permission registry, the hook and the internal interrupt event, with real-tmux tests (stand-in claude) and real Claude Code 2.1.330 recordings (about 12 haiku turns). Reviewer (Opus, fresh context, 20 minutes): changes needed. Blocking: tmux expands formats in `-c` and `-n`, so a directory named `#(cmd)` ran a shell command when a session was started in it. Six smaller findings (hook wait not pinned, tests that hang instead of failing, NEEDS PERMISSION staying after an allow, a residual risk missing in DECISIONS, a doc mismatch, an internal path in a fixture). A second area-lead-core run (Sonnet, 5 minutes) fixed all seven; the lead read the diff of the risky files (runner, actions, board, server) before submitting.

Deviation from the item text, on purpose: the item says "hub pattern (`claude --bg`, `claude agents --json`) with the chosen session attached"; the design note the owner approved afterwards (BUTTONS.md section 3) chose plain `claude` in a private tmux server because `attach` adds a client layer. Built as in BUTTONS.md; said so in the reply. Hold-mode push-to-talk is not built (the detector emits no raw key-down/up; bench S2); the reply says so.

Facts worth remembering: the uuid given with `--session-id` is the `session_id` in hook events; a subagent permission prompt shows no terminal dialog while the hook waits; a Claude config that defaults to auto mode shows no dialog at all (recordings set `defaultMode: "default"`); allow pressed at once does nothing by design (1500 ms rule).

Not proven: voice in tmux, anything on the Pi (bench S1-S6 untested); the 540 s no-answer case for a subagent prompt.

Process notes: again the independent reviewer found what the builders did not (shell injection through tmux formats): keep it for WB4's selection path. Agents cannot remove their own worktree (sandbox): the lead removes it from the main checkout after checking it is clean. Do not run `pgrep -af claude` in the lead's shell: it prints the whole cycle prompt. The publish refusal (secret-scan false positive in commit 0e34fc3) is noted in STATE.md follow-up (g), not handled here.

## 2026-11-22: one-shot cycle (wheel buttons 4: chosen session, bar, list, menu, home)

Owner message 20261122T061830Z-o-003972 (backlog 0475c7, owner issue 20261122T061816Z-i-2ec1f0). One topic, `wb4-selected`, merged first try as 9fe31a4 (794 tests, was 666). `tools/check` untouched, no new dependency.

Dispatched: area-lead-core (Opus, Sonnet builders, about 29 minutes) built the driver-owned selection in the board, removed the runner's second "chosen", the bar marks, list, menu, home, projects file, 13 screenshots, Playwright flows by dev keys (763 tests). Then in parallel: reviewer (Opus, fresh context; approve, 28 mutations, 4 non-blocking findings) and QA round 4 on the branch (real tmux with a stand-in claude, 58 screenshots; 4 major, 5 minor, 2 cosmetic). A second area-lead-core run (Opus, four Sonnet builders, about 19 minutes) on `work/wb4-fixes` fixed the 4 majors (restart hid running sessions; list cursor was a row number; New session gave no feedback; deny looked like allow), the reviewer's two findings and r4-06/08/09/11. A Sonnet reviewer on the fix diff only: approve, 11 of 13 mutations caught, two non-blocking findings (STATE.md, WB4 entry). r4-05/07/10 stay open.

Decisions made by the team (DECISIONS.md "wheel buttons 4"): home order follows BUTTONS.md (done before working), not the old board ranking; press with a prompt shown is only ever an allow attempt; Projects and Settings are read-only; internal events are refused over HTTP even with the dev bridge.

Not proven: anything on the Pi or pods (bench V1-V10 untested); the fix round against real tmux; Claude Code's folder-trust question for a new session.

Process notes:
- QA on the unmerged branch in parallel with the reviewer worked: the reviewer checked the rules, QA found what the rules do not cover (restart, feedback). QA needs its own tmux socket directory and port range; say so in the brief.
- A second area lead cannot use the first one's worktree: branch `work/<topic>-fixes` from the first branch in its own worktree and submit the stack as one topic.
- The reviewer's long run (53 minutes for 3200 lines with 28 mutations) was the slowest step; for a fix round a Sonnet reviewer on the fix diff alone took 4 minutes.
- QA's untracked issue files in the main checkout were committed by the fixing lead on its branch; the lead deleted the untracked copies before resetting main.

## 2026-11-22: one-shot cycle (wheel buttons 6: dongle and pods)

Owner message 20261122T061846Z-o-85d04a (backlog 5e49f0, owner issue 20261122T061835Z-i-4fe5d5). One topic, `wb6-dongle`, merged first try as 5e444c5 (798 tests, was 794). `tools/check` untouched, no new dependency, no product code.

Dispatched: area-lead-platform (Sonnet, no builders, about 5 minutes) wrote `pi/` (udev rule, systemd unit, install script), `docs/zmk/` (reference keymap and options), bench D1-D12, BUTTONS.md section 9 (owner questions 10-14 with suggested defaults) and four unit tests that keep the udev ids, the ZMK keymap and the unit's flags in step with `config/buttons.json`. The lead read the rule, the unit, the install script and section 9 before submitting; no reviewer (docs and set-up files that cannot run here, 394 lines).

`zmk.dev` was refused by the proxy (one try): all ZMK details are from memory and marked so. The domain was not requested by the team; whether to request it is question 12 for the owner.

Not proven: everything (no Pi, dongle or pods). Open for stage 4: which user runs the server and so the Claude sessions (the unit uses a `revview` system user with no sign-in).

Other open owner messages (WB3 reply still `planned` although WB3 merged as c609518; the publish refusal, follow-up (g)) were left for a normal cycle: out of this job.
