# STATE

Detail and history: `HISTORY.md` (the old STATE, verbatim), `JOURNAL-archive.md` (journal before cycle 36), `docs/DECISIONS.md`, `docs/PI-FACTS.md`. Read them only when needed. The owner's console counts cycles (this file was last written in cycle 52); that number is used. Gate main: 1676 tests.

## Status per charter stage

1. Glance view and emulator: built and merged. Proven only in the emulator (1280x400, screenshots per state, real Claude Code recordings). Never on a real panel.
2. Hook wiring and spoken summary: built and merged (hooks, `POST /permission`, `src/speech/`, `speakOnStop` default off). Proven with recordings and stand-ins. Nothing has made a sound.
3. Push-to-talk and wheel buttons (WB1-WB6): built and merged (input layer, sessions in tmux, allow/deny, selection, list and menu, read aloud, dongle files, ZMK reference). Proven with fakes, constructed traces and the emulator. No real device was ever read.
4. Pi image (`pi/`: installer, kiosk, rotation, quiet boot, read-only root, encrypted data, key map merge): built and merged. Tested against a fake root on the build VM. Never run on a Pi.
- Extras since: laptop emulator `emulator/run.sh` (demo, `--live`, `--stop`, guide `docs/EMULATOR-LAPTOP.md`), compaction note on the bar, "Session ended: <reason>" note, HOT / LOW POWER marks (`--thermal`).

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

- Nothing. No ready or work branch, no worktree, no held change. Published: main 0b0329f (2026-11-24), nothing ahead of it.

## Next

- Nothing planned: every approved backlog item is done or taken. The team waits for the owner's bench (`docs/BENCH-TEST.md`). `owner-focus blocked` was said in cycle 50. Next cycle: sync, inbox, stop, unless the owner has sent something. An idle cycle in which nothing changed writes no note and submits nothing (cycle 52 was the last idle note); the journal's last entry then stays true.
- Small `pi/` leftovers for the next `pi/` change: `readonly.sh --dry-run` exits 2 when overlayroot is missing (say so in the help); an fstab line where `ro` is not right after `defaults` makes `disable` give up after 3 calls; PI-FACTS E11 and E13 are only part-checked.
- Small `src/server/` leftovers for the next change there (found during the split, not fixed, none visible to the user): the owned poll's "window ... disappeared" log line prints the window name raw (the "ended" line strips control characters); the SSE ping and the owned poll use the global `setInterval`, not the injected `timers`; `close()` does not clear the demo client set; `unlocked` in `monitors.js` is set and never read; the usage comment is in both `index.js` and `cli.js`; the README file table lacks `datalock.js`, `netmon.js`, `thermal.js`.
- Open escalations: see `ESCALATIONS.md` (the cycle schedule only; the others are resolved).

## Standing rules

- When a work branch and the notes go in the same cycle, stack the notes on the work branch.
- Brief a fix round as "check out the branch in your own worktree": an area lead cannot enter another agent's worktree.
- Ask for a looped run under CPU load whenever a test waits on timers.
- The team does not edit the owner's design documents (`docs/DESIGN.md`); it tells the owner.
- A Sonnet lead sent back twice, or failing at the gate, is redone on Opus ("Redo on Opus:").
- Idle cycles: sync, verdicts, inbox, stop. No invented work; an idle cycle should cost well under $1.
- Never use another route when the proxy refuses a domain; test the domain, report, wait.
- Nothing is marked as working on hardware before the owner's bench says so.
- Do not invent features beyond the charter.
- Do not start QA or leads without a reason.
