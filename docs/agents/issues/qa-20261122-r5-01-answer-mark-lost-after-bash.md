---
status: closed (2026-11-22, work/qa5-fixes: the answer is tied to the answered request; "Denied/Allowed: <tool>" for any tool after an earlier Bash, showing the answered call only; not yet re-run by QA)
id: qa-20261122-r5-01
title: The Allowed/Denied mark (r4-04 fix) never shows for a non-Bash request when a Bash command ran earlier in the turn; the denied Edit then reads as done, with the old command's "2 passed" under it
severity: major
area: board (`answeredOf` in src/state/board.js) / view tool row
how to reproduce: see Steps (gate/main adedbbd, dev server on 8310, real tmux on a private TMUX_TMPDIR, stand-in claude)
evidence: /tmp/qa5-shots/r6-01-after-deny-edit.png, /tmp/qa5-shots/r6-02-deny-edit-stop.png, /tmp/qa5-shots/r7-after-bash-allow.png, contrast /tmp/qa5-shots/r7-no-bash-deny.png and /tmp/qa5-shots/r4-deny-04-stop.png (script /tmp/qa5-scripts/r6.mjs, r7.mjs)
---

## Steps

1. `node src/server/index.js 8310 --dev-bridge --sessions ...` with one revview tmux window (session `beta-web`), selected.
2. Post, re-targeted from `fixtures/sessions/working-turn.jsonl`: line 2 (driver UserPromptSubmit), lines 9-10
   (PreToolUse/PostToolUse Bash `git -c color.ui=always diff --stat && printf ...`, output "2 passed in 0.01s").
3. Post PreToolUse Edit `src/app.py`, then POST the matching PermissionRequest (Edit, same tool_input) to `/permission`
   as the hook does. The bar shows NEEDS PERMISSION, `Edit src/app.py`, no command (round 3 fix holds).
4. Wait 2.2 s, tap deny (F16). The long poll returns `{"behavior":"deny",...}`.
5. Post `Stop` (line 11).
6. Repeat with press (allow) instead of deny.

## Seen

- After deny: blue WORKING, row `Edit src/app.py`, then `$ git -c color.ui=always diff --stat && ...` and its 3
  output lines ending "2 passed in 0.01s". No "Denied:". `/state` has `answered: null`.
- After Stop: green DONE, same rows. It reads "Claude edited app.py, tests passed, finished".
- After allow: also `answered: null`, no "Allowed:".
- Same steps without the Bash call in step 2: "Denied: Edit" shows (`answered: "deny"`), so the fix works only when
  no Bash ran earlier in the turn. With a Bash request (r4-04's exact case) it works too (r4-deny-04-stop.png).

## Cause (read, not changed)

`answeredOf` requires `s.command === a.command`. The answered entry's command is null for a non-Bash request (the
round 3 fix keeps commands out of non-Bash prompts), while the session state still holds the turn's last Bash
command, so the comparison fails and the mark is dropped.

## Expected

"Denied: Edit" / "Allowed: Edit" after any button answer, whatever ran before, and after a deny the old command's
output should not sit under the denied call as if it belonged to it. Edit/Write after a Bash call is the common
case in a real turn, so r4-04 (major) is not closed for most requests.
