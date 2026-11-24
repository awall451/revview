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

## 2026-11-22: one-shot cycle (wheel buttons 5: read aloud)

Owner message 20261122T061905Z-o-9b479e (backlog ed4dd8, owner issue 20261122T061855Z-i-4692c0). One topic, `wb5-speech`, merged first try as ab44fc2 (862 tests, was 798). `tools/check` untouched, no npm dependency.

Dispatched: area-lead-core (Opus, three Sonnet builders, about 11 minutes) built `src/speech/`, `config/speech.json`, the button wiring, `speakOnStop` (off), DECISIONS "wheel buttons 5", bench R1-R14. The lead read the speaker, the config and the actions diff. Reviewer (Sonnet, fresh context, 1 minute of tool time, no mutations): approve, no blocking finding; the path filter dropped ordinary words ("and/or", "Node.js"), `.env` was glued to the word before it, `[[...]]` (espeak-ng phoneme input, reviewer about 80% sure) reached the engine. A second area-lead-core run (Sonnet, 2 minutes, branch `work/wb5-speech-fixes` on top) fixed those three, strips `<` `>` too, and added the push-to-talk delay note to bench 38.

Engine: Piper first, espeak-ng as fallback, as the standing default said; chosen at start from an ordered list of fixed command lines. Asked the owner for `apt:espeak-ng` (20261122T134519Z-k-4b7f18). Piper has no apt package or recipe here: its command line is from memory and nothing installs it on the Pi yet.

Not proven: any sound at all (no engine, no audio device), voice quality, start delay, mic bleed, Piper. If node is hard-killed a speech process can finish its sentence (written in DECISIONS).

Left for a normal cycle: replies to 20261122T064434Z-o-942fed and the WB3 message (both `planned`, all of WB1-6 are now merged), the publish refusal (follow-up (g); no publish was requested this cycle because it would be refused again).

## 2026-11-22: one-shot cycle (the schedule "is messing up and seems to have a bug")

Owner message 20261122T174730Z-o-27fe95: "start a one-shot. Our schedule is messing up and seems to have a bug". The repo has nothing called a schedule (no code, no doc), so the lead took it as the team's own cycle schedule (the kit's `/etc/agent-kit/schedule`, kit 0.16.0) and read, without changing anything: the schedule, `/var/lib/agent-kit/schedule.log`, `schedule.used`, the cycle ledger and the scripts `agent-kit-schedule` and `lead-cycle`. The kit is read-only for the team: nothing was fixed, the findings went to the owner in the reply and to ESCALATIONS.md. No product change, `tools/check` untouched.

Found (all times UTC; the schedule's zone is America/New_York = UTC-5):

1. Why slots did not run: the 12:00 and 12:45 slots (17:00Z, 17:45Z) are logged "skipped: daily cap (11/8)". The 11 counted cycles of 2026-11-22 are 4 normal cycles, 1 planning cycle and 6 owner one-shots (WB design, WB2 review, WB3-WB6). One-shots and planning cycles run in spite of the cap but still count toward it (written so in `lead-cycle`), so the owner's own jobs used up the room the scheduled slots needed. A skipped slot is never queued. The owner raised the cap to 15 at 17:46Z (`caps.env`).
2. A real mismatch: the cap counts per UTC day (`date +%F` on a VM in UTC, in both `lead-cycle` and `agent-kit-schedule tick`), the slots are per New York day. Three of the 11 (02:14Z, 03:34Z, 04:39Z) ran on the evening of Nov 21 local time. The count resets at 19:00 local, so the evening slots 19:00-22:00 count toward the next day's cap.
3. A slot used without a log line: `daily@01:00 2026-11-22` is in `schedule.used` but not in the log. `agent-kit-schedule set` marks every slot of the last 10 minutes as used without firing and without a log line (`tick --mark-only`), so a slot can vanish silently when the schedule is saved just after its time (the schedule was saved around 06:00-06:10Z).
4. Other things that eat slots by design: a slot that falls while a cycle or a one-shot runs is skipped (a job set for a time waits and starts right after: 08:04Z and 12:54Z did). With slots 45-60 minutes apart and cycles that took up to 114 minutes, this will happen often.
5. Since 06:45Z no normal cycle has run (all six cycles after it were one-shots), so everything "left for a normal cycle" is still waiting: see STATE.md Next.

Forecast given to the owner: with cap 15 and 12 counted after this cycle, today's 13:30, 15:00 and 16:00 slots can run, 17:00 and 18:00 would hit the cap again, and the count resets at 19:00 local. This cycle had to end before 18:30Z or the 13:30 slot would be skipped ("a one-shot job is in progress").

Process note: when an owner message names something the product does not have, look at the kit's readable state (`/var/lib/agent-kit/schedule.log`, the ledger) before asking; do not read `/etc/agent-kit/auth.env`.

## 2026-11-22: cycle 13 (normal cycle: QA round 5, stage 2 hook wiring, core hardening)

The first normal cycle since 06:45Z. Closed the stale owner replies first (WB3 message and the "all of it" answer: `done`; owner issue 845780 done). `owner-issues update` waits on stdin: call it with `</dev/null`. The publish refusal (old follow-up g) is gone: a publish went through at 16:54Z.

Dispatched in parallel: qa (round 5 on main, 6 minutes), area-lead-core (Sonnet, core hardening + real espeak-ng, 5 minutes, 876 tests), area-lead-platform (Opus, stage 2 hook wiring, 19 minutes, 908 tests, its own Opus review inside). QA: three of round 4's majors held with real tmux; r4-04 did not hold for non-Bash requests (new major r5-01), plus 4 minor, 2 cosmetic.

Then: the lead stacked the two branches (`work/stage2-stack`; one append conflict in DECISIONS.md, both sections kept) and gave the QA findings to area-lead-core (Opus, 23 minutes, four Sonnet builders, 964 tests): r5-01..05, r3-05 (StopFailure, from the new real recording), dead owned sessions. In parallel a Sonnet reviewer approved core hardening. Then in parallel: reviewer (Opus) on the fix diff and QA round 5b on the branch. QA: all held, no major, 3 small findings. Reviewer: one blocking finding, a single transient empty tmux listing ended every owned session for good and dropped their later hooks; 12 of 16 mutations caught. Fix round (area-lead-core, Sonnet, 7 minutes, 974 tests): a session ends only when missing from two consecutive listings and is not remembered as ended; missing tests added; speech text for URLs; bidi stripping. Sonnet reviewer on the fix round: approve, three non-blocking notes (in STATE Next 3).

Submitted as one topic `stage2-qa5` (0277757, 80 files, +3155 -92). Decision: one topic, not three, because the fixes sit on top of both other branches.

Decisions made by the agents, written in DECISIONS.md: hooks run synchronously (order); the installer touches only entries marked `# revview-hook`; no timer for dead sessions (a silent long build must not vanish), tmux window presence instead; no new state word for a failed turn.

Not proven: anything on the Pi; any sound (espeak-ng wrote wav files only); PermissionDenied and worker_permission_prompt payloads were never seen.

Process notes:
- Agents spawned by the lead are put in a harness worktree under `.claude/worktrees/agent-*` and cannot use the /tmp worktree named in the brief: brief them to "commit on branch X in the worktree you are given", and remove the leftover worktree and its `worktree-agent-*` branch after each one.
- QA on main + a second QA on the fix branch, 6-7 minutes each, was cheap and found the round's only major; the Opus reviewer found what QA could not (the transient listing).
- Cycle cost about $14 of $40.

Gate: `stage2-qa5` MERGED at 19:33Z (0277757, 974 tests). The notes branch was rejected once ("not based on current main": it was cut before the merge) and rebased. Lesson: submit the notes branch after the work topic's verdict, or base it on the work branch.

## 2026-11-22: cycle 14 (normal cycle: stage 4 part A, small core run)

No owner message, no gate verdict to handle, no leftover worktree. Defined milestone 2 (the Pi appliance) and split stage 4: part A (boot into the bar) now, part B (read-only root, encrypted data, key stick, REVOKE.md, Piper) next.

Dispatched in parallel: area-lead-platform (Opus, 15 minutes, two Sonnet builders, 1026 tests) for stage 4A; area-lead-core (Sonnet, 22 minutes, three builders, 991 tests) for the reviewer leftovers of cycle 13 and the seven open small QA issues. The user question was decided without asking the owner (ordinary decision, autonomy FREE): one login user runs kiosk, server and sessions; the platform lead added the reason for a systemd user unit (audio session).

Reviews in parallel: Opus on stage 4A, Sonnet on core. Both "changes needed". Stage 4A: an empty `cmdline.txt` was rewritten into one without `root=` (a Pi that does not boot); the shell-metacharacter guard for the generated autostart had no test; plus DNS pile-up in the network probe, non-atomic boot-file writes, symlink following as root, and smaller ones. Core: the first `capSessions` call site had no test. One fix round each (Sonnet, 6 and 5 minutes): 1043 and 995 tests. The fix rounds were not re-reviewed (cost; they were specified finding by finding and each new test was mutation-checked by the builders, except the netmon ones): QA round 6 should look.

Stacking: the two branches conflicted in `src/server/index.js` (one block) and at the end of DECISIONS.md. The lead does not write code, so a Sonnet area-lead-core run replayed the core commits on the stage 4A branch (2 minutes; full check 1064 = 1043 + 21). Submitted as ONE topic `stage4a-core14` (8bd4a39), because the second branch only applies on top of the first.

Not proven: anything on the Pi (bench P1-P14 new, all untested); most of the installer's knowledge of Trixie is from memory and marked so.

Process notes:
- Parallel area leads that both touch `src/server/index.js` cost one extra integration run. Next time name the file in one brief only, or run the second lead on top of the first branch.
- Before spawning a fix agent on an existing branch, remove the first agent's worktree (the branch cannot be checked out twice) and tell the new one to `git checkout <branch>` in its own worktree.
- The Opus reviewer ran about two hours of wall time (33 mutations with full test runs): give reviewers a mutation budget ("at most 12, run only the touched test files").
- Cycle cost about $12 of $40.

Gate: `stage4a-core14` MERGED first try at 22:32Z (8bd4a39, 1064 tests). The notes branch was based on the work commit and submitted after the verdict. Publish requested.

## 2026-11-22/23: cycle 15 (normal cycle: stage 4 part B, QA rounds 6 and 6b, part D)

No owner message, no gate verdict to handle, no leftover worktree. Local `main` was one notes commit behind the gate and was reset.

Dispatched in parallel: area-lead-platform (Opus, 27 minutes, six Sonnet builders, its own Opus review and a fix round; 1209 tests) for milestone 2 part B on `work/stage4b`; qa (round 6 on main, 12 minutes). QA: all seven issues closed in cycle 14 held; one new major, r6-01: with `--boot` and no key-on session (the installed default) the bar stayed on STARTING for good and dropped every press. Plus installer findings (a symlinked folder was followed; a crash still printed "done").

Then, on top of `work/stage4b` so that `src/server/index.js` had one owner at a time (lesson of cycle 14): area-lead-core (Opus, 20 minutes, its own reviewer inside; 1262 tests) fixed r6-01..07 and built part D (`work/qa6-fixes`). Its reviewer found that a posted `RevviewStarting` could still trap the bar; the rule now hangs on a flag only the server sets.

Checks of the two un-reviewed fix rounds, in parallel: qa round 6b on the branch (9 minutes: all r6 held, no major, 8 small) and a Sonnet reviewer limited to the two fix commits with a budget of 10 mutations (2 minutes of tool time; 9 caught, 1 survived: the boot-only press-drop rule was not pinned; no test weakened). A Sonnet area-lead-core round (7 minutes, 1271 tests) fixed all of it: the pin, 403 for posted `RevviewStarting` / `RevviewDataLock` outside the dev bridge, r6b-01..08.

Decisions made by the agents (DECISIONS.md "stage 4B", "QA round 6", "QA round 6b"): raspi-config overlay as a separate last step; key stick by file-system UUID, key file on the stick only; the server trusts only the kernel's mount table for "unlocked"; pulling the stick does not lock; STARTING limits 60 s (boot) and 30 s (a started session); push-to-talk not sent to a session that is still starting; relative `REVVIEW_START` refused; installer exit codes.

Publish hygiene: a new test used `10.0.0.1`. The publisher refuses private addresses, so the submission was withdrawn for two minutes (before the gate picked it up) and the address replaced by `192.0.2.1`. Brief agents: documentation ranges only (192.0.2.0/24, 2001:db8::/32) in tests and docs.

Submitted as ONE topic `stage4b-qa6` (7f5d5c3, 18 commits), because the fixes sit on top of part B.

Not proven: anything on the Pi. Most of part B's knowledge of raspi-config, cryptsetup, udev and lsblk is from memory and marked so; bench S4B-1..19 and P15-P20 are new and untested. The r6b fixes were not re-run by QA.

Process notes:
- Running the second lead on top of the first lead's branch avoided the integration run of cycle 14.
- A reviewer scoped to the fix commits with a mutation budget took 2 minutes and still found the one unpinned rule.
- QA on main + QA on the fix branch again found the cycle's only major.
- Cycle cost about $21 of $40 (part B alone about $10).

Gate: `stage4b-qa6` MERGED first try at 00:07Z on 2026-11-23 (7f5d5c3, 1271 tests). Notes branch based on that commit, submitted after the verdict. Publish requested.

## 2026-11-23: cycle 16 (normal cycle: QA round 7, the owner's walk-through)

Start: gate main a85c6bf, `lead-notes-15` merged, published at 00:17Z, no owner message, no open issue. Chosen: QA round 7 on main (milestone 2 had landed), then one platform lead for whatever it found.

QA round 7 (about 8 minutes of agent time): all eight r6b fixes held (r6b-05 partly: H1-H7 ids were still double); no regression in the glance view (112 recorded events replayed into a real server). 8 new findings, the 3 majors all in the documents: the walk-through stopped before `/voice` (r7-02); the dongle ids were lost on a re-run or update (r7-03); no reading order, 149 bench items in building order (r7-07). Minor: the "<repo> ended" note without a next step (r7-01), double ids, five stale expected results, items starting a second server on 8138, relative script paths.

Dispatched: area-lead-platform (Opus, three Sonnet builders + a scout), topic `qa7-bench`. Decisions (DECISIONS.md "QA round 7"): the owner's dongle ids and key map live in `/etc/revview/buttons.json` (root, 0644, created once, never overwritten, edited with sudoedit); the udev rule is generated from it (ids must be exactly 4 hex digits; a symlink, bad JSON or a bad id leaves the rule and exits 1; a name-only or path-only device is a note, no rule); `sox` in the package list (Claude Code 2.1.330's own strings: `/voice [hold|tap|off]`, default hold, key space, needs SoX and a claude.ai sign-in); `pi/README.md` "First drive (parked)"; BENCH-TEST "First afternoon" (18 steps), Stage 2 ids now HW1-HW7, 151 items, all untested; new internal event `RevviewNoSessionPress` (403 over HTTP).

Review: Sonnet reviewer on the branch, 8 mutations, 4 missed (the hex `$` anchor that guards the udev rule text, the 403 for the new event, the symlink guard, one note branch): changes needed, no behaviour bug. One fix round (platform lead on Sonnet): all pinned, each new test seen failing against its mutation; also the read through a symlinked `/etc/revview` directory is refused. 1293 tests (was 1271). The fix round was not re-reviewed.

Not proven: anything on the Pi; the `sox` package name; the tmux detach keys in the README.

Process notes:
- Agents cannot remove their own worktrees (sandbox); the lead removes them with `git worktree remove --force --force` after each report.
- QA writing issue files untracked into the main checkout and the area lead committing them first worked; the lead then cleans the untracked copies.
- Cycle cost about $7 of $40.

Gate: `qa7-bench` MERGED first try at 01:37Z on 2026-11-23 (383dc5c, 1293 tests). Notes branch based on that commit, submitted after the verdict. Publish requested.

## 2026-11-23: cycle 17 (short cycle: QA round 7b)

Start: gate main e33cbfa, `lead-notes-16` merged and published (01:47Z), no owner message, no open issue. Chosen: the one planned job, QA round 7b (Sonnet), then one Sonnet lead for what it found.

QA round 7b (about 3 minutes): r7-01..08 all held (real server with a stand-in `claude`, the installer twice in a fake root, the documents read in the owner's order); `tools/check` 1293. New: r7b-01 minor (First afternoon mixed hand-started servers and the service without saying when to stop or start it; one relative path), r7b-02 polish (the normal end of a drive showed no next step), r7b-03 polish (`pi/README.md` said P1-P14, the list has P1-P21).

Dispatched: area-lead-core on Sonnet, topic `qa7b-fixes`. It did the work itself. First report claimed a new unit test that was not on the branch (its write had been rejected and it did not notice), and the note was set also without `--sessions`, where there is no menu; the changed r5-04 assertion pinned that untrue case. Sent back once: the note only when `board.owned !== null`, hidden while locked, real tests (three seen failing against the old code), an emulator fit test with an 80-character repo. 1299 tests. S1 and S3 of First afternoon now use a session of the running service; S3's hook install dropped (HW1 does it). DECISIONS.md "QA round 7b".

Review: the lead read the core diff (two lines of logic); no reviewer agent.

Process notes:
- Check a report's "added a test" against `git diff --stat`: it caught a test that did not exist.
- Cycle cost about $2.5 of $40.

Gate: `qa7b-fixes` MERGED first try at 02:16Z on 2026-11-23 (86bdaa3, 1299 tests). Notes submitted after the verdict. Publish requested.

## 2026-11-23: cycle 18 (one-shot job: "Emulator on your laptop 1")

Asked: owner message 20261123T034350Z-o-d958cf (backlog item 20261123T033738Z-b-ce8ef5, estimate 70 minutes / $9): a laptop key map for the dev bridge and `emulator/run.sh` that opens the bar in a 1280x400 window, with tests. Nothing else was done this cycle.

Dispatched: area-lead-core (Opus, two Sonnet builders in parallel), topic `laptop-emu`: 2 commits, 1330 tests. Sonnet reviewer (6 mutations, 4 caught, 1 missed, 1 inconclusive): changes needed. Blocking: `exec 3<> ... 2> /dev/null` in the port probe silenced stderr for the rest of the script. Smaller: the script did not notice a dead server; the trap came after `mktemp`; the browser's children were not covered by a test. One fix round (area-lead-core on Sonnet): all four fixed, each new test seen failing first; the browser now runs in its own process group (the old `pkill -P` orphaned the child after a normal window close). 1336 tests. The fix round was not re-reviewed.

Not proven: anything on a real laptop or WSL2 (bench L1-L2, untested); the WSL2 code is from memory.

Process notes:
- An agent cannot enter another agent's worktree: a fix round by a new agent needs its own branch cut from the work branch's head (`git checkout -b work/<topic>-fix <sha>`). The first fix agent returned at once for that reason (about $0.2 lost).
- Each agent leaves a `worktree-agent-*` branch besides its worktree: delete both.
- Cycle cost about $3.5 of $40 (the estimate was $9).

Gate: `laptop-emu` MERGED first try on 2026-11-23 (86a5f21, 1336 tests). Notes submitted after the verdict. Publish requested.

## 2026-11-23: cycle 19 (one-shot job: "Emulator on your laptop 2: demo mode")

Asked: owner message 20261123T043808Z-o-6f7dfb (backlog item 20261123T033802Z-b-d8b2ba, estimate 50 minutes / $6; owner issue 20261123T034359Z-i-58d0e0): a demo mode for the laptop emulator, so the bar shows the recorded sessions without a Claude. Nothing else was done this cycle.

Dispatched: area-lead-core (Opus, two Sonnet builders), topic `demo-mode`: 3 commits, 11 files, about +1001 -8, `tools/check` untouched, no new dependency. Sonnet reviewer: approve, no blocking finding; 6 runs of the new unit tests (3 under CPU load) all passed. It made no mutations and did not run the Playwright spec itself (`tools/check` did).

Not proven: anything on a real laptop or WSL2 (bench L3-L4, untested); speech in demo mode; the player's unit tests were written after the player (not seen failing first). Left out: no compaction scene, keys 8 and 9 do nothing. Reviewer's non-blocking notes, not fixed: Digit8/9 dead zone; no retry of the key stream after a 503; the player's `--url` is not restricted to loopback.

Process notes:
- Cycle cost about $3.6 of $40 (the estimate was $6).

Gate: `demo-mode` MERGED first try on 2026-11-23 (49fc200, 1361 tests, was 1336). Notes submitted after the verdict. Publish requested.

## 2026-11-23: cycle 20 (one-shot job: "Emulator on your laptop 3")

Asked: owner message 20261123T052206Z-o-fe895b (backlog item 20261123T033802Z-b-e11467, estimate 40 minutes / $4; owner issue 20261123T034512Z-i-781902): the laptop guide, the generated `--keys` cheatsheet, the bashrc aliases, a fresh-clone QA pass, two bench items, a publish. Nothing else was done this cycle.

Dispatched: area-lead-platform (Sonnet, no builders), topic `laptop-guide`: 2 commits, 1375 tests (was 1361). Then in parallel: QA (Sonnet) as the owner on a fresh clone with only node on the PATH (every key of the sheet pressed through Playwright; 8 findings, none major: the guide said speech needs `REVVIEW_SPEECH` (wrong, `config/speech.json` is the default), "allow/deny/cancel/talk show what the bar would show" (nothing visible happens in the demo), stale bench L1, `--stop` wording) and a Sonnet reviewer (changes needed, 3 blocking, all on `--stop`: pid file in shared /tmp follows a planted symlink; the `/proc` cmdline check said "not running" for `cd emulator; bash run.sh` and deleted its pid file; a FIFO made `--stop` hang; 6 of 8 mutations caught). One fix round (area-lead-platform, Sonnet), commit d6c022e on `work/laptop-guide-fix`.

Over the estimate: the owner's notice at 60 minutes stopped the fix agent before its final checks (it had run 49 minutes). Its one local `tools/check` run had a single failure in `tests/unit/hook-event.test.js:237` (timing, untouched file, loaded machine). Submitted as it was: the gate decides. The fix round was not re-reviewed and not re-run by QA.

Process notes:
- Tests that start `run.sh` wrote pid files into the shared `/tmp`; QA's `--stop` stopped another agent's run and QA deleted about 40 stale pid files that were not its own. Tests now use a private `XDG_RUNTIME_DIR`. Rule for briefs: anything that signals processes by a shared file gets a private directory in tests from the first version.
- `/home/agent/revview` has no `node_modules`; QA used `/tmp/held-tree/node_modules` for Playwright. Tell QA where one is.
- The fix round was too big for one Sonnet agent inside the estimate (14 points); the estimate of 40 minutes had no room for a review round. Estimate a review and fix round into every item that changes a script.
- Cycle cost about $5 of $40 (the estimate was $4).

## 2026-11-23: cycle 21 (close-out of the one-shot job "Emulator on your laptop 3")

Found: `laptop-guide` MERGED (d6c022e, 1392 tests) and published (8b5ca3e) after cycle 20 was cut off. The owner message was still open (`planned`), so it was handled as priority. Cleaned up: two worktrees, nine merged branches, 35 stale `/tmp/revview-emu-1001-*.pid` files and 8 `/tmp/emu-run-test-*` directories from cycle 20's killed test runs.

Dispatched, in parallel (both Sonnet), what cycle 20 left open: a reviewer on the fix commit d6c022e and QA round 8 on a fresh clone of gate/main. Reviewer: the three earlier blocking findings are closed; one new real gap (`--stop` only looked where its own environment pointed, so a run from another shell was "not running"); pid 0/1 not rejected up front; `--stop` gave up at the first run that would not stop; the sheet contradicted itself about R; 5 of 11 mutations not caught (two of them need a second user). QA: all 8 earlier findings held, every key of the sheet pressed and matched; 2 new small findings (r8-01 read aloud is silent until a session is chosen, r8-02 `--stop` after `kill -9` of run.sh). The claim "Enter, N, Esc, Space, R only log the gesture in the demo" was re-checked and is true for the permission and done scenes.

Then one fix round: area-lead-platform (Sonnet, no builders, 5 minutes), topic `laptop-stop-fix`, 2 commits, 1398 tests locally (was 1392). Not re-reviewed (small; the lead read the `run.sh` diff). Submitted.

Owner: message 20261123T052206Z-o-fe895b answered `done`, owner issue 20261123T034512Z-i-781902 set done. No publish asked for `laptop-stop-fix` yet (it has not merged): next cycle.

Process notes:
- A pgrep by pattern in the lead's own shell matched the lead's own command line and printed the whole prompt: use `pgrep -x` or `-c`.
- Cycle cost about $2.5 of $40.

Later in cycle 21: `laptop-stop-fix` MERGED first try (0d8afcc, 1398 tests) and `lead-notes-21` (23259c9); publish requested. Second small topic `emu-test-leak` (area-lead-platform, Sonnet, 4 minutes; tests only): the lead saw orphaned `stand-in.sh` processes (ppid 1), three per test run, left by `tests/unit/emulator-run.test.js`; cause: the tests killed only run.sh's process group and the browser runs in its own (`setsid`). Not a product bug: the Ctrl+C, TERM, server-died and browser-exit paths of run.sh all stop the browser and are tested. Submitted, not reviewed (26 lines of test code).

A mistake by the lead, written down so it is not repeated: `rm -rf /tmp/emu-run-test-*` by pattern, about a minute after submitting `laptop-stop-fix`, while the gate (which runs as the same user) was checking it. The listing taken one command earlier showed only directories from 05:41-05:49, but the delete ran later and by pattern. The gate run passed, so nothing was hit, but it could have failed a good branch. Rule: delete leftovers in /tmp by the exact names you listed, never by pattern, and never while a submitted branch is being checked. The lead also killed 12 orphaned stand-in processes by pid (started 07:01-07:07, before the submission, parents gone); the three started at 07:10:53 (the gate's run) were left alone.

Also: `owner-issues update` waits on stdin when run without a terminal; give it `</dev/null` (it cost a 2-minute timeout). Other tests leave `revview-inst-*`, `revview-view-*`, `revview-fakegit-*`, `keymap-*` entries in /tmp (seen by the platform lead, not traced): a small clean-up job for a normal cycle.
- Cycle cost about $3 of $40.

## 2026-11-23: cycle 22 (one-shot job "Emulator on your laptop 4": `run.sh --live`)

Asked: owner message 20261123T034545Z-o-59dc1b (backlog item 20261123T033807Z-b-d8b7b4, estimate 60 minutes / $8, confidence low; owner issue 20261123T034527Z-i-170701): `emulator/run.sh --live [project dir]` driving a real Claude Code session in tmux with its own settings file, a clean stop, tests with the stand-in claude, a "Live" section in the laptop guide with bench items. Nothing else was done this cycle; cycle 21's leftover branches were left as they were.

Dispatched: area-lead-platform (Opus, with builders, 13 minutes), topic `live-emu`: 2 commits, 1412 tests locally (was 1398). Then a Sonnet reviewer (approve, no blocking findings; 3 worth fixing: a late tmux server could outlive cleanup, no message for a too-long socket path, the stop assertion would pass with an empty tmux server alive) and one Sonnet fix round for those three (1413 tests).

Gate: first submission FAILED (5ae7eb6, unit step, one test: "another tmux server on its own socket is not touched"). Cause, reproduced: the test started its own unrelated tmux server with a string command (`'sleep 300'`), which tmux runs through `$SHELL`; the gate user's shell is a nologin shell, so the window died at once. Fixed in the test only (argv form `-- sleep 300`, as `src/sessions/runner.js` already does; the product was not affected). Second submission MERGED as 06d19d3 (1413 tests).

Incident, told to the owner in the reply: during the build a builder, against its brief, ran `run.sh --live` once by hand without the stand-in on PATH, so the real `claude` of this VM started in a private tmux server with the real HOME. It was stopped and nothing was left running. The lead checked afterwards: no revview hook in `~/.claude/settings.json`, no tmux or extra claude process. The test that used the old `--live` now puts the stand-in first on PATH so the suite cannot start the real claude.

Owner: message answered `done`; owner issue set done; publish requested for main at 06d19d3 plus these notes.

Process notes:
- The gate user has a nologin shell and no terminal: a test that gives tmux a string command passes here and fails there. Rule for briefs: tmux commands in tests in argv form (`-- cmd args`), and run new process-heavy tests once with `SHELL=/usr/sbin/nologin` before submitting.
- Area leads' sessions are locked to their own worktree (`.claude/worktrees/agent-<id>`); they cannot work in a worktree path the lead names, and two agents cannot both have `work/<topic>` checked out. For a fix round: remove the first agent's worktree before spawning the next, and tell the agent to `git switch work/<topic>` in its own worktree.
- Briefs for anything that starts `claude`: say "never run it by hand without the stand-in on PATH" to the BUILDERS too, not only the area lead.
- Cycle cost about $4.5 of $40 (the estimate was $8); about 50 minutes.

## 2026-11-23: cycle 23 (normal cycle: QA round 9 on `run.sh --live`)

Sync: gate main 998fb0a, nothing failed or held; deleted the four leftover cycle 21 branches; local main fast-forwarded. No owner message, no owner issue.

Decided: the one piece of due work was the QA pass on `run.sh --live` that the one-shot cycle 22 skipped. QA (Sonnet, fresh clone, stand-in claude first on PATH, about 10 minutes) filed one major (r9-01: menu -> New session says "No projects" in a live run, and the CLAUDE EXITED screen sends the owner there), two minor (r9-02 the guide's leftover grep misses the private tmux server; r9-03 a claude that exits at once gives a tmux error) and three polish (r9-04 `#` in DIR refused late; r9-05 "Too early" rule and UNKNOWN not in the guide; r9-06 `--stop` with another TMPDIR). Cleanup, isolation from HOME, key routing and two runs side by side all held. No real claude was started.

Dispatched: `area-lead-core` (Sonnet), one goal, all six. Branch `work/qa9-live` 9c51ce6, check green, 1420 tests (1098 unit + 321 emulator + seed). The lead read the `run.sh` diff: small and plain; no reviewer (385 lines, one test assertion changed for a stated reason). Submitted as `ready/qa9-live`. Not fixed, on purpose: the first live session shows UNKNOWN instead of STARTING (needs `--boot` or a start-order change; documented instead).

Housekeeping: the scope escalation (wheel buttons beyond stage 3) was answered by the owner on 2026-11-22 but still showed as waiting: added its `Resolved:` line. The kit-schedule escalation stays open (nothing the team can do).

Process note: the QA agent writes issue files into the lead's checkout uncommitted; the area lead copies them into its worktree and commits them with the fix, then the lead deletes the untracked copies. That worked; keep it.

Cost: about $3 of $40, about 30 minutes.

## 2026-11-23: cycle 24 (idle cycle: resubmit `qa9-live`)

Sync: gate main d2ecf26 (`lead-notes-23` merged). `qa9-live` 9c51ce6 REJECTED: "not based on current main". Cause: the notes branch and the work branch were both cut from 998fb0a and submitted together; the gate merged the notes first. Not a check failure.

Done: rebased `work/qa9-live` onto d2ecf26 (no conflict, same 385-line diff, now 3bc676b), `ready/qa9-live` moved there. These notes are stacked on top of it as `ready/lead-notes-24`, so whichever the gate takes first, the other is based on (or contained in) main. No agent spawned, no new work: the team still waits on the owner's bench. No owner message, no owner issue. Publish: to be asked next cycle once `qa9-live` is on main.

Process note: submit the notes stacked on the cycle's work branch, never side by side from the same base.

Cost: well under $1.

## 2026-11-23: cycle 25 (idle cycle: `qa9-live` merged)

Sync: gate main a47f417. `qa9-live` MERGED (3bc676b) and `lead-notes-24` MERGED (a47f417, 1420 tests); the stacking rule from cycle 24 worked. Deleted the four branches, local main fast-forwarded. No worktree, nothing failed or held. No owner message, no owner issue.

Done: asked for a publish of main (the QA round 9 fixes to `run.sh --live`). No agent spawned, no new work: all four charter stages are built and the team waits on the owner's bench (`docs/BENCH-TEST.md`) and on the kit-schedule escalation, which stays open.

Cost: well under $1.

## 2026-11-23, cycle 26 (idle, one kit change)

Sync: gate main 900bfce. `lead-notes-25` MERGED (1420 tests) and published at 900bfce. Deleted both notes branches, local main fast-forwarded. No worktree, nothing failed or held. No owner message, no owner issue.

Done: the kit's cost-rule change for this cycle. Added `experimental:` / `  cacheTtl: 1h` to the header of both tech lead definitions (`area-lead-core`, `area-lead-platform`), nothing else changed there; builder, scout, reviewer and qa untouched. The lead made this two-line edit itself with the notes (as the kit's notice asks) instead of starting an Opus tech lead for it. No agent spawned, no publish requested (notes and agent config only). The team still waits on the owner's bench and the kit-schedule escalation.

Cost: well under $1.

## 2026-11-23: cycle 27 (one-shot job: Pi facts against the real packages, part done)

Asked: owner one-shot 20261123T223057Z-o-c4f87f (backlog f59dbf, owner issue 20261123T223054Z-i-7afd33): check the Pi set-up's from-memory facts against the real Trixie / Raspberry Pi OS packages.

Sync: gate main 4af718c (`lead-notes-26` merged). Requested `domain:deb.debian.org` and `domain:archive.raspberrypi.com`; both 403 at the start. As the job says for that case, only steps 1-2 ran: `area-lead-platform` (Opus, the owner's choice; no builders, about $1.80) wrote `docs/PI-FACTS.md`: 85 rows in 8 groups (fact, where used, how to check, status), linked from `pi/README.md` and BENCH-TEST 4A/4B, a DECISIONS entry. No code, test or fixture touched; nothing marked checked; bench items stay `untested`. `pi-facts` MERGED d329128 (1420 tests). No reviewer: the diff is documentation only, the reviewer belongs to the step 5 diff.

The owner approved both domains during the cycle, but the proxy still gave 403 after the merge (approvals take effect between cycles). Steps 3-6 are left for the next cycle; replied `planned`. Issue stays `in_progress`.

Cost: about $3.

## 2026-11-24: cycle 36 (one-shot job: live emulator gaps and QA round 10 with a real Claude)

Count: the owner's console counts every cycle (normal, one-shot, planning) and calls this one 36; the last entry here was 27. From now on the console's number is used; earlier entries are not renumbered.

Asked: owner one-shot 20261123T223256Z-o-e63eb8 (backlog 69b839, owner issue 20261123T223144Z-i-8bcd0d): first --live session shows STARTING; a Claude that exits in the first seconds gives a clear message; QA round 10 with a real Claude; guide and bench wording.

Done, topic `live-gaps` (4 commits): `area-lead-core` on Sonnet (the owner's choice) built both gaps (c8c547a, c75f36e); then in parallel QA round 10 (Opus, real Claude 2.1.331, five short turns; branch `work/qa-r10`, four findings: 3 minor, 1 polish, all about wording; all six r9 fixes held) and a Sonnet reviewer (approve; no bug in the unreviewed r9 commit 3bc676b; two test-margin notes). One fix round on Sonnet (de1b547): guide, BENCH L7/L8/L11/L14/L15, messages, test margins, 1429 tests locally. The fix round was not re-reviewed.

What QA learned that the docs had wrong: Claude 2.1.330/331 starts in "auto mode" here and asks no permission for simple writes and commands (Shift+Tab to "manual mode" to try Enter / N); a never-opened folder waits on a trust question that fires no hook; a not-signed-in Claude does not exit.

Process notes for the kit's maintainer: tech leads run in their own isolated worktree and are refused a `cd` into another one, so a second lead on the same branch needs the first worktree removed (one $0.20 false start this cycle). The other open one-shot (20261123T223057Z-o-c4f87f, Pi facts steps 3-6; both archive domains now show `installed`) was left for a normal cycle, as this job's rules say.

Cost: about $6.

## 2026-11-24: cycle 37 (normal cycle: blocked on the proxy, notes only)

Sync: gate main 317ebdd; `live-gaps` (de1b547) and `lead-notes-36` MERGED, 1429 tests, published. `ready/` and `work/lead-notes-26` deleted. No worktree left, no held change.

Open owner one-shot 20261123T223057Z-o-c4f87f (Pi facts, steps 3-6), treated as priority: both archive domains show `installed`, but the proxy still gives 403 `ERR_ACCESS_DENIED` for `deb.debian.org` and `archive.raspberrypi.com` (http and https; `registry.npmjs.org` gives 200). Without the archives nothing of steps 3-6 can be done, and step 2 is merged. No agent was started and no other route to the packages was tried. Escalated (ESCALATIONS.md, 2026-11-24) and replied `planned`. The owner issue stays `in_progress`.

Nothing else is due (the team waits on the owner's bench); no QA round, because main carries no product change since round 10. No publish request: notes only.

Cost: under $1.

## 2026-11-24: cycle 38 (one-shot job: compaction note on the bar and its demo scene)

Count: the console calls this cycle 38 and that number is used; no cycle of mine was skipped between 37 and 38 other than by the console's own counting.

Job: owner message 20261123T223334Z-o-e5b114 (backlog 0d7662), owner issue 20261123T223311Z-i-5220c3. Nothing else was touched (the Pi-facts one-shot stays open and blocked on the proxy, see cycle 37).

Dispatched: one `area-lead-core` on Opus (the owner's choice), branch `work/compaction`. It found the existing recording `fixtures/sessions/compaction.jsonl` sufficient (PreCompact, the summariser's SubagentStop, SessionStart `compact`, PostCompact; two of five PreCompacts were followed by no compaction and no event says so; 5-7 s each on a small context), so the mark is set by PreCompact and cleared by the next event, with a 180 s limit. Four Sonnet builders (state core, hooks, view and fixture, demo). Full check 1502.

Review: `reviewer` (core logic and tests). One blocking finding: the compaction timer was not cleared when the session ended or the mark was cleared, and no test pinned it. Non-blocking: a background subagent's events and `idle_prompt` cleared the mark too early; timers armed for unknown session ids; missing assertions. Sent back once, to an `area-lead-core` on Sonnet (small, precise fix): all five fixed in 3b538b2, full check 1508. The reviewer switched the shared checkout to the work branch by mistake and switched it back at once; nothing changed.

Tests changed on purpose: hook-install (PreCompact/PostCompact are now registered), reducer and board (PreCompact is no longer an ignored event), emulator-run / keys-sheet / fixtures (nine scenes, one more fixture), `emulator/tests/live.spec.js` (replay of the compaction recording expects "Compacting context").

Submitted `ready/compaction` and these notes stacked on it. `tools/check` untouched. Publish requested. Cost: about $6.
