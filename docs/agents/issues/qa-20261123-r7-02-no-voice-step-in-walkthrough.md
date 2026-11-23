---
status: closed (2026-11-23, work/qa7-bench: see DECISIONS "QA round 7"; not yet re-run by QA)
id: qa-20261123-r7-02
title: The owner's walk-through never says how to set up voice or make the first drive: pi/README step 6 points to a design note, `/voice tap` and "keep Space" appear only in bench item S1, the mic recorder (SoX/arecord) is neither installed nor checked
severity: major
area: pi/README.md steps 6 and 9, docs/BUTTONS.md section 2, pi/install.sh package list, BENCH S1/34/P14
how to reproduce: read pi/README.md steps 1-10 as the owner, then follow "Set up /voice and its key as in docs/BUTTONS.md"; `grep -n -i "sox\|arecord\|alsa-utils" pi/README.md pi/install.sh pi/setup.mjs docs/BENCH-TEST.md`
evidence: pi/README step 6: "Set up `/voice` and its key as in `docs/BUTTONS.md`"; BUTTONS.md is a 385-line design note with [source]/[proposal] labels, its voice paragraph (lines 133-143) lists settings, no owner steps; grep finds no sox/arecord anywhere in pi/ or the README, only "alsa-utils" in bench R2 (for Piper)
---

## Seen

The charter's done condition is "drive a whole Claude Code task by voice". Following pi/README in order, the owner
ends at step 9 "the bar shows ... then your session" (or step 10, dongle ids). Nothing in the walk-through says:

1. which voice mode: revview sends ONE Space per tap (S2 says hold mode is NOT BUILT), so `/voice tap` is required.
   This is only in bench item S1 ("`tmux -L revview attach` once to run `/voice tap` in it"), item 34 and BUTTONS.md
   ("Recommend tap mode");
2. "and its key": the step reads as if the owner should bind a key. Revview relies on Claude Code's default
   `space` -> `voice:pushToTalk`; rebinding it would break push-to-talk. The walk-through should say "leave it on Space";
3. that voice needs SoX or arecord (BUTTONS.md line 141, [source]); `install.sh` installs `chromium tmux python3
   espeak-ng wlr-randr` only, and no step or bench item checks the recorder exists (P14 checks that the mic is heard,
   which would fail without saying why);
4. where to do it: in a normal terminal before the install, or inside the revview tmux session (S1), and that the
   setting is user-wide (`~/.claude/settings.json`, which after the data set-up lives on the encrypted partition);
5. what the first drive looks like: tap push-to-talk, speak, tap again; where to look on the bar.

## Expected

A short "First drive (parked)" section at the end of pi/README: `/voice tap` once as the kiosk user (in a
terminal or `tmux -L revview attach`), keep push-to-talk on Space, check the recorder (from memory, marked so),
then tap, speak, tap, and which bench items record the result (S1, P13, P14). Package names from memory are
fine if marked; the gap is that the step is missing, not unverified.
