---
id: qa-20261122-09
title: Line 3 cuts a short command at 40% of the width although there is no output and the rest of the line is empty
severity: minor
area: view
how to reproduce: |
  PreToolUse Bash {"command":"psql -f migrate.sql"} (no PostToolUse yet), then PreToolUse Read of any file in the
  same session (or a subagent's Read, see qa-20261122-02).
expected: |
  `$ psql -f migrate.sql` in full; the 40% cap matters only when an output line shares the row.
evidence: |
  Emulator: line 3 `$ psql -f mig…` and about 60% of the line blank (/tmp/qa2-shots/k-03-sub2-reads-a-file.png).
  `#cmdbox { max-width: 40% }` applies whether or not `#output` is empty. Same pattern as round-1 issue 07 (MCP
  tool name), which was fixed for line 2 only. With output present the cap is reasonable (`$ pnpm --filt… → FAIL
  src/reconciliatio…`, g-long-03).
---
