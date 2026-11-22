---
id: qa-20261122-06
title: SessionStart with source "compact" (auto-compaction during a turn) switches the bar to WAITING FOR ME while Claude keeps working
severity: minor
area: state (reducer)
how to reproduce: |
  session_id s1, cwd /home/user/src/revview: SessionStart startup; UserPromptSubmit; PreToolUse Edit a.js (e1);
  PostToolUse Edit (e1); PreCompact {"trigger":"auto"}; SessionStart {"source":"compact"}.
expected: |
  WORKING stays (compaction is part of the running turn); only startup/resume/clear mean "at the prompt".
evidence: |
  Reducer output: after PostToolUse `working Edit +1 −1`; after SessionStart compact `waiting Edit +1 −1`, until the
  next tool event. `patchFor` maps every SessionStart to `{ activity: 'waiting' }` regardless of `source`. The
  2.1.330 binary's SessionStart input schema has `source: ["startup","resume","clear","compact","fork"]` (strings in
  ~/.local/share/claude/versions/2.1.330). That SessionStart(compact) fires after auto-compaction in the middle
  of a long turn is from the Claude Code hooks documentation as I remember it (not reachable here, not recorded);
  it should be recorded before deciding. A long agentic turn is exactly when auto-compaction happens, and the
  model call after it can take tens of seconds, all shown as WAITING FOR ME.
---
