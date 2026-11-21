---
id: qa-20261121-07
title: Long tool names (every MCP tool) are cut to a stub "mcp__gith…" while the rest of line 2 is empty
severity: minor
area: view
how to reproduce: |
  POST PreToolUse with tool_name `mcp__github__create_pull_request_review_comment_with_suggestions`
  and no file.
evidence: |
  Emulator line 2: `mcp__gith…` then about 70% of the line blank
  (/tmp/qa-shots/qa-007-mcp-stub.png). `#tool { max-width: 28% }` applies even when there is no file.
  MCP names are always `mcp__<server>__<tool>`; the stub says neither which server nor what it does.
  Use the free width when there is no file, and/or show `<server> <tool>` instead of the raw prefix.
---
