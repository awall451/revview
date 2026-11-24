---
id: qa-20261124-r10-02
title: With Claude Code 2.1.330/2.1.331 the default permission mode is "auto": a plain task never shows NEEDS PERMISSION, so the guide's Enter/N and bench L7, L8, L14 cannot be done as written
severity: minor
area: docs/EMULATOR-LAPTOP.md (Live: "The keys act on that session"), docs/BENCH-TEST.md L7, L8, L14
reproduce: |
  bash emulator/run.sh --live <trusted scratch dir>; send "Create a file hello.txt containing the single line: hello
  from qa10. Then run: cat hello.txt", then "Append ... using a shell command (echo with >>)", then "Run the shell
  command: date -u > when.txt" (tmux send-keys on the printed socket). Watch /state and the page at 1280x400.
evidence: |
  Pane footer at start: "⏵⏵ auto mode on (shift+tab to cycle)"; the welcome note "Auto mode is now Claude Code's
  default permission mode ... runs the ones it assesses as lower-risk". All three turns: working -> Write hello.txt ->
  Bash `cat ...` (output "hello from qa10", +1 −0) -> DONE, and Bash `date -u > when.txt` ran. NO permission view at
  any point. After shift+tab (one press: "⏸ manual mode on") the same kind of command showed NEEDS PERMISSION at once.
  The shift+tab cycle seen: auto -> manual -> accept edits -> plan -> auto.
---
BENCH L7 says "ask Claude to run a command that needs permission and the bar shows NEEDS PERMISSION". L8 and L14
assume a prompt comes up too, and the guide says "Enter (a tap) answers a shown permission prompt". With the Claude
Code on this machine, an ordinary write or shell command does not ask: auto mode decides on its own. An owner who
follows L7/L8 will see no prompt and may think the PermissionRequest hook is broken.

Expected: the Live section and L7/L8/L14 say that Claude Code's permission mode decides whether prompts appear. To try
Enter/N, switch the session to "manual mode" with shift+tab in the attached window first. Name the version this was
seen with.

The keys themselves work once a prompt shows (see the round report): Enter allowed, N denied, "Too early" held.
