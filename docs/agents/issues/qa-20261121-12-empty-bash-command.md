---
id: qa-20261121-12
title: A Bash PreToolUse with an empty command keeps the previous command and output as if current
severity: polish
area: state
how to reproduce: |
  After any Bash with output, POST PreToolUse `{tool_name: "Bash", tool_input: {command: ""}}`.
evidence: |
  Emulator shows the previous `$ echo "🚗🚀 deploy…"` and its output line unchanged. `bashCommand`
  returns null for an empty/whitespace command, so the patch has no `command` and `output` is not
  cleared. Rare, but stale output shown as current.
---
