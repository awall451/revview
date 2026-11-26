# STATE

Detail and history: `HISTORY.md` (the old STATE, verbatim), `JOURNAL-archive.md` (journal before cycle 36), `docs/DECISIONS.md`, `docs/PI-FACTS.md`. Read them only when needed. The owner's console counts cycles (this file was last written in cycle 61); that number is used. Gate main: 8e0ecb4, 1944 tests (cycle 61).

## Status per charter stage

1. Glance view and emulator: built and merged. Proven only in the emulator (1280x400, screenshots per state, real Claude Code recordings). Never on a real panel.
2. Hook wiring and spoken summary: built and merged (hooks, `POST /permission`, `src/speech/`, `speakOnStop` default off). Proven with recordings and stand-ins. Nothing has made a sound.
3. Push-to-talk and wheel buttons (WB1-WB6): built and merged (input layer, sessions in tmux, allow/deny, selection, list and menu, read aloud, dongle files, ZMK reference). Proven with fakes, constructed traces and the emulator. No real device was ever read.
4. Pi image (`pi/`: installer, kiosk, rotation, quiet boot, read-only root, encrypted data, key map merge): built and merged. Tested against a fake root on the build VM. Never run on a Pi.
- Extras since: laptop emulator `emulator/run.sh` (demo, `--live`, `--stop`, guide `docs/EMULATOR-LAPTOP.md`), compaction note on the bar, "Session ended: <reason>" note, HOT / LOW POWER marks (`--thermal`). Since cycle 59-60: CLAUDE ASKS (questions and plans shown and answered from the wheel buttons, `docs/BUTTONS.md` section 10), sound cues (`src/sounds/`, Settings row Sounds), the Pi scripts checked against a tree of the real packages (`pi/tree/`), the long drive (`tools/long-drive`, `docs/LONG-DRIVE.md`, out of the gate).

## Unproven

Nothing is proven on a Pi. The list is `docs/BENCH-TEST.md` (groups: First afternoon, B, C, D, H, HW, L, P, PL, PT, R, S, S4B, V, W; every item `untested`). `docs/PI-FACTS.md` (93 rows) was checked in cycle 42 against the real Trixie arm64 and Raspberry Pi archive packages, names and file layouts only: 61 checked, 9 fixed, 23 still from memory (only a Pi can show them).

## Leftovers (open, none blocking; the rest: HISTORY.md, sections "Small follow-ups", "QA issues", "Wheel buttons", "Next")

- Trust boundary (DECISIONS, cycle 47): processes of the same user are trusted; forged local events (for example a `SessionEnd` for an id not in the owned listing) are accepted, not defended. The owner was asked to add the one line to `docs/DESIGN.md`.
- "Answer the prompt first" now clears itself when the selected session has no pending prompt left (cycle 48). It still shows when the selected session's prompt is not the one the bar shows; an automatic focus move to another session with a prompt leaves it (kept).
- The server is split (cycle 49): `src/server/index.js` only re-exports and runs `main()`; `live.js` holds `startLiveServer` and builds one `ctx` per server (all shared state; no module-level state); file map in `src/server/README.md`.
- Board notes have kinds (cycle 48; table at the top of the note code in `src/state/board.js`: plain, too-early, starting-ptt, answer-prompt, ended, ended-last, no-session). A new note that needs a clearing or hiding rule gets a kind there; never match on text. A plain note ending in ": open the menu for New session" is no longer hidden while locked (only ended-last and no-session are).
- `netmon.check()`: pokes during a real outage reach OFFLINE faster than the 2-probe debounce (real probes only; same-user, accepted). Under `--netmon` the dev bridge cannot force OFFLINE either. No test for "failing probe after a poke".
- Hold-mode push-to-talk is not built (tap is the charter's mode).
- No script installs Piper (written steps only; its command line is from memory; neither archive has a TTS piper package, Debian's `piper` is a mouse tool).
- The Pi session starts `labwc -m`, so our autostart runs after the system one: desktop, panel and kanshi still start under the kiosk (kept, DECISIONS; bench P4-P6 look for anything showing around the kiosk; the desktop's Screen Configuration tool can override our rotation).
- `sox` exists under that name in Trixie and provides `rec` (checked cycle 42); whether Claude Code's `/voice` works with it is bench P21.
- `run.sh --live`: the early-exit message still offers "not signed in" as a cause (QA saw that case not exit); one failed `tmux has-session` counts as Claude gone.
- Not re-reviewed or re-run by QA: the `live-gaps` fix round (de1b547) and the `pi-leftovers` last round (66fff51).
- The `--keys` sheet is at its line limit, so the "Too early: press again" rule is only in the guide; its labels can drift from the real actions (no test runs the keys through them).
- Locking the data when the stick is pulled is not built (DESIGN: later, maybe).
- `docs/DESIGN.md` still says "Later (not now)" for the thermal marks; the team does not edit it (the owner was told).

## In flight

- Cycle 61, submitted on main 8e0ecb4 (1944 tests): `ready/time-progress` (7cdcad1, owner issue #29, backlog 14c692; full check on the branch 2091) and `ready/lead-notes-61` stacked on it. When merged: delete `ready/time-progress`, `work/time-progress`, `ready/lead-notes-61`, `lead-notes-61`; set owner issue #29 (id 20261125T214235Z-i-0cd94b) `done` with `--commit <merge sha>` and `--shot shots/<full sha>/quiet.png`; `owner-publish request`. If the gate fails it: fix round from the gate's log (core). No worktree, no held change.
- Cycle 60's `ask-fixes` and notes merged (main 8e0ecb4, published 2026-11-26T01:22Z).
- Owner question open: `owner-inbox ask ask-updown-order` (QA r11-04: the options under CLAUDE ASKS are in two columns, up/down move in reading order 1-2-3-4). Default taken: keep reading order. The answer comes as an owner message.

## Next (the owner's focus order: open issues first)

- Cycle 62: #30 night and day looks (backlog dedc86, Opus, core; `owner-backlog taken` first, issue `in_progress`), on main after #29 has merged. It doubles the screenshot set (70 shots now); the new band elements of #29 (clock, QUIET tag, `tasks 3/7`) need both looks too. QA is due after #30 (last QA: r11 in cycle 60, before #29).
- Open after #29 (none blocking; DECISIONS "How long and how far", bench T1-T6): the task tools (TaskCreate/TaskUpdate) appeared for haiku only with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`; revview does not set it, so whether the owner's sessions keep a list at all is bench T4. Not recorded: a task list over `/compact`, a deleted task. The progress keeps a running total over several finished lists until the next SessionStart (no "new list" rule: not backed by a recording). The quiet re-arm test uses a held question ended by `RevviewAskGone`; the wheel-answer path (`RevviewAnswered`) goes through the same `apply` hook but has no test of its own. Demo scene 11 `tasks` has no key (the `--keys` sheet is at its line limit). Past 64 quiet timers the oldest is dropped with a log line. The clock shows only in WORKING, NEEDS PERMISSION and CLAUDE ASKS and hides first when the band is full.
- Open after cycle 60 (none blocking; QA files `docs/agents/issues/qa-20261126-r11-*`): the Settings choice for Sounds is not kept over a server restart (nothing writes settings at run time; the Pi root is read-only; `sounds` in `config/speech.json` is the lasting place): needs a writable place (the data partition) and a decision; `pi/install.sh` does not install `alsa-utils` (`aplay`; PI-FACTS P16, bench SC): add with the next `pi/` change and its names fixture; after Esc on a question the session shows WORKING until its next event; several questions, multi-select and 'other' are terminal-only; the view matches the one note text 'Answer in the terminal when parked' (duplicated constant from `actions.js`: make it a note kind or a shared constant); `src/speech/index.js` uses the global `setTimeout` for the 2 s wait before speech; a repeated identical Stop event repeats the spoken summary (no cue); a demo scene jump can play two cues in a row; no sounds test for the 540 s timeout case; QA did not test: two sessions with a question each, the 'terminal does not show the plan' refusal, a real desktop window.
- #34 lights per project (backlog b801af) is a FUTURE GOAL: the owner's text says not to run it now; no parts are chosen. Do not take it until the owner says so. The idea: one LED per session in the housing on the Pi's GPIO, colour and pattern by state (working steady, needs you slow flash, failed fast flash, none off), same colours as the bar; it comes after sounds (#31) and reuses its "what changed, for which session" logic. Open then: LED type and count (addressable strip on one pin, or plain RGB LEDs on three pins each), wiring, driver.
- Small leftovers from cycle 59 (none blocking): no plan scene in the laptop demo; row A under CLAUDE ASKS shows the raw tool name; read aloud drops file names from a plan title ("add hello.sh" is read "add"); `pi/tree/check.sh` writes into its copy of the tree through `install.sh --root` (an absolute symlink in the copy would be followed; the packages are pinned by hash); a cmdline with both `overlayroot=disabled` and `overlayroot=tmpfs` counts as on (not checked which the initramfs honours); two old QA issue files still say `journalctl --user -u revview` (the right form is `sudo journalctl --user-unit=revview`).
- For the owner to judge (told in the #33 comment): NO LINK shows for about 1 s on every event-stream reset; events posted while the server is down are lost (no persistence, by design).
- Going further than the package tree (running raspi-config's edits or `cryptsetup --help` for arm64) would need `qemu-user-static` and binfmt set up by root: not requested; it would show program output under emulation, still not the Pi.
- `pi/`: PI-FACTS E13 stays part-checked (the default PBKDF shows only in `cryptsetup --help`); 22 rows stay from memory (Pi-only). The tree tool: `pi/tree/build.sh` (43 pinned packages, about 140 MB, on request) and `pi/tree/check.sh`.
- Small `src/server/` leftovers for the next change there (found during the split, not fixed, none visible to the user): the owned poll's "window ... disappeared" log line prints the window name raw (the "ended" line strips control characters); the SSE ping and the owned poll use the global `setInterval`, not the injected `timers`; `close()` does not clear the demo client set; `unlocked` in `monitors.js` is set and never read; the usage comment is in both `index.js` and `cli.js`; the README file table lacks `datalock.js`, `netmon.js`, `thermal.js`.
- Open escalations: see `ESCALATIONS.md` (the cycle schedule only; the others are resolved).

## Standing rules

- When a work branch and the notes go in the same cycle, stack the notes on the work branch.
- Brief a fix round as "check out the branch in your own worktree": an area lead cannot enter another agent's worktree.
- Ask for a looped run under CPU load whenever a test waits on timers.
- The team does not edit the owner's design documents (`docs/DESIGN.md`); it tells the owner.
- A live trial with a real Claude Code must not use `/model` (it writes `~/.claude/settings.json`); start it with `--model`. Every tool that starts servers must be checked for leftovers (`pgrep`) before its worktree is removed.
- A fix round: remove the first agent's worktree (after checking it is clean), then the next agent checks the branch out in its own.
- A Sonnet lead sent back twice, or failing at the gate, is redone on Opus ("Redo on Opus:").
- Idle cycles: sync, verdicts, inbox, stop. No invented work; an idle cycle should cost well under $1.
- Never use another route when the proxy refuses a domain; test the domain, report, wait.
- Nothing is marked as working on hardware before the owner's bench says so.
- Do not invent features beyond the charter.
- Do not start QA or leads without a reason.

- A new test must not hard-code the number of recordings in `fixtures/sessions` (the cycle 59 gate failure of long-drive: 6 became 10 when another branch merged first).
- When branches are stacked, the stack's tip gets one full check before submitting (cycle 60: a Sonnet platform lead built the stack, added the tests where the features meet, and ran it).
- QA gets a turn budget in its brief (about 60 tool calls) and writes its report file before long trials: in cycle 60 it ran out of turns and had to be resumed.