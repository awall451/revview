---
status: closed (2026-11-22, work/qa5-fixes: hooks/README.md, BENCH-TEST H7 and DECISIONS say what is built: owned windows leave after two polls; sessions not started by revview still stay; not yet re-run by QA)
id: qa-20261122-r5b-01
title: Docs still say a Claude that dies without SessionEnd stays on the bar ("fix proposed, not built"); work/qa5-fixes built it and the emulator shows it leaving in about 4 s
severity: minor
area: docs (hooks/README.md, docs/BENCH-TEST.md H7, docs/DECISIONS.md)
how to reproduce: on work/qa5-fixes (38c9ee1) start the live server with `--sessions --start <a> --start <b>`, replay a few events for <a>, kill <b>'s revview tmux window (`tmux -L revview kill-window -t @1`) without posting SessionEnd, poll /state every second (script /tmp/qa5b-scripts/k1.mjs)
evidence: /tmp/qa5b-shots/k1-06.png; /state: +3.0 s still "beta-web done 2/2", +4.0 s "alpha-service working 1/1, note 'beta-web ended'"
---

## Seen

Commit e505b08 ("an owned window that is gone ends its session") works: the killed window's session left the bar
within one owned poll (about 4 s here), the other session stayed, and the note "beta-web ended" showed.

The docs on the same branch still describe the old behaviour:

- `hooks/README.md` lines 73-75, "A Claude that dies without SessionEnd": "It stays on the bar with its last state".
- `docs/BENCH-TEST.md` H7: "Today: until a new session pushes it out or `RevviewStarting` (... a fix is proposed,
  not built)".
- `docs/DECISIONS.md` about line 953: "(decided, not built here) ... Proposal: treat a session that WAS owned and is
  no longer owned like a SessionEnd"; and line 333 "Not solved here (known limits)".

## Expected

Say what is true now: a revview-owned session leaves the bar within one `ownedPollMs` (5 s) after its window is gone;
a Claude started by hand outside revview still stays. H7 should note that the window-kill case is shown in the
emulator and only the Pi timing / `kill -9` of the Claude pid inside a still-open window remains untested.
