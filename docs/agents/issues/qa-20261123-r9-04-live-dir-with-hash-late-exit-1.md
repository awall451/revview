---
id: qa-20261123-r9-04
title: --live DIR containing "#" is refused only after the server started, exit 1, not like the other bad DIRs (exit 2); not in the guide
severity: polish
area: emulator/run.sh --live
---
Reproduce: `mkdir '/tmp/d#h'; bash emulator/run.sh --live '/tmp/d#h' --no-browser`.
Seen: exit 1, `run.sh: the server stopped while starting` then the server log line
`sessions: cwd must not contain "#" or control characters`. A missing DIR or a file gives exit 2 at once with the usage line.
A DIR with spaces works (cwd and tmux window correct). The same happens with no DIR argument when the current directory has a "#".
Expected: refuse in run.sh like the other bad DIRs (exit 2, "--live: DIR must not contain #") and say so in the guide.

Status: fixed on work/qa9-live (see docs/DECISIONS.md "QA round 9")
