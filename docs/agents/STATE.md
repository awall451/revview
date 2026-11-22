# STATE

Updated 2026-11-22 (cycle 8).

## Roadmap (the charter's four stages)

1. The glance view: state core + static page + 1280x400 emulator, screenshots per state.
2. Hook wiring: Claude Code settings and hook scripts feeding the view; optional spoken summary on Stop.
3. Push-to-talk input: button to Claude Code's push-to-talk key.
4. The Pi image: kiosk boot, rotation, quiet boot, power-cut behaviour (documented, cannot run here).

## First jobs, in order

1. DONE (merged 2026-11-21, gate main f2bca35): stack + skeleton.
2. DONE (approved by the owner, merged 2026-11-22, gate main f1fc82b): the real `tools/check` (setup, lint, seed, unit, emulator, shots). The gallery now gets the screenshots.
3. DONE (merged 2026-11-21, gate main 64dfbbf): emulator of the 1280x400 7.9" panel, one screenshot per state.
4. Product: in progress (milestone 1).

## Milestone 1: glance view in the emulator

- DONE: state core `src/state/` (reducer, per-session board `src/state/board.js`), recorded sessions in `fixtures/sessions/` (nine real Claude Code 2.1.330 recordings).
- DONE: emulator at physical size (`emulator/`), per-state fixtures `emulator/fixtures/*.json`, worst cases `emulator/worst-case/*.json`.
- DONE: the view `src/view/`, live server `src/server/` (`npm start`, 127.0.0.1:8138, POST /event -> SSE), boot page, service worker for reload while the server is down.
- DONE (merged 2026-11-22, 0f38005): QA round 1, 14 issues.
- DONE (merged 2026-11-22, 15dd3f0, topic `qa-round-2`, cycle 7): QA round 2, all 15 issues closed (several sessions and subagents, sticky focus, prompts per agent, compaction, polish). Cycle 7 was cut short before its notes; this is reconstructed from the git log.
- DONE (merged 2026-11-22, 3e8f199, topic `dense-layout`, cycle 8): the owner's dense layout (message 20261122T042927Z-o-d9a077, replied done). State word 5.94 mm, other text 3.41 mm, tests hold 5.8-6.3 / 3.3-3.7 mm; band 84 px, then tool/file/diff, the full command wrapped (up to 6 rows), last 3 output lines (`outputLines` in the core, commands up to 300 code points). 423 tests = gate count, 22 shots. DECISIONS "dense layout"; bench item 26 (3.5 mm legibility) untested.
- OPEN: milestone 1 is finished when a QA round on the current main finds no major. No QA has run since 0f38005: neither the round 2 fixes nor the dense layout have been used by QA. That is the next cycle's first job.

## In flight

Nothing. No ready branch, no worktree, no open owner message, nothing held.

## Pending owner

Nothing.

## Next

1. QA round 3 on gate/main (qa agent, Opus): replay the recordings and awkward events in the emulator at the new type sizes; check round 2 fixes (several sessions, subagent prompts, compaction, reload while down) and the dense layout (is the state still a one-second glance, wrapped commands, 3 output lines, sparse states). File issues in `docs/agents/issues/`; fix majors in the same or the next cycle.
2. Small view follow-ups from the dense-layout review (one Sonnet area-lead-core run, can go with QA fixes): a test that forces `#where` hidden and checks the `#session` repo fallback (`src/view/view.js` about line 216; polish2 lost that coverage); derive the command row height from the computed line-height or pin it in a test (`ROW_PX = 40`, `MAX_ROWS = 6` in `fitCommand`); wrapping can split `--oneline` after the first hyphen (cosmetic; prefer breaking at spaces).
3. Stage 2, hook wiring (area-lead-platform or core, Opus): hook scripts POST stdin to `http://127.0.0.1:8138/event` (`src/server/README.md`) and send the synthetic events (`RevviewContext` with the branch, `RevviewStarting`, `RevviewNetwork`, `RevviewDataLock`; `src/state/README.md`); a Claude Code settings file; optional spoken summary on Stop. Open points: a Claude that dies without SessionEnd stays on the bar (no clock in the core); a failed dictation has no event; `worker_permission_prompt`, `StopFailure`, `PostToolUseFailure`, `PermissionDenied` are handled from the package source only, not recorded. Can start in parallel with item 1 (other files).

## QA issues

None open. `docs/agents/issues/qa-20261122-00-round-report.md` is the round 2 report (all its issues closed in 15dd3f0).

## Small follow-ups

- (c) Developer page: the diagonal calibration assumes resolution in CSS px.
- (d) `real-check` is merged: `tests/unit.sh` and `tests/emulator.sh` are no longer run by the check; remove them or keep them as developer shortcuts, and note that a new `tests/*.sh` is not picked up automatically. Optional hardening for a later, separately approved change: fail unit/emulator when zero tests passed; a `timeout` around the runners.
- (e) The question mark and broken-link shapes look smaller than the other state shapes (cosmetic).
