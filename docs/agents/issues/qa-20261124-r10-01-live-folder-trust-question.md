---
id: qa-20261124-r10-01
title: --live in a folder Claude Code has not trusted yet waits on a trust question the guide never mentions; the bar only says STARTING, then UNKNOWN, and the default answer ("No, exit") gets the "is it signed in?" message
severity: minor
area: docs/EMULATOR-LAPTOP.md (Live, Troubleshooting), emulator/run.sh (early-exit message), docs/BENCH-TEST.md L7/L15
reproduce: |
  Real Claude Code 2.1.330, signed in. mkdir /tmp/qa10-proj2 (a folder never opened in Claude Code).
  bash emulator/run.sh --live /tmp/qa10-proj2 --no-browser; open the view: address at 1280x400.
  (a) answer nothing for 35 s; (b) attach and press Enter within 10 s; (c) press Enter after 30 s.
evidence: |
  tmux capture-pane of the session 1 s after start: "Accessing workspace: /tmp/qa10-proj ... Is this a project you
  created or one you trust? ... > No, exit / Yes, I trust this folder / Enter to confirm".
  (a) /state: view starting at 0.5 s, view unknown + note "No events from this session yet" at 30.7 s; no hook fired
  before the answer. (b) run.sh: "Claude exited within 10 s of starting, so there is no session. Run `claude` once in a
  normal terminal to see why (is it signed in?)." exit 1, nothing left. (c) bar: UNKNOWN, "qa10-proj ended: open the
  menu for New session", run keeps going. After "Yes" (Down, Enter) the first hook came 0.4 s later (WAITING FOR ME).
---
What the owner meets: with a folder Claude Code has never trusted, the bar shows STARTING and then UNKNOWN "No events
from this session yet". Nothing on the bar or in the terminal says that Claude is waiting on a question in the tmux
window. The page keys cannot answer it: Enter on UNKNOWN opens the session list, as r9-05 noted. The highlighted
default is "No, exit", so an owner who attaches and presses Enter ends Claude. Inside the first 10 s, run.sh then
blames the sign-in. After 10 s, the bar only says the session ended.

The guide says "Until its first hook arrives the bar shows STARTING ... at most 30 s, then UNKNOWN" and in
Troubleshooting "The usual cause is that it is not signed in or needs a first-run answer". It never names the folder
trust question, never says it must be answered with "Yes, I trust this folder" in the attached session, and never says
the default answer quits. BENCH V10 asks about this question for the Pi. Nothing on the laptop side does, although this
round saw the same behaviour in the emulator.

Expected: the Live section (and the `attach:` hint, or the UNKNOWN note for a first session) tells the owner that a
new folder asks for trust in the tmux window: attach, pick "Yes, I trust this folder". The early-exit message should
not name only the sign-in as the cause.

Status: fixed on work/live-gaps (see docs/DECISIONS.md "Live emulator gaps (cycle 36)")
