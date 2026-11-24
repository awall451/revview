# STATE

Detail and history: `HISTORY.md` (the old STATE, verbatim), `JOURNAL-archive.md` (journal before cycle 36), `docs/DECISIONS.md`, `docs/PI-FACTS.md`. Read them only when needed. The owner's console counts this as cycle 41; that number is used from now on. Gate main: 1651 tests.

## Status per charter stage

1. Glance view and emulator: built and merged. Proven only in the emulator (1280x400, screenshots per state, real Claude Code recordings). Never on a real panel.
2. Hook wiring and spoken summary: built and merged (hooks, `POST /permission`, `src/speech/`, `speakOnStop` default off). Proven with recordings and stand-ins. Nothing has made a sound.
3. Push-to-talk and wheel buttons (WB1-WB6): built and merged (input layer, sessions in tmux, allow/deny, selection, list and menu, read aloud, dongle files, ZMK reference). Proven with fakes, constructed traces and the emulator. No real device was ever read.
4. Pi image (`pi/`: installer, kiosk, rotation, quiet boot, read-only root, encrypted data, key map merge): built and merged. Tested against a fake root on the build VM. Never run on a Pi.
- Extras since: laptop emulator `emulator/run.sh` (demo, `--live`, `--stop`, guide `docs/EMULATOR-LAPTOP.md`), compaction note on the bar, "Session ended: <reason>" note, HOT / LOW POWER marks (`--thermal`).

## Unproven

Nothing is proven on a Pi. The list is `docs/BENCH-TEST.md` (groups: First afternoon, B, C, D, H, HW, L, P, PL, PT, R, S, S4B, V, W; every item `untested`). The facts written from memory are in `docs/PI-FACTS.md` (85 rows, all still from memory).

## Leftovers (open, none blocking; the rest: HISTORY.md, sections "Small follow-ups", "QA issues", "Wheel buttons", "Next")

- `board.js` `targetOf` routes an id-less event to a sole placeholder, so a local process can show a forged NEEDS PERMISSION there (WB4 reviewer, not done).
- A posted `SessionEnd` for a placeholder hides a live owned session until `RevviewStarting` (WB4 reviewer, not done).
- Hold-mode push-to-talk is not built (tap is the charter's mode).
- No script installs Piper (written steps only; its command line is from memory).
- The package name `sox` is from Claude Code's hint, unverified (bench P21).
- `run.sh --live`: the early-exit message still offers "not signed in" as a cause (QA saw that case not exit); one failed `tmux has-session` counts as Claude gone.
- Not re-reviewed or re-run by QA: the `live-gaps` fix round (de1b547) and the `pi-leftovers` last round (66fff51).
- The `--keys` sheet is at its line limit, so the "Too early: press again" rule is only in the guide; its labels can drift from the real actions (no test runs the keys through them).
- Locking the data when the stick is pulled is not built (DESIGN: later, maybe).
- `docs/DESIGN.md` still says "Later (not now)" for the thermal marks; the team does not edit it (the owner was told).

## In flight

- Cycle 41 (one-shot, owner message 20261123T223608Z-o-561360, owner issue 20261123T223553Z-i-5b1cf2): this rewrite. Branch `work/notes-trim`, submitted as `ready/notes-trim`. If `gate-status` shows it merged, delete both branches; nothing else is in flight.
- Merged leftover branches of cycles 36-40 (`work/` and `ready/` of lead-notes-36..40b, live-gaps, qa-r10, compaction, pi-leftovers, thermal, thermal-flake, whichever still exist): delete them in a normal cycle.
- No held change. Published: main e98c85d (2026-11-24).

## Next

- PRIORITY, first normal cycle: owner message 20261123T223057Z-o-c4f87f (replied `planned`), owner issue 20261123T223054Z-i-7afd33 (`in_progress`): Pi facts against the real packages, steps 3-6 (steps 1-2 merged as `docs/PI-FACTS.md`, d329128). The owner says the proxy is fixed (note 20261124T021916Z-o-575c89, not yet answered; it answers the ESCALATIONS.md entry of 2026-11-24: add `Resolved:` there once retested). First test: `curl -sS -o /dev/null -w '%{http_code}' -m 20 http://deb.debian.org/debian/dists/trixie/Release` and the same for `http://archive.raspberrypi.com/debian/dists/trixie/Release`. Both 200: one `area-lead-platform` on Opus (the owner's choice), branch `work/pi-facts-check`, goes down `docs/PI-FACTS.md` (its last section describes the run): package indexes for Trixie arm64 and the Raspberry Pi archive; unpack (never install) lightdm, labwc, chromium, raspi-config, wlr-randr and what else the table names; fix `pi/`; update the fake-root fixtures; mark rows and bench items "checked against package X version Y" or still "from memory"; nothing marked as working on hardware. Then `reviewer` on the diff, submit, reply `done`, issue `done`, publish request. Suspicions to check first: O05 `raspi-config nonint do_overlayfs` may apt-install or rebuild the initramfs; L06 the Pi OS labwc session may not read `~/.config/labwc/autostart`; P01/P02 `chromium` vs `chromium-browser`; P08 `cryptsetup` vs `cryptsetup-bin`; X08-X10 (thermal sources, from memory). Either still 403: reply to the note with the exact command and answer, do nothing else on it, never use another route.
- Otherwise idle: the team waits for the owner's bench (`docs/BENCH-TEST.md`). Do not invent work; say `owner-focus blocked` when in focus and nothing is left.
- Open escalations: see `ESCALATIONS.md` (wheel buttons beyond stage 3; the cycle schedule; the archive domains).

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
