---
id: qa-20261123-r9-06
title: --stop from a shell with a different TMPDIR says "not running" while a --live run (server, tmux, Claude) is alive; empty pid dir left after exit
severity: polish
area: emulator/run.sh --stop, docs
---
Reproduce: shell A: `TMPDIR=/tmp/x bash emulator/run.sh --live --no-browser` (XDG_RUNTIME_DIR unset, as over ssh).
Shell B (TMPDIR unset): `bash emulator/run.sh --stop` -> `not running`, exit 0; the run, its tmux server and the Claude
stay. `TMPDIR=/tmp/x bash emulator/run.sh --stop` -> `stopped (pid N)`. With --live the cost of missing is a live,
signed-in Claude session left running. The help text lists the places --stop looks, but not that a run's TMPDIR must be
the same, and the guide's "run.sh --stop from another terminal" does not warn.
Also: after every exit (all paths) `$TMPDIR/revview-emu-<uid>` (empty, mode 700) remains, so "all of it is gone after exit"
is true for the run's own temp dir only.

Status: fixed on work/qa9-live (see docs/DECISIONS.md "QA round 9")
