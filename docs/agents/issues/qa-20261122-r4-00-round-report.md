---
id: qa-20261122-r4-00
title: QA round 4 report, the wheel-button flow (WB4) in the emulator
severity: n/a (report)
area: sessions, actions, board selection/nav, view band and list/menu
how to reproduce: scripts in /tmp/qa-wb4-shots/scripts/ (lib.mjs + s1..s11), against `work/wb4-selected` at 2d9178e
evidence: /tmp/qa-wb4-shots/*.png (58 shots at 1280x400, scale 1), gate gallery copies in /tmp/qa-wb4-shots/gallery/
---

## Setup

- Worktree of `work/wb4-selected` (2d9178e) at /tmp/qa-wb4. `bash tools/check /tmp/check-qa-wb4`: setup, lint, seed,
  unit, emulator, shots all ok, `TESTS_PASSED=763`. I looked at all 13 `wb4-*` gallery shots.
- Live server `node src/server/index.js 8140 --dev-bridge --start <a> --start <b> --projects <file>`, later restarted
  with `--sessions`. Real tmux, with `TMUX_TMPDIR` set to a private dir so the `-L revview` socket of other agents
  was not touched; a stand-in `claude` first on PATH that logs its argv and every byte it receives (no real Claude
  Code was run). Projects file: 7 existing dirs, one missing, one relative.
- Chromium (Playwright, preinstalled) at 1280x400, scale 1, page `/?devkeys=1`; keys F13-F23 sent with CDP key
  events exactly like `emulator/tests/wb4-live.spec.js`. Hook events: `fixtures/sessions/*.jsonl` and
  `fixtures/buttons/wb3/events-wb3-deny-main.jsonl`, re-targeted to the uuids revview gave its tmux windows; the
  PermissionRequest went to `POST /permission` as a long poll, as the hook does.

## What I tried, and what worked well

- **Where push-to-talk goes.** Mic plus "2/3" in the band is readable in a glance at this size; the crossed mic
  and the bottom note appear for no session / not a revview session / no revview session, and the crossed mic is a
  shape, not a colour. Push-to-talk sent exactly one Space (`20`) to the selected window and nothing to the others
  (stand-in logs).
- **Left/right** step and wrap (1/2 -> 2/2 -> 1/2); positions update. **Home** (back held 700 ms) went to the
  session with the prompt every time.
- **Prompt elsewhere**: the `▲+N` hint appeared, the selection never moved by itself; home took me there.
- **Allow and deny by buttons**: allow after 2 s returned `{"behavior":"allow"}`; deny returned the deny with the
  fixed message. Refused, as designed: press 0.5 s after home; press at once after left; press at once after the list
  closed by choosing a row; press at once after the 10 s auto-close; press and deny while the list or menu was open
  (only navigation; no bytes reached any stand-in, the long poll stayed open). Press on NEEDS PERMISSION never
  opened the list. Up opens the list even on a prompt (fine, documented).
- **List / menu**: opens on the selected row, moves without wrap, chevrons show rows above/below, 6 visible rows of
  8, back closes one level, menu toggles, auto-close measured between 9.3 s and 10.9 s after the last gesture.
  New session started a tmux window in the chosen dir; the missing dir was refused (log); the relative path was
  refused at load (log). Projects and Settings are read only.
- **States with the new marks**: working, waiting, needs permission, done, offline, starting, unknown, NO BUTTONS,
  1, 2, 3, 4 and 8 sessions, 75-character repo names. Nothing overlapped or was cut off at 1280x400; the worst
  band fits.
- **Hand recomputation**: positions (3/4, 7/8 -> 8/8, 1/8) and `+N` (= sessions on the board minus one) matched what I
  counted from the posted sessions; home ranking (permission first) matched.

## Findings (one file each)

Major: r4-01 restart hides running sessions; r4-02 list cursor moves to another session; r4-03 New session no
feedback / trust dialog not covered; r4-04 deny looks like allow, then DONE shows the denied command.
Minor: r4-05 band numbers; r4-06 not-owned sessions unmarked in list, home lands on them; r4-07 refused press is
silent; r4-08 cap drops an owned session; r4-09 mic plain while offline / no buttons.
Cosmetic: r4-10 crowded worst band and name cutting; r4-11 Settings voice row and STARTING wording.

## What I could not test

- Anything on the Pi, the panel, the pods or in a car: legibility of 3.55 mm rows, the mic glyph and the triangle
  in daylight, real key codes, timing on the Pi. Nothing here proves any of it (bench V1-V9 are all `untested`).
- Real Claude Code: voice, the real PermissionRequest hook after a switch (bench V6), the folder-trust question on
  New session (r4-03), how fast the first hook arrives after New session.
- Cancel long-hold (Ctrl+C) and cancel tap were only covered by the existing unit tests, not re-driven by me.
- `--input` with a real evdev device; only the dev bridge was used.
- I did not change any code. My server ran on 8140 only and was stopped; my private tmux server was killed.
