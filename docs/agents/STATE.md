# STATE

Detail and history: `HISTORY.md` (the old STATE, verbatim), `JOURNAL-archive.md` (journal before cycle 36), `docs/DECISIONS.md`, `docs/PI-FACTS.md`. Read them only when needed. The owner's console counts cycles (this file was last written in cycle 42); that number is used. Gate main: 1651 tests.

## Status per charter stage

1. Glance view and emulator: built and merged. Proven only in the emulator (1280x400, screenshots per state, real Claude Code recordings). Never on a real panel.
2. Hook wiring and spoken summary: built and merged (hooks, `POST /permission`, `src/speech/`, `speakOnStop` default off). Proven with recordings and stand-ins. Nothing has made a sound.
3. Push-to-talk and wheel buttons (WB1-WB6): built and merged (input layer, sessions in tmux, allow/deny, selection, list and menu, read aloud, dongle files, ZMK reference). Proven with fakes, constructed traces and the emulator. No real device was ever read.
4. Pi image (`pi/`: installer, kiosk, rotation, quiet boot, read-only root, encrypted data, key map merge): built and merged. Tested against a fake root on the build VM. Never run on a Pi.
- Extras since: laptop emulator `emulator/run.sh` (demo, `--live`, `--stop`, guide `docs/EMULATOR-LAPTOP.md`), compaction note on the bar, "Session ended: <reason>" note, HOT / LOW POWER marks (`--thermal`).

## Unproven

Nothing is proven on a Pi. The list is `docs/BENCH-TEST.md` (groups: First afternoon, B, C, D, H, HW, L, P, PL, PT, R, S, S4B, V, W; every item `untested`). `docs/PI-FACTS.md` (93 rows) was checked in cycle 42 against the real Trixie arm64 and Raspberry Pi archive packages, names and file layouts only: 61 checked, 9 fixed, 23 still from memory (only a Pi can show them).

## Leftovers (open, none blocking; the rest: HISTORY.md, sections "Small follow-ups", "QA issues", "Wheel buttons", "Next")

- `board.js` `targetOf` routes an id-less event to a sole placeholder, so a local process can show a forged NEEDS PERMISSION there (WB4 reviewer, not done).
- A posted `SessionEnd` for a placeholder hides a live owned session until `RevviewStarting` (WB4 reviewer, not done).
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

- Cycle 42: `work/pi-facts-check` (903f804, full check 1656) submitted as `ready/pi-facts-check`, notes stacked as `ready/lead-notes-42`. When `gate-status` shows both merged: delete the four branches, `owner-issues update 20261123T223054Z-i-7afd33 done`, `owner-inbox reply 20261123T223057Z-o-c4f87f done` (now `planned`), check `owner-publish status` (requested in cycle 42). If it failed: log path to an `area-lead-platform` as a fix task.
- No other branch or worktree is left over.
- No held change. Published: main e98c85d (2026-11-24).

## Next

- After the Pi-facts merge nothing is planned. Small leftovers of its review (not worth a cycle alone; do them with the next `pi/` change): `readonly.sh --dry-run` exits 2 when overlayroot is missing (say so in the help); an fstab line where `ro` is not right after `defaults` makes `disable` give up after 3 calls (message could say how to edit by hand); PI-FACTS E11 (`stat -c`) and E13 (argon2id default) are only part-checked; DECISIONS near line 841 still says espeak-ng 1.51 (a newer line says 1.52.0).
- Otherwise idle: the team waits for the owner's bench (`docs/BENCH-TEST.md`). Do not invent work; say `owner-focus blocked` when in focus and nothing is left.
- Open escalations: see `ESCALATIONS.md` (wheel buttons beyond stage 3; the cycle schedule). The archive-domain entry is resolved.

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
