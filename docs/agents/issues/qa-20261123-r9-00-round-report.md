---
id: qa-20261123-r9-00
title: QA round 9 report: emulator/run.sh --live at 998fb0a
severity: polish
area: emulator/run.sh --live
---
Real claude: NEVER started. Every run had /tmp/qa9/fix/shim (or another stand-in) first on PATH, `command -v claude`
checked, HOME a private empty dir, TMPDIR private; `~/.claude/settings.json` and `~/.claude.json` mtimes unchanged;
`ls -A` of the fake HOME stayed empty. `claude --version` was not run (so "Claude Code 2.1.330" in BENCH L7 is unchecked).

Ran: fresh clone at 998fb0a, no npm ci for the guide's steps (npm ci --ignore-scripts only for Playwright screenshots);
`node --test tests/unit/emulator-live.test.js` 14/14. tools/check not run (scope).
Held:
- Guide steps as written: `view:` and `attach:` lines true; `tmux -S <sock> list-windows` shows revview:0; real
  `tmux attach` through `script` attaches; hooks file mode 600 in a 700 dir with REVVIEW_PORT inherited; DIR/.claude not created.
- Bar: NEEDS PERMISSION screenshot at 1280x400 correct; keys via page and POST /dev/key: Enter allow (decision file),
  N deny, Space -> 0x20, Esc tap -> 0x1b, Esc held 1.4 s -> 0x03, R -> espeak stop/read actions, M/Enter New session,
  Left/Right route to the selected session (two sessions, per-session logs).
- Stop paths: SIGINT, SIGTERM, SIGHUP, `--stop`, SIGTERM at 30..900 ms: no leftover process, temp dir removed; own tmux
  server and its session untouched; closing the (stand-in) browser exits 0 and cleans up.
- Errors: no tmux / no claude / neither (exit 1, messages), DIR missing/file (exit 2), DIR with spaces ok, `--demo --live`
  either order (exit 2), `--live --live` ok, two simultaneous runs (own port, own socket, `--stop` stops both),
  `--port` taken (exit 1, EADDRINUSE shown, nothing left), long TMPDIR (116 bytes: clear refusal at 100; 50-char ok;
  TMPDIR with a space ok), `--port 1` (EACCES shown), kill of the server alone (run.sh exits 1, cleans tmux).
Not held: see r9-01 (major) .. r9-06.
Could not test: a real Claude (permission prompt text, push-to-talk, Esc/Ctrl+C semantics, real hook timing, global-hook
double posts L13), a real desktop browser, running inside the owner's own tmux (TMUX set), macOS/WSL2.
Doc honesty: Live section's "untested with a real claude" caveat is accurate; the `--keys` sheet matches the keymap.
BENCH L1/L4 still describe the old hook-only --live, but a note at BENCH line ~326 says so.

Status: report only; findings r9-01..r9-06 fixed on work/qa9-live
