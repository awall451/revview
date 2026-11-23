---
id: qa-20261123-r9-03
title: --live: a claude that exits at once gives "the server stopped while starting" with a tmux error and loses claude's own message
severity: minor
area: emulator/run.sh --live, src/sessions/runner.js
---
Reproduce: put a `claude` first on PATH that prints "not signed in" to stderr and exits 1 (stand-in only), then
`bash emulator/run.sh --live --no-browser --port 38130`.
Seen (exit 1, ~1 s):
```
run.sh: the server stopped while starting
sessions: Command failed: tmux -f /dev/null -S .../tmux.sock set-option -w -t @0 @revview_id <uuid>
no server running on .../tmux.sock
```
Claude's own error text is gone (the tmux window closes with the process), and the message does not say Claude exited.
Nothing is left over (checked: no process, temp dir removed).
Expected: say "Claude exited at once; run `claude` once in a normal terminal (is it signed in?)". The guide's
Troubleshooting has no entry for this, the most likely first-run problem on a laptop.

Status: fixed on work/qa9-live (see docs/DECISIONS.md "QA round 9")
