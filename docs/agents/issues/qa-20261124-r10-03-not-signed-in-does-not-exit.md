---
id: qa-20261124-r10-03
title: Docs say a not-signed-in Claude exits at once (or within 10 s); the real one stayed up, the bar showed WAITING and then "Turn failed: authentication failed"
severity: minor
area: docs/EMULATOR-LAPTOP.md (Troubleshooting "Claude exited ..."), docs/BENCH-TEST.md L15, docs/DECISIONS.md "Live emulator gaps (cycle 36)", emulator/run.sh message
reproduce: |
  Real claude 2.1.330 with no credentials in its environment (no OAuth token, no ~/.claude/.credentials.json;
  onboarding already done in ~/.claude.json): bash emulator/run.sh --live <trusted dir>; send a prompt via tmux.
evidence: |
  The run did not end. 7.4 s: WAITING FOR ME (SessionStart arrived). After the prompt the pane said
  "Not logged in · Please run /login" and the bar (screenshot) showed WAITING FOR ME, "Turn failed: authentication
  failed", "Not logged in · Please run /login". No "Claude exited" message; run.sh ran on until stopped (exit 0).
---
The guide's Troubleshooting says "The usual cause is that it is not signed in". BENCH L15 starts with "A first-run
`claude` that is not signed in ...: prints Claude exited at once ...". DECISIONS (cycle 36) says the 10 s window
"catches a not-signed-in ... quit". The only real early exit seen this round was answering the folder-trust question
with its default "No, exit" (r10-01). A Claude that is simply not signed in started, sent its hooks and failed only
on the first turn. The bar shows that failure clearly, which is good, but it is not what the docs predict.

Not checked: a brand-new install that has never finished onboarding (it may show a login screen and wait, which
would look like STARTING -> UNKNOWN, as in r10-01).

Expected: write down what was seen (not signed in = the run goes on, the bar says "Turn failed: authentication
failed"), mark the brand-new-install case as unchecked, and name the trust question as a known cause of the early
exit instead of the sign-in.
