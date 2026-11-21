# STATE

Updated 2026-11-21.

## Roadmap (the charter's four stages)

1. The glance view: state core + static page + 1280x400 emulator, screenshots per state.
2. Hook wiring: Claude Code settings and hook scripts feeding the view; optional spoken summary on Stop.
3. Push-to-talk input: button to Claude Code's push-to-talk key.
4. The Pi image: kiosk boot, rotation, quiet boot, power-cut behaviour (documented, cannot run here).

## First jobs, in order

1. DONE (merged 2026-11-21, gate main f2bca35): stack + skeleton: decisions in `docs/DECISIONS.md`, layout, one real unit test.
2. Real `tools/check` on its own branch, explained with `owner-gate explain`; held for owner approval.
3. Emulator of the 1280x400 7.9" panel with one screenshot per state. Blocked until the playwright-browsers recipe is installed.
4. Product.

## Milestone 1: glance view in the emulator

- State core reduces recorded hook events to the named states (`working`, `waiting`, `permission`, `done`, `starting`, `offline`, `insert-key`), with unit tests.
- A static view page renders each state at 1280x400.
- The emulator runs at the physical panel size (about 190 x 60 mm active area).
- `tools/check` writes one screenshot per state to `<outdir>/shots/`.

## In flight

Nothing. The team is halted by the owner; the one-shot cycle of 2026-11-21 (owner message 20261121T174544Z-o-f9471a) finished with the skeleton merged.

## Pending owner

- `apt:shellcheck`: request 20261121T174603Z-k-f1c293
- `recipe:playwright-browsers@1.65.1`: request 20261121T174603Z-k-ee4355

## Next

Real `tools/check` branch, then the emulator once Chromium is installed.
