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

- DONE (merged 2026-11-21, gate main 4b18e29): state core `src/state/` (pure reducer, 66 node tests) with three real recorded sessions in `fixtures/sessions/` and replay tests.
- A static view page renders each state at 1280x400.
- The emulator runs at the physical panel size (about 190 x 60 mm active area).
- `tools/check` writes one screenshot per state to `<outdir>/shots/`.

## In flight

Nothing. The team is halted by the owner; the one-shot cycle of 2026-11-21 (owner message 20261121T180747Z-o-a0651c, backlog 5ffe86) finished with the state core merged.

## Pending owner

Nothing. `apt:shellcheck` and `recipe:playwright-browsers@1.65.1` are installed.

## Next

1. Real `tools/check` on its own branch (lint, unit tests counted properly, shellcheck), explained with `owner-gate explain`; held for approval.
2. The static view page + 1280x400 emulator, screenshots per state, fed by `fixtures/sessions/*.jsonl` through `replay()` (these are the canonical fixtures; no placeholders).
3. Later, hook wiring must send the synthetic events the reducer expects (`RevviewContext` with the branch, `RevviewStarting`, `RevviewNetwork`, `RevviewDataLock`; see `src/state/README.md`). Open points: SessionEnd is ignored (view keeps its last state); a failed dictation has no event yet; `worker_permission_prompt`, `StopFailure`, `PostToolUseFailure`, `PermissionDenied` are handled from the package source only, not recorded.
