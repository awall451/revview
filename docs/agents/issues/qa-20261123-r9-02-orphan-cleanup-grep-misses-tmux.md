---
id: qa-20261123-r9-02
title: The documented grep for a leftover private tmux server (`tmux -S`) does not match it; same pattern in bench item L11
severity: minor
area: docs/EMULATOR-LAPTOP.md (Troubleshooting), docs/BENCH-TEST.md L11
---
Reproduce: `bash emulator/run.sh --live --no-browser` (stand-in claude), `kill -9` the run.sh bash only. Then run the
guide's recovery command `ps -u "$(id -u)" -o pid,args | grep -E 'tmux -S|src/server/index.js'`.
Seen: only the node server is listed. The private tmux server's argv is
`tmux -f /dev/null -S <sock> new-session -d ...`, which does not contain the string `tmux -S`, so it is not shown (and
neither is the Claude/stand-in it holds). Same pattern in BENCH-TEST L11 (`grep -E 'claude|tmux -S|src/server/index.js'`),
so that check would also miss the tmux server (it catches `claude` only if the process is named so).
The other route in the guide (`tmux -S <socket> kill-server` with the socket printed in the `attach:` line) does work and
ends the Claude; the node server then needs its own kill. After SIGKILL of run.sh + `--stop`: "not running", server,
tmux server and Claude stay (documented), temp dir stays (documented).
Expected: pattern `tmux .*-S` (or `revview-emu\.`) in both places.
Held up: SIGINT, SIGTERM, SIGHUP of run.sh, `--stop`, and SIGTERM sent 30..900 ms after start (during the tmux spawn)
all left zero processes and no temp dir.

Status: fixed on work/qa9-live (see docs/DECISIONS.md "QA round 9")
