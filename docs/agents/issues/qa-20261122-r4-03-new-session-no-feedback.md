---
status: closed
resolution: New session puts the window on the board and selects it at once; refused/failed starts show a fixed note
id: qa-20261122-r4-03
title: New session gives no feedback; push-to-talk stays on the old session until the new one's first hook; a refused start is silent; the folder-trust dialog is not covered
severity: major
area: actions (New session) / view / bench V3
how to reproduce: see Steps (dev server on 8140, `--projects` file with 9 entries, stand-in claude)
evidence: /tmp/qa-wb4-shots/s4-06-new-session-long-name.png, /tmp/qa-wb4-shots/s4-07-after-new-session-press.png, /tmp/qa-wb4-shots/s4-08-after-owned-poll.png, /tmp/qa-wb4-shots/s5-06-after-start-nonexistent.png
---

## Steps

1. Server with `--projects` listing existing dirs and one that does not exist (`/tmp/qa-wb4-run/repos/does-not-exist`).
   Selected session `alpha-service` (DONE).
2. Menu (F23), press on New session, down to a project, press.
3. Watch the bar for 7 s (past one `owned` poll). Tap push-to-talk.
4. Again, choosing the row of the directory that does not exist.

## What I saw

- Step 2-3: the tmux window starts (`session 42a56c67... started in @2` in the server log), the menu closes, and the
  bar is pixel-for-pixel the bar from before: `alpha-service`, DONE, mic, "1/2". Nothing says a session is
  starting. Push-to-talk still goes to `alpha-service` (the mic says so, correctly), so a driver who starts talking
  right after choosing New session talks to the old session.
- When the new session's first hook event arrives the bar jumps to it (seen with a posted SessionStart; s5-02).
- Step 4: the server logs `action new-session: not done (cwd is not an existing directory: ...)`; the menu closes
  and the bar shows nothing: same look as a successful start.

## What I expected

A visible "starting <project>…" state (or the new session shown as STARTING with a crossed mic until its first
hook) and a visible refusal ("project folder missing"). The Projects list could also mark a missing directory.

## Not covered anywhere

Starting `claude` in a folder it has never seen shows Claude Code's folder-trust question before the session runs
(the WB3 recordings pre-copied trust, `fixtures/buttons/README.md`: "trust copied from the earlier config"). I could
not run the real `claude` here, so I did not prove what happens. If no hook fires until the question is answered,
the session is never selected and no wheel button can answer it (press is not Enter). Bench V3 expects the bar
"selects the new session once its first hook event arrives" and does not mention trust. Please add a bench item or
record it.
