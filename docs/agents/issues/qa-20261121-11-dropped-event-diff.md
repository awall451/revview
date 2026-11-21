---
id: qa-20261121-11
title: An event over 1 MiB is dropped silently, so +N −N understates with nothing on screen saying so
severity: minor
area: server, view
how to reproduce: |
  In one turn POST a PostToolUse Write (create) of 123456 lines (accepted), then a PostToolUse Write
  (create) of 100000 lines of `abcdefghij` (1.1 MB body).
evidence: |
  Second POST -> 413. View keeps `Write data.csv +123k −0`; the true turn total is +223456. DECISIONS
  accepts this ("only loses one diff count"), but the number on screen is then simply wrong and looks
  exact. A Write or Edit of a file over about 1 MiB is ordinary (lock files, fixtures, generated code).
  Either count from a capped read of the body, or mark the diff as incomplete (e.g. `+123k+ −0` or `≥`).
---
