# JOURNAL

Entries before cycle 36: `JOURNAL-archive.md`.

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

## 2026-11-24: cycle 39 (one-shot job: Pi appliance leftovers)

Job: owner message 20261123T223454Z-o-4fabf3 (backlog f95192), owner issue 20261123T223444Z-i-1979f8. Nothing else was touched: the Pi-facts one-shot and the owner's note that the proxy is fixed (20261124T021916Z-o-575c89) wait for a normal cycle; leftover branches of cycle 37 were left alone.

Dispatched: one `area-lead-core` on Sonnet (the owner's choice), branch `work/pi-leftovers`: `pi/data.mjs` exit codes (535adb7), the three-way key map merge (f4460ba), the session-end reason (6238651). Full check 1542.

Review: `reviewer` (installer, core state, tests). Sent back: a flaky real-tmux test (the pane's exit status read too early and then lost), two reaps at once reporting one session twice, the merge dropping an owner key named `__proto__` and upstream keys named like inherited ones (`constructor`), a wrong README row; five smaller points. Fix round by the same lead (f603235, 1553). Re-review: approve, three small points (no timeout on tmux commands behind the new reap queue, `statSync` following a symlink among the backups, the status test loosened). Because that was the second send-back of a Sonnet lead, the last round went to an Opus lead as the cost rule says (66fff51, 1559): tmux commands time out after 5 s; backups use `lstat`; the lost status turned out to be tmux 3.4 missing the child's exit signal (4 of 12 parallel probes, never recovered by waiting), cured by `run-shell true`, so the real-tmux test is strict again (56 of 56 parallel runs). 66fff51 was not re-reviewed.

Tests changed on purpose: `pi-data.test.js` (refusals now exit 4), `pi-install.test.js` (an edited key map is merged silently, base recorded), `sessions-runner.test.js` (new tmux argv).

Submitted `ready/pi-leftovers` and these notes stacked on it. `tools/check` untouched. Cost: about $8.

Gate: `pi-leftovers` (66fff51) and `lead-notes-39` MERGED, 1559 tests; branches deleted; owner issue set done, owner message replied done, publish requested. Follow-up note: `lead-notes-39b`.

## 2026-11-24: cycle 40 (one-shot job: throttling and temperature mark)

Job: owner message 20261123T223540Z-o-a0625e (backlog cf4ad5), owner issue 20261123T223531Z-i-5c9049. Nothing else was touched: the Pi-facts one-shot and the owner's note that the proxy is fixed (20261124T021916Z-o-575c89) still wait for a normal cycle. Not too early: all four charter stages are built, so the job was done as proposed.

Dispatched: one `area-lead-core` on Sonnet (the owner's choice), branch `work/thermal`, four commits (server monitor, state and view, pi and docs, emulator), four Sonnet builders. Full check 1650. It also fixed a view bug the new worst case showed (the file name was fitted before `#session` took room in row A).

Review: `reviewer` on Sonnet (core state, installer, tests): approve, no blocking finding. Five smaller points sent back once to an `area-lead-core` on Sonnet and fixed in 4f761d2 (full check 1651): a hung `vcgencmd` could stop polling and leave a mark lit (now SIGKILL, a 4 s limit on each read, no second read while one is stuck); bit 1 (frequency capped) no longer means HOT, since under-voltage sets it too (from memory); two fixed 50 ms sleeps in a test replaced by a bounded wait; the installer adds the user to `video` so `vcgencmd` can open `/dev/vcio` (from memory); the docs say the marks can be absent in the fullest band.

Kit note (nothing for the owner): an area lead now starts in its own worktree and cannot enter another agent's, so the first fix agent returned without doing anything; I removed the first lead's clean worktree and started the fix again with "check out the branch in your own worktree". Brief future fix rounds that way.

Tests changed on purpose: `board.test.js` (two more keys), `emulator-fixtures.test.js` (a flag map per fixture), `pi-install.test.js` (`--netmon --thermal`, groups `input,audio,video`), `pi-setup.test.js`; regenerated expected files add only `hot:false` / `lowPower:false`.

Submitted `ready/thermal` and these notes stacked on it. `tools/check` untouched. Cost: about $4.

Gate: `thermal` (4f761d2) and `lead-notes-40` MERGED, 1651 tests; branches deleted; owner issue set done, owner message replied done, publish requested. Follow-up note: `lead-notes-40b`.

After the merge: `lead-notes-40b` (docs only) FAILED at the gate on the new server test in `tests/unit/thermal.test.js`: it waited for "one pending timer", which is also true mid-tick when one read is done and the other read's 4 s timeout is still armed, so the test sometimes fired the timeout instead of the poll (30 failures in 100 runs under CPU load). Test bug only; fixed on `work/thermal-flake` 3223da3 (the fake timers tell poll timers from read timeouts; 200 of 200 under load; full check 1651) by an `area-lead-core` on Sonnet, submitted as `ready/thermal-flake` with these notes stacked on it. Lesson: the review-round fix to "deterministic waits" was not proven under load before it merged; ask for a looped run under load whenever a test waits on timers.

## 2026-11-24: cycle 41 (one-shot job: shorter STATE notes, history archived)

Job: owner message 20261123T223608Z-o-561360 (backlog d2cf1f), owner issue 20261123T223553Z-i-5b1cf2. Nothing else was touched: the Pi-facts job and the owner's proxy note still wait for a normal cycle.

Count: the owner's console counts this as cycle 41 (normal cycles, one-shot jobs and planning cycles); that number is used from now on. Earlier entries are not renumbered.

Done by one `area-lead-platform` on Sonnet (the owner's choice), branch `work/notes-trim`: old STATE.md moved whole and unchanged to `HISTORY.md`; STATE.md rewritten to one page (status per charter stage, unproven, leftovers, in flight, next, standing rules); journal entries before cycle 36 moved unchanged to `JOURNAL-archive.md`. Checked mechanically: every line of the old STATE.md is in HISTORY.md and every line of the old JOURNAL.md is in JOURNAL.md or JOURNAL-archive.md. No reviewer (notes only). Submitted as `ready/notes-trim`.

Sizes: STATE.md 46614 -> 6158 bytes; JOURNAL.md 70802 -> about 10900 bytes.

## 2026-11-24: cycle 42 (Pi facts checked against the real packages)

Proxy retest: `http://deb.debian.org/debian/dists/trixie/Release` 200, `http://archive.raspberrypi.com/debian/dists/trixie/Release` 200, https 200 for both (one first request to `http://archive.raspberrypi.com/` timed out, the repeat gave 200). Escalation of 2026-11-24 marked resolved; owner note 20261124T021916Z-o-575c89 answered `done`. Leftover merged branches of cycles 36-41 deleted.

Job: owner message 20261123T223057Z-o-c4f87f (backlog f59dbf), owner issue 20261123T223054Z-i-7afd33, steps 3-6. One `area-lead-platform` on Opus (the owner's choice), three Sonnet builders, branch `work/pi-facts-check` (5391458, 69256dc, 903f804), full check 1656 (main 1651). Indexes verified against the `Release` checksums; about 32 packages unpacked under `/tmp/pfc-deb-*`, nothing installed or run. The Pi archive has no `Packages.xz` and no `binary-all`.

Result: 93 rows (not 85): 61 checked (names/layout only), 9 fixed, 23 still from memory. Wrong and fixed:
- O02/O05 (the dangerous ones): `raspi-config nonint do_overlayfs 0` already calls `enable_bootro` itself, so our second call wrote `defaults,ro,ro` and one `disable_bootro` left the boot partition read-only; it also runs `apt-get install overlayroot` (needs a network, rebuilds the initramfs). Now `install.sh` installs overlayroot at set-up, `readonly.sh enable` refuses without it and calls `enable_bootro` only when fstab has no `ro`, `disable` repeats `disable_bootro` up to 3 times.
- O03: `overlayroot=tmpfs` is prepended to cmdline.txt (stubs only).
- L06/L08: the Pi session runs `labwc -m`, so our autostart is merged after the system one (desktop, panel, kanshi still start under the kiosk). Kept, written in DECISIONS; bench P4-P6 look for it.
- L04: the raspi-config menu is System Options, S5 Boot, B4 Desktop Autologin. L03: lightdm.conf fixture follows the real file.
- C05: `--disable-session-crashed-bubble` is not a string in Chromium 156 (Pi build); removed from `kiosk.sh`.
- X08: `vcgencmd` is in `raspi-utils-core` and uses `/dev/vcio_gencmd` (comment and README).
Confirmed: `chromium` (no `chromium-browser` binary), `apt install cryptsetup` pulls `cryptsetup-bin`, `autologin-user=` in `[Seat:*]`, `/var/lib/systemd/linger`, `sox` provides `rec`, Trixie nodejs is 20.19.2 (NodeSource still needed).

Tests changed on purpose (each held a wrong fact): `pi-readonly.test.js` (only `do_overlayfs 0`, one `ro`; stub behaves like the real raspi-config; 6 tests added), `pi-install.test.js` (overlayroot at the front), `pi-setup.test.js` ("runs after", S5/B4 hint), `pi-kiosk.test.js` (the flag is asserted absent).

Review: `reviewer` on Sonnet: approve, no blocking finding; it read `readonly.sh` against the unpacked raspi-config and confirmed `labwc -m`. It doubted C05 (it thought both strings were in the binary); I counted them myself: `disable-session-crashed-bubble` 0, `hide-crash-restore-bubble` 1, so the removal stands. It first ran the tests on main by mistake, then on the branch (236 pass). Three small points left in STATE "Next".

Submitted `ready/pi-facts-check` and these notes stacked on it (`ready/lead-notes-42`). `tools/check` untouched. Publish requested. Every bench item stays `untested`. Cost: about $7.

Gate: `pi-facts-check` (903f804) and `lead-notes-42` MERGED, main c59bf47, 1656 tests; branches deleted; owner issue set done, owner message replied done, publish requested. Nothing is left that is worth a cycle without the owner's bench: `owner-focus blocked` said. Follow-up note: `lead-notes-42b`. Kit note: `owner-issues update <id> done` reads a note from stdin and hangs without one.

## 2026-11-24: cycle 47 (owner issues #22, #23, #26)

Count: the console calls this cycle 47 (43-46 were planning and other console cycles with no journal entry here). Earlier entries are not renumbered.

Three approved backlog items taken, run in parallel, each on its own branch from main, then stacked.

- #22 push-to-talk while a permission prompt is open (`area-lead-core`, Opus, `work/ptt-prompt`). Recorded with real Claude Code 2.1.331 in tmux (`fixtures/buttons`, section f): one Space on the dialog with "1. Yes" highlighted did nothing, both while the hook waited and after its 5 s timeout. Not tried: another option highlighted, Space held, other versions. The owner's rule was kept anyway: while the selected session has a pending prompt, a tap sends no key and the bar says "Answer the prompt first". 7 new tests; two existing tests in `sessions-actions.test.js` now start from a working board (the default board has a prompt), assertions unchanged. Bench item PP-1, `untested`.
- #23 trust boundary (`area-lead-core`, Sonnet, `work/trust-boundary`). DECISIONS and `src/server/README.md` say it: same-user processes are trusted, web pages and accidents are defended. Under `--netmon` a posted `RevviewNetwork` only makes the monitor probe again; without `--netmon` outside the dev bridge it is 403 (not asked for, mirrors `RevviewDataLock`; kept). 4 new tests, 100 of 100 under CPU load. DECISIONS got an index (43 lines) and three "superseded" pointers; nothing deleted. STATE: the `targetOf` leftover was already fixed (board.js 80-86); the `SessionEnd` leftover is no longer true for an owned id (`stillOwned`, board.js 555-559) and what remains is accepted forgery.
- #26 test names (`area-lead-platform`, Sonnet, `work/test-names`). 16 files renamed (not 15), no test body changed, table old to new in `tests/unit/README.md`. 79 test files before and after.

Stacking: a Sonnet `area-lead-platform` cherry-picked the three into one line (`work/stack-47b`), resolved the one conflict (both appended to DECISIONS) and added the index line. Full check at the tip: 1667 (1656 + 7 + 4), all 57 screenshots identical to the gate's set for main.

Review: one `reviewer` on Sonnet for #22 and #23: approve both, nothing blocking. Left for later (in STATE): the new note has no auto-clear (goes into #24); pokes can shorten the offline debounce during a real outage; two small test gaps.

Submitted `ready/ptt-prompt`, `ready/trust-boundary`, `ready/test-names`, `ready/lead-notes-47`. `tools/check` untouched. Next cycle: #24 (typed notes) alone, then #25. Cost: about $5.

Gate: `ptt-prompt`, `trust-boundary`, `test-names` and `lead-notes-47` MERGED, main aac0207, 1667 tests; branches deleted; owner issues #22, #23, #26 set done; publish requested. Follow-up note: `lead-notes-47b`.

## 2026-11-24: cycle 48 (owner issue #24: board notes get a kind)

Sync: cycle 47's follow-up note merged (main 406d255, 1667 tests, published). Owner issue #26 still showed `new` although cycle 47 set it done; set done again with commit aac0207. Backlog a926ba taken, issue #24 set in progress.

One `area-lead-core` on Opus (as the proposal said), branch `work/note-kinds`. Inside `src/state/board.js` the note is `{ kind, text }` (kinds: plain, too-early, starting-ptt, answer-prompt, ended, ended-last; table in the code); every rule goes by kind. The view still gives `note` as a string. `actions.js` and the server's `bootDone` pass a kind; `RevviewNote` and `RevviewBootDone` take an optional kind (none means plain), and `RevviewNote` refuses the ended kinds. Second commit: the "Answer the prompt first" note clears when the selected session has no pending prompt left (the cycle 47 leftover). The "launch" and "compacting" kinds of the proposal were not needed by any rule and were not added.

Review: `reviewer` on Sonnet: approve, nothing blocking, two points sent back once (to an `area-lead-core` on Sonnet, commit cc799ee): (1) a missed rule: the boot note "No session yet: open the menu for New session" was hidden while the data is locked on main and showed on the branch; it now has its own kind `no-session` (hidden while locked, otherwise as on main); (2) tests that pin the new input checks (ended kinds and malformed kinds refused, unknown kind at boot drops the note, the server passes `ended` only when the key-on Claude is gone). This is exactly the risk the proposal named; the reviewer found it, not the tests.

Changes of behaviour, on purpose: a plain note whose text ends in " ended" is not an ended note; a plain note ending in ": open the menu for New session" is not hidden while locked; the answer-prompt note clears itself.

Tests: 1676 (main 1667; 9 new). Adapted with unchanged expectations: tests that read the raw board's note now read `.note?.text`, and events in `board-ended-notes`, `board-missing-projects`, `sessions-actions` carry `kind`. No expected fixture file changed. All 57 screenshots byte-identical to the gate's set for 406d255 (compared by the lead with `cmp`, both rounds). Loops under CPU load: 50 of 50 (350 tests each: board, sessions, server, emulator-looks) on the first round, 30 of 30 board tests after the fix.

Submitted `ready/note-kinds` and these notes stacked on it (`ready/lead-notes-48`). `tools/check` untouched. Next cycle: #25 (split the server file) after this has merged. Cost: about $4.

Gate: `note-kinds` (cc799ee) and `lead-notes-48` MERGED, main 198a55f, 1676 tests; branches and worktrees deleted; owner issue #24 set done; publish requested. No open owner issue is left; the approved backlog item f9c0be (server split) is next. Follow-up note: `lead-notes-48b`.

Gate: `note-kinds` and `lead-notes-48` MERGED, main 198a55f, 1676 tests; issue #24 set done; follow-up note `lead-notes-48b` merged (main 0d9d762, published).

## 2026-11-24: cycle 49 (split the server file, backlog f9c0be)

Sync: main 0d9d762, 1676 tests, published; merged note branches deleted. No open owner message or issue; the split was taken as a normal-cycle backlog item (`owner-backlog taken`), as cycle 48 planned.

One `area-lead-core` on Opus (as the proposal said), branch `work/server-split`, four commits. `src/server/index.js` (930 lines) is now 12 modules: `index.js` (23, re-exports the same 14 names and still runs as the program), `cli.js` 180, `boot.js` 89, `live.js` 168 (`startLiveServer`, same signature and options), `feed.js`, `http.js`, `routes-event.js`, `routes-permission.js`, `routes-dev.js`, `gestures.js`, `lifecycle.js` 117, `monitors.js`. Closure variables became fields of one per-server `ctx`. Largest file 180 lines. `datalock.js`, `netmon.js`, `thermal.js` untouched. A builder had wrapped the owned poll in an extra async helper (one more microtask before the server resolves); the area lead put it back inline.

Proof: no test file changed; full check 1676; all 57 screenshots byte-identical to the gate's set for 0d9d762 (`cmp`, by the area lead); 24 server-starting test files looped 50 of 50 with one busy loop per core.

Review: `reviewer` (Opus, large diff): approve, nothing blocking. It read the old closure against the new modules: same start order, same `close()` order, no added await, no field read too early, no module-level state, same defaults, status codes and log text; 236 server tests pass on the branch; the program still starts and refuses an unknown option with exit 2. Two small points and four old oddities found by the area lead are in STATE "Next" (not fixed: the job was a pure move).

Submitted `ready/server-split` and these notes stacked on it (`ready/lead-notes-49`). `tools/check` untouched. After this nothing is planned without the owner's bench. Cost: about $4.

Gate: `server-split` (431a162) and `lead-notes-49` MERGED, main 0696a05, 1676 tests.

## 2026-11-24: cycle 50 (idle: sync and notes)

Sync: cycle 49's branches merged and deleted (ready/ and work/ for server-split and lead-notes-49); no worktree left. No open owner message, issue or escalation to act on; every approved backlog item is done or taken. No agent was started. Publish requested for main 0696a05 (the server file split, no change of behaviour). Nothing is left that is worth a cycle without the owner's bench (`docs/BENCH-TEST.md`): `owner-focus blocked` said. Note: `lead-notes-50`.

## 2026-11-25: cycle 52 (idle: sync and a last idle note)

Cycle count: the owner's console calls this cycle 52; the last entry here is cycle 50 (no cycle 51 of this team left a note; the console also counts one-shots and planning cycles). The console's number is used from now on; earlier entries keep theirs.

Sync: `lead-notes-50` MERGED (main 0b0329f, 1676 tests), published 2026-11-24T19:45Z, nothing ahead. No ready or work branch, no worktree, no open owner message, owner issue or held change; every approved backlog item is done or taken. No agent was started. The team still waits for the owner's bench (`docs/BENCH-TEST.md`).

Decision: from now on an idle cycle in which nothing changed writes no note and submits nothing, so that idle cycles cost no gate run and no publish. STATE "In flight" says "nothing" and stays true until work starts. Note: `lead-notes-52`.

## 2026-11-25: cycle 59 (questions and plans on the bar, the Pi scripts against the real packages, the long drive)

Cycle count: the console calls this cycle 59; the last entry here is cycle 52. Cycles 53 to 58 were idle or the owner's planning cycles and wrote no note (the cycle 52 rule).

Sync: main 7f9dc13, 1676 tests, nothing in flight. The owner approved eight new backlog items as planned issues #27 to #34 and put the team in focus. Taken this cycle (`owner-backlog taken`, issues set `in_progress`): #27, #32, #33, chosen because they do not touch the same files. #28 depends on #27; #29, #30, #31 all change the bar or the settings menu and follow. #34 is a future goal by the owner's own text and is not taken (idea written in STATE "Next").

#27 questions and plans 1 (`area-lead-core`, Opus; `work/questions-1`, 6 commits). Recorded with Claude Code 2.1.331: AskUserQuestion and ExitPlanMode each fire PreToolUse, a PermissionRequest (full questions, options, the plan as markdown) and a notification, in every permission mode; the answer comes as the call's PostToolUse; Esc fires nothing. New state `asking` (CLAUDE ASKS, lime band, speech-bubble shape): the first question, up to four numbered options, "+N more", "1 of N", "pick any"; for a plan the title, step count and "Approve in the terminal when parked". It ranks and clears like a permission prompt; press and deny under it do nothing (on main a press would have allowed the call with no answer). Read aloud reads the question and options. Three new screenshots (asking, asking-plan, asking-long), demo scene 10 (key 0), bench QP-1 to QP-5. Full check on the first round: 1768.
Review (`reviewer`, Opus): changes needed. Sent back once (`area-lead-core`, Sonnet, commit e73d7bb): (1) blocking: the question was never read out by itself in the real server, because `/permission` did not call the read-aloud hook (the tests called it directly); fixed with server-level tests; (2) the `#file` check in `live.spec.js` had become weaker for cut paths; now a cut must be a real cut of the path or its basename; (3) not recorded whether the terminal picker shows while our hook holds the request: tried with the real hook and server (`--live`): it does, for a question and a plan, so the hold stays (part 2 answers through the picker); (4) the question's type size is clamped at 4.0 mm in code.

#32 the Pi scripts against the real packages (`area-lead-platform`, Opus; `work/pi-real-tree`, 5 commits). `pi/tree/build.sh` unpacks 43 pinned Trixie arm64 packages (hashes checked against InRelease; the signature itself is not checked: no key here); `pi/tree/check.sh` runs install.sh, readonly.sh and kiosk.sh against a copy: 137 ok, 0 DIFF, 30 NOTE. A names fixture and `pi-real-tree.test.js` keep the gate check offline. Found and fixed: `journalctl --user -u revview` would show nothing on Pi OS (volatile journal): now `sudo journalctl --user-unit=revview`; `overlayroot=disabled` or empty counted as on; raspi-config removes `overlayroot=tmpfs` only when a space follows and `defaults,ro` only in that exact form, and `enable_bootro` does nothing without `defaults`: `enable` and `disable` now say so at once. PI-FACTS: one row from memory fixed, E11 checked, 6 new rows; 22 stay from memory. BENCH-TEST has a table of what the packages back and what stays Pi-only; everything stays `untested`. Review (`reviewer`, Sonnet): changes needed; sent back once (Sonnet, 01a07cf): the merge step swallowed every tar error (`|| true`); member names are now checked for absolute and `..` paths; the header no longer over-claims; DECISIONS entry. No ARM program was run; nothing is claimed for the Pi.

#33 the long drive (`area-lead-platform`, Sonnet; `work/long-drive`, 2 commits). `tools/long-drive` (out of the gate): 240 simulated minutes in 481 s (30x), 7805 events, 420 sessions, 8 disturbances (stream reset, kill -9, SIGTERM, 25 s network loss, clock +6 h and -2 h); 17 of 17 comparisons of page against server passed. Measured: server RSS 69.0 to 71.0 MB with no trend, JS heap after GC 1268 to 1475 kB (27 kB over the last 3.5 hours), DOM 41 to 42 nodes. No bug found, no issue filed. Limits written in `docs/LONG-DRIVE.md`; bench LD-1 to LD-6. Found by the lead afterwards: two servers of interrupted development runs were still alive 48 minutes later. Sent back once (2ee7b51): the tool now stops its server and Chromium on every way out, with a run-on-request self-check (`tests/long/cleanup.test.js`).

Two side effects, cleaned by the lead: the live trial of the #27 fix round used `/model haiku`, which wrote `"model": "haiku"` into `~/.claude/settings.json` (the team's own user settings); the key was removed again (the file is as before: `cleanupPeriodDays`, `theme`). The two leftover servers were stopped. Rules added to STATE.

Submitted as one stack (conflicts only where two branches appended to `docs/DECISIONS.md` and `docs/BENCH-TEST.md`; both texts kept): `ready/questions-1`, `ready/pi-real-tree`, `ready/long-drive`, `ready/lead-notes-59`. The stack as a whole was not run here; the gate's full check is that run. `tools/check` untouched. Cost of the cycle: about $19.

## 2026-11-25/26: cycle 60 (answering questions from the wheel, sound cues, the long drive fixed; QA r11 and its fix round)

Sync: `questions-1` and `pi-real-tree` MERGED (main 32abd00, 1795 tests); owner issues #27 and #32 set done. `long-drive` and `lead-notes-59` FAILED at the gate, step unit: `tests/unit/long-replay.test.js` counted 6 recordings and #27, merged just before, had made them 10. The cycle 59 notes therefore reached main only with this cycle's notes (the entry above is unchanged).

Taken (`owner-backlog taken`, issues `in_progress`): #28 (4f82c1) and #31 (c7f235), in parallel; #33 as a fix round.

- #33 fix (`area-lead-platform`, "Redo on Opus" by the cost rule, the first lead was Sonnet; 59191b8). The test now counts the fixture directory. The drive itself gave 3 false failed comparisons with the new recordings (no label for `asking`; a cut file path compared with the full one): fixed, and the full drive run again: 240 simulated min in 480 s, 7889 events, 414 sessions, 10 recordings, 0 of 17 comparisons failed; heap after GC 1271 to 1529 kB (1485 after the first 30 min); server RSS 69.2 to 74.0 MB (the last server two samples only, not called a trend).
- #28 questions and plans 2 (`area-lead-core`, Opus; 6 commits). Recorded with Claude Code 2.1.332: a hook answer with the exact option label answers a question; a hook allow does NOT approve a plan, the key `2` ("Yes, manually approve edits") does; a hook deny keeps planning; Esc ends the held hook at once. Decision (differs from the proposal, DECISIONS "Questions and plans 2"): a question is answered through the held hook request, never by keys; a plan gets the key `2` only after the tmux pane shows the three dialog lines and the request is still held. Up/down move a highlighted choice. Refused with a note: question changed, not waiting any more, too early (1.5 s), not an owned session, several questions / multi-select / an option the bar could not show ("Answer in the terminal when parked"), plan not on the pane. Live trial by the lead under `--live` with haiku: answered, denied, plan kept and approved. Its own reviewer found a blocking bug (a blank label shifted positions), fixed. Alone: 1861 tests.
- #31 sounds (`area-lead-core`, Opus; 4 commits). `src/sounds/`: four generated WAV files (needs, done, failed, other), committed, byte-equal to the generator; a cue on a session's change into needs-you (permission or CLAUDE ASKS) / done (Stop, no subagents) / failed (StopFailure); none for waiting-for-me; other sessions the soft cue; queue of one; cue before speech. `sounds` in `config/speech.json`: off / cues / speech, default cues; `speakOnStop: true` means cues and speech. Settings row on the bar (not kept over a restart). Player `aplay` checked against the alsa-utils package only; nothing was heard here. Review (`reviewer`, Sonnet): approve.
- Stack (`area-lead-platform`, Sonnet): long-drive, questions-2, sounds in one line; conflicts only in `src/state/index.js` and appended docs. Added: a test that one question gives one cue; the flaky `emulator-live` test now waits for the line it asserts on (20 of 20 under load). Full check at the tip 1930; screenshots: 2 new (asking-choice, asking-terminal), 4 changed as intended (asking, asking-plan, asking-long, wb4-settings).

Gate: `long-drive` (1801), `questions-2` (1867), `sounds` (main e2ec885, 1930 tests) MERGED. Issues #33, #28, #31 set done.

QA r11 (`qa`, on e2ec885; emulator, a stand-in player, and a real haiku session): the features work as documented; six findings, none blocking (files `docs/agents/issues/qa-20261126-r11-*`). QA ran out of turns before reporting and was resumed once.

Fix round (`area-lead-core`, Sonnet; `work/ask-fixes`, 4 commits; `reviewer` Sonnet: approve): r11-01 the view measured a hidden `#lower` after a menu or list closed (hint row lost, small type): `render()` unhides first; r11-02 a held question that ends unanswered now leaves the bar through the internal event `RevviewAskGone` (hook connection closed = Esc: silent; our 540 s timeout: note "Question left for the terminal", kind `left`), so push-to-talk is no longer locked out; r11-03, -05, -06 (note not doubled, "Deny cancels", refusal notes bold white, guide, `run.sh` shows the `sounds:` line). Full check 1944; 2 screenshots change (asking-terminal, asking-long: the longer hint). r11-04 (up/down against two columns) asked of the owner (`ask-updown-order`), default: keep.

Submitted: `ready/ask-fixes`, `ready/lead-notes-60`. `tools/check` untouched. Publish requested. Next: #29, then #30. #34 stays a future goal. Cost of the cycle: about $22.
