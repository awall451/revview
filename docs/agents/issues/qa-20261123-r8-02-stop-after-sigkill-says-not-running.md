---
id: qa-20261123-r8-02
title: --stop says "not running" while the server and demo player of a SIGKILLed run.sh are still alive
severity: cosmetic
area: emulator/run.sh --stop
---
Reproduce: `bash emulator/run.sh --no-browser &`, then `kill -9` the run.sh bash only.
`bash emulator/run.sh --stop` removes the stale pid file, prints `not running`, exit 0; the node server and
demo/player.js (orphans) keep running on their port. Expected: at least a mention in the guide that kill -9 / a closed
terminal that sends KILL leaves orphans which --stop cannot find. (Normal Ctrl+C, TERM, HUP are fine.)

Status: fixed in 55e4728
