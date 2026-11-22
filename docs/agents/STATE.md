# STATE

Updated 2026-11-22 (one-shot cycle after cycle 9: wheel buttons 2 reviewed a second time and hardened, 98d7fc2).

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
- DONE (merged 2026-11-22, 2406ab9, topic `wb2-qa3`, cycle 9): QA round 3 (1 major, 5 minor, 4 cosmetic; round 2 fixes all held) and its fixes: 01 (major: NEEDS PERMISSION showed a stale Bash command and output for non-Bash requests), 03, 04, 06, 09, 10 closed. Decisions in DECISIONS.md "QA round 3": no diff under NEEDS PERMISSION; needing the driver outranks OFFLINE; an untied prompt clears on its agent's next tool event; commands break at spaces (a word joiner U+2060 after hyphens in the displayed text, `data-full` keeps the plain command).
- OPEN: milestone 1 is finished when a QA round on the current main finds no major. Round 3 found one; it is fixed but no QA has used main since 2406ab9. A short QA round 4 is the next cycle's first job.

## In flight

Nothing. No ready branch (other than this notes branch), no worktree, nothing held.

## Owner decisions

- 2026-11-22, message 20261122T064434Z-o-942fed (answer to the scope question): "Yes, all of it: build as phased in docs/BUTTONS.md section 8 (backlog items Wheel buttons 2-6)". The scope escalation is settled; all six backlog items show `approved`. Replied `planned`; reply `done` when WB6 lands. If the owner starts one of WB3-6 as a one-shot job, that cycle does it; otherwise normal cycles take them in order.
- The 8 smaller questions in BUTTONS.md section 8 were not answered one by one: the defaults there stand (tap, tmux, hook deny, single Ctrl+C, Piper with espeak-ng fallback, projects from a config file, list/menu allowed with a 10 s auto-return, the F-key table).

## Wheel buttons

Design: `docs/BUTTONS.md`; recordings `fixtures/buttons/`. Phases:

- WB1 DONE (72a2d13): design note.
- WB2 DONE (2406ab9): input layer. `src/input/` (key codes, `config/buttons.json` key map, gesture detector with an injected clock: tap / hold 400 ms / long-hold 1000 ms, 30 ms debounce both ways, auto-repeat ignored; evdev parser 24-byte layout; device matching from `/proc/bus/input/devices`; reconnecting reader with backoff up to 30 s). Exclusive grab by `src/input/grab.py` (python3 standard library, no new dependency; exits when its parent dies). The reader runs INSIDE the server (`node src/server/index.js --input`), not as a separate service. Presence -> `RevviewInput` -> quiet NO BUTTONS tag in the band (hidden during STARTING and NO LINK). Gesture log `GET /buttons`; `onGesture` hook in the server for WB3. Dev bridge `POST /dev/key` only with `--dev-bridge` (`npm run start:dev`, page at `/?devkeys=1`). SECURITY RULE (reviewer finding, fixed): `RevviewButton` and `RevviewInput` over HTTP get 403 unless `--dev-bridge`; gestures come only from the in-process reader. The Pi unit must pass `--input` and NEVER `--dev-bridge`; its user needs the `input` group; the image needs python3. Bench W1-W5 and 27-35 untested; nothing ran on a real device, a successful grab was never seen, all traces are constructed.
- WB2 second review (one-shot job 20261122T061619Z-o-a96099, merged 98d7fc2, 563 tests): approve, no blocking finding. Hardened: key events after `SYN_DROPPED` are skipped up to the next `SYN_REPORT`; the real release time is used for the debounce; a backwards clock cannot lock a key; `grab.py` gets the server pid as an argument; tests for helper kill on stop and for releases at exactly 400 / 1000 ms. Left for WB3 (matters once gestures act): the `dropped` (during starting) mark depends on `RevviewStarting`, which any local process can post, so WB3 must not let a posted event decide whether a gesture acts. Still unproven: `grab.py` exiting after its parent dies (bench W5), 32-bit event size is not selected automatically.
- WB3 NEXT: sessions the Pi owns (private tmux server), actions by `tmux send-keys` (push-to-talk tap, Esc, a single Ctrl+C), allow/deny by a waiting PermissionRequest hook with an explicit timeout, new session from a project list. Notes from WB2: act only on gestures that are not `dropped`, through `onGesture`; hold-mode push-to-talk would need raw key-down/up events the detector does not emit; a cancel press released between 400 and 1000 ms does nothing; the "bar briefly marks a dropped press" part is not built. QA r3-02 (after Esc/Ctrl+C the bar stays WORKING: no hook fires after an interrupt) MUST be solved in WB3: revview sends the key itself, so it can tell the state core. The permission hook is the security-critical part: reviewer (Opus) required.
- WB4: state core and bar: selected session, position "2/3", mic mark, list, menu, home. Note: in the worst band (NEEDS PERMISSION, 9+, NO BUTTONS tag) the repo name is already cut to a stub.
- WB5: read aloud (new dependency: needs DECISIONS entry and probably `owner-packages request`).
- WB6: dongle and pod set-up docs, ZMK keymap reference, bench checklist.

## Next

1. QA round 4 (qa, short): the round 3 fixes on main (permission rows for Edit/Write/WebFetch/MCP/subagent, permission while offline, untied prompt clearing, command wrapping) and the WB2 surface (NO BUTTONS tag in every state, `/?devkeys=1` with `npm run start:dev`, a posted RevviewButton is refused without the bridge). No major -> milestone 1 closed.
2. WB3 (area-lead-core, Opus; reviewer Opus). Can run in parallel with item 1.
3. Stage 2, hook wiring (area-lead-platform, Opus): hook scripts POST stdin to `http://127.0.0.1:8138/event` and send the synthetic events (`RevviewContext`, `RevviewStarting`, `RevviewNetwork`, `RevviewDataLock`); a Claude Code settings file; optional spoken summary on Stop. It shares the settings file and the PermissionRequest hook with WB3: do it together with WB3 or right after, not in parallel on the same files. Open points: a Claude that dies without SessionEnd stays on the bar; a failed dictation has no event; `worker_permission_prompt`, `StopFailure`, `PostToolUseFailure`, `PermissionDenied` come from the package source only.

## QA issues

Open (in `docs/agents/issues/`, round 3): 02 interrupt stays WORKING (minor now, major once Cancel exists: WB3); 05 StopFailure looks like WAITING FOR ME (payload facts from the binary's strings are in the issue; no recording); 07 a duplicated PostToolUse doubles the diff; 08 a late PostToolUse after Stop and idle_prompt flips back to WORKING. 05/07/08 rest on Claude Code behaviour never recorded: try to record them during stage 2.

Known limits from the round 3 fixes: a prompt tied to a call whose PostToolUse was lost still shows NEEDS PERMISSION until Stop/idle_prompt/a driver prompt; the `#session` fallback is only reached by a forced style in the emulator.

## Small follow-ups

- (c) Developer page: the diagonal calibration assumes resolution in CSS px.
- (d) `tests/unit.sh` and `tests/emulator.sh` are no longer run by the check; remove them or keep them as developer shortcuts. Optional hardening for a later, separately approved change: fail unit/emulator when zero tests passed; a `timeout` around the runners.
- (e) The question mark and broken-link shapes look smaller than the other state shapes (cosmetic).
- (f) With `--input --dev-bridge` together a page blur resets the real device's detector (dev only, documented).
