---
id: qa-20261122-14
title: OFFLINE over the new looks reads "Claude: claude exited" / "Claude: unknown"
severity: polish
area: view
how to reproduce: |
  SessionStart, UserPromptSubmit, PreToolUse Edit, {"hook_event_name":"RevviewNetwork","online":false}, SessionEnd.
expected: |
  "Claude exited" / "Claude: not known", or the ended look's own notes plus the offline cue.
evidence: |
  Emulator line 2: `Claude: claude exited` (/tmp/qa2-shots/e-08-offline-end.png). view.js builds
  `Claude: ${LABELS[activity].toLowerCase()}`, which worked for the four Claude states but not for CLAUDE EXITED and
  UNKNOWN added in this round.
---
