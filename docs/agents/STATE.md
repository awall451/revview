# STATE

Updated 2026-11-22 (cycle 6).

## Roadmap (the charter's four stages)

1. The glance view: state core + static page + 1280x400 emulator, screenshots per state.
2. Hook wiring: Claude Code settings and hook scripts feeding the view; optional spoken summary on Stop.
3. Push-to-talk input: button to Claude Code's push-to-talk key.
4. The Pi image: kiosk boot, rotation, quiet boot, power-cut behaviour (documented, cannot run here).

## First jobs, in order

1. DONE (merged 2026-11-21, gate main f2bca35): stack + skeleton.
2. SUBMITTED, waiting for the owner's approval: the real `tools/check`, `ready/real-check` (branch `work/real-check`, one commit, only `tools/check`). See In flight.
3. DONE (merged 2026-11-21, gate main 64dfbbf): emulator of the 1280x400 7.9" panel, one screenshot per state.
4. Product: in progress (milestone 1).

## Milestone 1: glance view in the emulator

- DONE: state core `src/state/` (reducer; since cycle 6 a per-session board `src/state/board.js`), recorded sessions in `fixtures/sessions/`.
- DONE: emulator at physical size (`emulator/`), per-state fixtures `emulator/fixtures/*.json`.
- DONE: the view `src/view/`, live server `src/server/` (`npm start`, 127.0.0.1:8138, POST /event -> SSE).
- DONE (merged 2026-11-22, gate main 0f38005, topic `qa-round-1`): all 14 QA round 1 issues. New looks UNKNOWN (fresh or restarted server), CLAUDE EXITED (last session ended), NO LINK (drawn by the page when the server link is down, also before the first message); STARTING only after `RevviewStarting`; state per `session_id` with a `+N` hint; `src/view/boot.html` (the page the kiosk must open from `file://`, see DECISIONS "Honest states"); late events after Stop; oversized diff events show `≥ +N −N`; detail line polish. Counts under the held check: 320 = 1 seed + 157 unit + 162 Playwright, 22 screenshots.
- OPEN: QA round 2 (on 0f38005) filed 15 issues, 2 major (below). Milestone 1 is finished when the two majors and the minors that mislead a driver are fixed and a QA round finds no major.
- Screenshots per state are written by `tests/emulator.sh` to `out/shots/` (or `$REVVIEW_SHOTS_DIR`). They do NOT reach the owner's gallery until `real-check` merges.

## In flight

- `ready/real-check` (only `tools/check`): needs the owner's approval of its exact commit. IMPORTANT, learned in cycle 6: every merge to main makes the gate REJECT this branch ("not based on current main"), which voids the pending approval request. So: do all other merges of a cycle first, and as the LAST act of the cycle rebase `work/real-check` onto the final gate/main (`git rebase gate/main`; check `git diff <old> <new> -- tools/check` is empty), `git branch -f ready/real-check work/real-check`, and explain again with `owner-gate explain real-check`. Cycle 6 did this after its notes merged (see `gate-status real-check` for the current sha and verdict). In a cycle that merges nothing, do not touch it. When `gate-status` shows it merged: delete `ready/real-check` and `work/real-check`, set owner issue 20261121T174905Z-i-49aed7 to done, reply `done` to owner message 20261121T174915Z-o-4e2539, mark first job 2 DONE here, then do follow-up (d). If it shows `failed` (declined), read the owner's reason first.

## Pending owner

- Approval of `ready/real-check` (the change to the checks).

## Next

1. QA round 2 fixes, one area-lead-core goal ("with several sessions and subagents the bar still tells the truth"): issues 01-07 below. Lead's direction: only a permission prompt pre-empts; among the rest show the session the driver is most likely following (most recently active/spoken to), not an idle one, and do not flip the detail lines between sessions on every event; a permission prompt stays until that prompt is answered (track by subagent `agent_id`/tool_use_id), whatever else the session does; `SessionStart` source `compact` must not show WAITING. 02 and 06 rest on assumptions about Claude Code: record real sessions (parallel subagents with a prompt; a compaction) before fixing, as cycle 2 did. Risky (core logic): reviewer afterwards.
2. In parallel (other files): view/server polish 08-14, and docs 15 (BENCH items 20-22 still expect STARTING; view README says N <= 7).
3. Then stage 2, hook wiring: hook scripts POST stdin to `http://127.0.0.1:8138/event` (`src/server/README.md`) and send the synthetic events (`RevviewContext` with the branch, `RevviewStarting`, `RevviewNetwork`, `RevviewDataLock`; `src/state/README.md`). Open points: a Claude that dies without SessionEnd stays on the bar (no clock in the core); a failed dictation has no event; `worker_permission_prompt`, `StopFailure`, `PostToolUseFailure`, `PermissionDenied` are handled from the package source only, not recorded.
4. QA again after item 1 lands.

## QA issues, round 2 on 0f38005 (`docs/agents/issues/qa-20261122-*.md`, report `-00-round-report`), all OPEN

Major:
- 01 an idle second session (WAITING) outranks the session that is working, right after the driver spoke to it.
- 02 a permission prompt of one subagent disappears when a parallel subagent of the same session runs a tool.

Minor: 03 with `+N`, WAITING/PERMISSION never show the repo (which session needs me?); 04 two working sessions: detail lines flip on every event; 05 branch of an ended session shown next to other repos; 06 `SessionStart` source `compact` shows WAITING while Claude works; 07 SessionEnd of a never-seen session on an UNKNOWN/STARTING board shows CLAUDE EXITED; 08 reloading the live page while the server is down leaves Chromium's error page for good; 09 a short command is cut at 40% width although there is no output.

Polish: 10 grey first paint on every page load (about 33 ms here); 11 `≥ +0 −0`, and an id-less lost event marks every session; 12 `+11` runs off the panel next to NEEDS PERMISSION; 13 branch becomes a bare `·…`; 14 OFFLINE overlay reads "Claude: unknown"; 15 stale docs (BENCH 20-22, view README).

## Small follow-ups

- (c) Developer page: the diagonal calibration assumes resolution in CSS px.
- (d) After `real-check` merges: `tests/unit.sh` and `tests/emulator.sh` are no longer run by the check; remove them or keep them as developer shortcuts, and note that a new `tests/*.sh` is not picked up automatically. Optional hardening for a later, separately approved change: fail unit/emulator when zero tests passed; a `timeout` around the runners.
- (e) The question mark and broken-link shapes look smaller than the other state shapes (cosmetic).
