---
id: qa-20261122-12
title: "+11" next to NEEDS PERMISSION runs off the panel and reads "+1"; the view README says N is at most 7
severity: polish
area: view, docs
how to reproduce: |
  RevviewStarting, then for i in 0..11: SessionStart, UserPromptSubmit and PermissionRequest Bash
  {"command":"git push --force origin main"} for session_id "perm<i>".
expected: |
  The count readable in full (or capped as "8+"), and the README matching the state core.
evidence: |
  Emulator: band `▲NEEDS PERMISSION +1` with the second "1" cut at the panel edge (/tmp/qa2-shots/g-cap-02-twelve-permissions.png;
  `#others` right edge beyond 1280 px). src/state/README.md says the cap may be exceeded and "+N may have two digits";
  src/view/README.md says "Two digits would not fit next to NEEDS PERMISSION; the state core keeps at most 8 sessions
  (MAX_SESSIONS), so N is at most 7", which is false. Needs nine pending prompts, so rare, but then it is wrong by 10.
---
