---
id: qa-20261124-r10-04
title: run.sh returns before the real Claude has ended (0.5-0.7 s, reparented to pid 1), so bench L11's immediate ps shows a claude
severity: polish
area: emulator/run.sh cleanup, docs/BENCH-TEST.md L11, docs/EMULATOR-LAPTOP.md (Stopping)
reproduce: |
  Real signed-in claude, session at WAITING. Stop the run by each path, then poll `kill -0 <claude pane pid>` every
  0.1 s right after run.sh has exited.
evidence: |
  --stop: run.sh gone after 0.12 s, claude alive at that moment, gone ~500 ms later. TERM: same, ps showed
  "<pid> 1 claude --settings /tmp/revview-emu.pOw0WJ/claude-settings.json --session-id ..." (ppid 1).
  Ctrl+C (INT to the process group): ~600 ms. HUP: ~700 ms. Close window (headless chromium killed): ~500 ms.
  Each time: socket and temp dir already removed, nothing left after 1 s.
---
Every stop path does end the Claude, but in the background, after run.sh has already returned. L11 says "After each:
`ps ... | grep -E 'claude|...'`" and expects nothing. Run at once, as the owner will, it lists a `claude` whose
parent is pid 1 and whose `--settings` file no longer exists. That looks like a leak, though it is not one.

Expected: either run.sh waits (up to a few seconds) for the pane processes of its tmux server to end before it
returns, or L11 and the guide say "wait a second, then check".

Status: fixed on work/live-gaps (see docs/DECISIONS.md "Live emulator gaps (cycle 36)")
