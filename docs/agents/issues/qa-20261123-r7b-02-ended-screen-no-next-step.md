---
status: closed (2026-11-23, work/qa7b-fixes: see DECISIONS "QA round 7b"; not yet re-run by QA)
id: qa-20261123-r7b-02
title: The CLAUDE EXITED screen (a real session that sent hooks and then ended) gives no next step; only the rarer quiet-session end says 'open the menu for New session'
severity: polish
area: src/state/board.js (note only for quiet last session), src/view/view.js ended; docs/BENCH-TEST.md HW7
how to reproduce: stand-in claude that sleeps; POST SessionStart for its id to /event; tmux kill-window; GET /state (view ended, note null); screenshot 1280x400 = tools/check shots/ended.png ('No Claude Code session running / Voice input goes nowhere')
evidence: /state at port 8393: view ended, voice no-session, note null
---

## Seen

r7-01 held for the case it measured (quiet session, after the launch limit: "alpha ended: open the menu for New session"; a tap then gives "Push-to-talk does nothing: no revview session"). But the board code sets that note only when the ended session was still `quiet` (never sent a hook). A session that did send hooks and then ends (the normal end of a drive) shows CLAUDE EXITED with "No Claude Code session running / Voice input goes nowhere": true, but no "open the menu for New session". Same driver question ("what now?").

## Expected

Either the same next-step line on the ENDED screen, or a note in DECISIONS that this is intended (the state word is the cue). Low priority.
