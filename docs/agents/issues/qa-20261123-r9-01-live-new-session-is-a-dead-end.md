---
id: qa-20261123-r9-01
title: --live: menu -> New session shows "No projects" (run.sh never passes a projects file), and the ended screen sends the owner there
severity: major
area: emulator/run.sh --live, docs/EMULATOR-LAPTOP.md (Live), emulator/README.md
---
Reproduce (stand-in claude first on PATH, fresh HOME, clone at 998fb0a):
1. `bash emulator/run.sh --live --no-browser` in a project dir; open the `view:` address in a page (1280x400).
2. Tap M, then Enter (the menu row "New session").
3. Or: close the session's tmux window (`tmux -S <sock> kill-window -t revview:0`), wait ~7 s: the bar says
   CLAUDE EXITED, "proj ended: open the menu for New session".

Seen: the NEW SESSION screen says "No projects: add paths to the projects file". `run.sh --live` starts the server without
`--projects`, and nothing in run.sh, `--help`, the guide's Live section or the `--keys` sheet says how to give it one.
The guide says "Up, Down, Left, Right, M, Backspace and R work as on the Pi", and the ended screen tells the owner to use
New session; both lead to a dead end. After the one Claude exits, the run cannot start another; the owner must stop and
rerun run.sh.
Only by luck does it work: `REVVIEW_PROJECTS=/path/projects.json bash emulator/run.sh --live ...` (the server reads that
variable) gives the rows; Enter then starts a second window/session in that dir, and Left/Right, Enter, N, Space and
Esc each reached only the selected session (checked per-session in the stand-in's stdin log and decision files).
So the keys are correct; the missing piece is how a project list reaches a live run.
Expected: either run.sh --live offers DIR (and the other dirs the owner names) as the New session rows / accepts a
`--projects FILE`, or the guide and `--keys` say "New session needs REVVIEW_PROJECTS=<file>" and name the file format.
Also L7-L13 in docs/BENCH-TEST.md never exercise New session or Left/Right with two sessions.

Status: fixed on work/qa9-live (see docs/DECISIONS.md "QA round 9")
