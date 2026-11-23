---
status: closed (2026-11-23, work/qa6-fixes: see DECISIONS "QA round 6b"; the log says that Claude exited, not its exit status or stderr (left, needs remain-on-exit); not yet re-run by QA)
id: qa-20261122-r6b-02
title: A key-on Claude that exits a second after starting (e.g. sign-in expired) leaves no note on the bar and no reason in the server log
severity: minor
area: server --boot / owned-window poll (src/sessions), BENCH-TEST P17, pi/README step 8
how to reproduce: (a) stand-in `claude` = `sleep 1; echo auth expired >&2; exit 1`; `REVVIEW_START=<existing folder> node src/server/index.js 8337 --dev-bridge --sessions --boot`, no revview tmux server; poll /state each second, screenshot. (b) stand-in `claude` = `echo not signed in >&2; exit 1` (exits at once), same command
evidence: /tmp/qa6b-shots/r6b-boot-claude-dies.png; server logs quoted below
---

## Seen

(a) Exits after 1 s: `/state` is `starting` (repo alpha, 1/1) for about 5 s, then `unknown`, `voice: no-session`,
`note: null`. The bar reads UNKNOWN / "Not known until Claude's next step" / "Push-to-talk does nothing: no revview
session". The whole server log about it is `session f07d6d4a-... started in @0`. Nothing says the session ended, or
why. (Compare: a New session window killed while STARTING gives the note "beta ended".)

(b) Exits at once: note "Key-on session not started: see the server log" (good), but the log says only
`boot sessions: Command failed: tmux -f /dev/null -L revview set-option -w -t @0 @revview_id ...` /
`no server running on .../revview`: a tmux error, with no hint that Claude itself exited or what it printed.

## Expected

This is the realistic key-on failure (sign-in expired, Claude update broke something). The driver sees a bar that
looks like "nothing was ever started"; the owner who reads `journalctl --user -u revview` as P17 says finds no reason
in either case. Expected: a note such as "Key-on session ended at once: see the server log", and a log line naming the
window that disappeared (and, if feasible, Claude's exit status or last stderr line, e.g. via tmux `remain-on-exit`).
P17 accepts both outcomes as passing, so the bench will not catch that the reason is missing.
