---
id: qa-20261121-06
title: Line 3 runs the command and its output together with no separator ("$ make build make: *** No rule...")
severity: minor
area: view
how to reproduce: |
  Post a Bash PostToolUseFailure (`command: "make build"`, `error: "Exit code 2\nmake: *** No rule to
  make target `build'.  Stop."`) then a PreToolUse Edit (or a PermissionRequest for Edit).
evidence: |
  Emulator line 3: `$ make build make: *** No rule to make…` and, with pytest, `$ pytest -q FAILED
  test_auth.py::test_lo…` (/tmp/qa-shots/qa-006-line3-command-output-run-together.png). Only the
  monospace/proportional switch and a 0.4 em gap separate the command from the output; at a glance it
  reads as one long command. DESIGN puts the command and the output on separate lines. The useful end of
  the output ("assert 401 == 200") is also the part cut off. Suggest a visible separator (e.g. `→`, a
  colour or weight change) and/or giving the output priority.
---
