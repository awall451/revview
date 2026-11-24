---
id: qa-20261124-r10-00
title: QA round 10 report: emulator/run.sh --live with a real Claude Code, at work/live-gaps c75f36e
severity: polish
area: emulator/run.sh --live, docs/EMULATOR-LAPTOP.md, docs/BENCH-TEST.md L7-L15
reproduce: worktree of work/live-gaps (c75f36e), npm ci --ignore-scripts (only for Playwright), run.sh --live --no-browser on /tmp/qa10-proj, page in headless Chromium 1280x400 (Playwright), prompts via tmux send-keys on the printed socket
evidence: screenshots and driver logs were in /tmp/qa10-tools (removed with the round); quoted values below
---
Setup. The build VM has no DISPLAY, so the page ran in Playwright's headless Chromium at 1280x400 against
`--no-browser`. The close-window path used a wrapper that ran the same Chromium as `REVVIEW_BROWSER` with
`--headless=new`. The real `claude` started as 2.1.330. Its own updater installed 2.1.331 during the first
(not-signed-in) run, so every signed-in run below used 2.1.331, and `claude --version` now says 2.1.331. BENCH L7
names 2.1.330. Sign-in: the agent shell scrubs the token, so runs used /etc/agent-kit/auth.env with the agent's
CLAUDE* variables unset (like an owner's terminal). Real-Claude use: 5 short turns in all. tools/check was not run
(cost rule; run once on this branch already).

1. First session STARTING: held. /state view "starting" 0.5 s after start. With the trust question unanswered, no
   hook came and the bar turned UNKNOWN "No events from this session yet" at 30.7 s (screenshots looked at: STARTING
   grey with "Not ready for voice yet", UNKNOWN cyan). In a trusted folder STARTING lasted ~0.5 s, then WAITING FOR ME.
2. Early exit: held. Stand-in that exits at once: "Claude exited at once ...", exit 1 in 0.23 s. Sleep 2 s then exit:
   "Claude exited within 10 s of starting ...", exit 1 at 2.3 s. Sleep 15 s: no message, run kept serving until INT
   (exit 0), bar UNKNOWN "qa10-proj ended" (same on gate/main). Real claude, trust answered "No, exit" at 2 s: the 10 s
   message, exit 1. Leftovers after each: none (no process of the run, no temp dir, no pid file or pid dir).
3. Whole task with the real Claude: held. "create hello.txt ... then cat": WORKING -> "Write hello.txt" -> "Bash $ cat
   /tmp/qa10-proj/hello.txt / hello from qa10" with +1 −0 -> DONE, in 6.6 s. hello.txt = "hello from qa10\n". Recomputed
   by hand: Write of 1 line = +1 −0, correct. A Bash `echo >> hello.txt` shows no diff (by design: only PostToolUse
   counts, src/state/README.md). No permission prompt came, see r10-02.
4. Permissions (after shift+tab to manual mode): held. Allow: NEEDS PERMISSION "Bash $ echo allowed >> hello.txt".
   Enter at 0.1 s gave "Too early: press again" and nothing reached Claude. Enter at 2.5 s: the pane said "Allowed by
   PermissionRequest hook", the line was appended, and the bar showed DONE. Deny: N at once gave "Too early", N
   after 2.4 s: the pane said "Not run · permission denied / Reason: Denied with the wheel button", hello.txt unchanged,
   and the bar showed DONE with "Denied: Bash".
5. Menu New session with the real Claude: held. M, Enter, Enter: the bar showed STARTING 2/2, then WAITING 2/2.
   `list-windows` showed revview:0 and revview:1, both claude, each with its own @revview_id. Left 1/2, Right 2/2,
   Left 1/2. The two sessions in the same folder look the same apart from n/2 (not filed).
6. Stop paths with the real Claude: `--stop` (exit 0, "stopped (pid N)"), TERM, HUP, Ctrl+C (INT to the process
   group), closing the window (exit 0): all exit 0 within 0.12 s. The private tmux server, temp dir, pid file and pid
   dir were gone. The claude ended 0.5-0.7 s after run.sh (r10-04). Nothing of the run was left after 1 s. Other users'
   claude/tmux/node processes (other agents' tests under /tmp/emu-live-test-*) were not touched. kill -9 of run.sh:
   `--stop` says not running. The guide's ps pattern listed the node server and the private tmux server, and L11's
   pattern also listed the claude. `tmux -S <sock> kill-server` worked; the node server and temp dir were removed by
   hand as the guide says. Attach line (L10, real Claude): `script` + `tmux -S <sock> attach -t revview` showed the
   Claude Code screen; Ctrl-b d printed "detached (from session revview)"; the session stayed.
7. QA round 9 fixes, re-run:
   - r9-01 held: New session rows exist (DIR). After the only Claude ended, M, Enter, Enter started a new one (STARTING 1/1).
   - r9-02 held: both documented ps patterns match the `tmux -f /dev/null -S ...revview-emu.../tmux.sock` server after kill -9.
   - r9-03 held: "Claude exited at once ... is it signed in?" (exit 1). The cause it names is questioned in r10-01/r10-03.
   - r9-04 held: '#' in DIR, as argument or as cwd: exit 2 with "--live: DIR must not contain '#'" before anything starts.
   - r9-05 held: the guide has "Too early: press again". Seen with the real Claude for Enter and N.
   - r9-06 held: --stop with another TMPDIR says "not running" plus the stderr note, and the run stays. --stop with the run's
     TMPDIR stops it. No empty pid dir after a normal exit (an empty one stays after kill -9 + --stop; removed by hand).
8. Docs against what happened: the STARTING text (guide, L7, L14), the 10 s text (guide, L15) and the stop/attach
   text match. Not matching: r10-01 (folder trust question), r10-02 (auto permission mode), r10-03 (a not-signed-in
   Claude does not exit), r10-04 (L11's immediate ps). Nothing claims to work on a laptop or on hardware: L7-L15 are all
   `untested`, and the guide says nobody ran it on a real laptop. "None of this has been run with a real, signed-in
   Claude Code" is now out of date for the VM (this round). It stays true for a laptop.

Not checked: a real desktop window or a real laptop, WSL2, macOS. Space/push-to-talk and voice (L9). Esc tap and Esc
long hold on a real prompt or turn (L8's Esc parts). R read-aloud. Global hooks doubled (L13). An owner's own tmux
server alongside (L12). REVVIEW_PROJECTS with two folders against a real Claude. A brand-new Claude install that never
finished onboarding. The early-exit check with a browser window (only --no-browser was used for it; unit tests cover
the other).
