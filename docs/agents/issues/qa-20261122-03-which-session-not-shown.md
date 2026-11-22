---
id: qa-20261122-03
title: With +N, WAITING FOR ME and NEEDS PERMISSION never show which repo needs the driver
severity: minor
area: view (band)
how to reproduce: |
  Render each state through the live server's static mode, e.g.
  http://127.0.0.1:8138/?state={"view":"waiting","activity":"waiting","repo":"revview","others":1,...}
  for repo names api, infra, webapp, revview, dotfiles, frontend, my-repo, with others 0 and 1.
expected: |
  When more than one Claude is open, the state that asks the driver to act names the session (repo), since voice
  goes to whichever terminal has focus (DECISIONS known limits).
evidence: |
  Measured `#where` in the emulator:
  - waiting, no +N: only `api` and `infra` are shown; `webapp` (6 chars) and longer, including `revview`, are hidden;
  - waiting with +1: hidden for every name, even `api`;
  - permission: hidden for every name, with or without +N;
  - working/done: all shown.
  So in exactly the two states where the driver must act and another session exists, the bar shows
  `NEEDS PERMISSION +1` or `WAITING FOR ME +1` and nothing else that tells the sessions apart (screenshots
  /tmp/qa2-shots/d-15-C-start.png, d-18-B-post-Bash-approved.png). Line 2/3 may carry the command, but not when
  the waiting session has no tool yet (d-18: both lines empty).
---
