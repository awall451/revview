---
status: closed (2026-11-22, work/core-small-14: New session rows show MISSING, project rows lead with the folder name; not yet re-run by QA)
id: qa-20261122-r5-07
title: New session project list does not mark a folder that does not exist; the refusal comes only after choosing it
severity: cosmetic
area: view list (`new`) / projects
how to reproduce: `--projects` file with `/tmp/qa5-run/repos/does-not-exist`; menu > New session
evidence: /tmp/qa5-shots/r3-02-project-list.png, /tmp/qa5-shots/r3-05-refused-start.png
---

The row looks like the others. Choosing it gives the new note "New session not started: project folder missing"
(r4-03 fix holds), and the bar stays on the old session. Marking the row (or leaving it out) would save a gesture.
Also: rows show the full path for short names but a middle-cut base name for the long one, so rows are not alike.
