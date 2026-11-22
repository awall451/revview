---
status: closed (2026-11-22, work/qa5-fixes: --remove writes no backup; not yet re-run by QA)
id: qa-20261122-r5b-03
title: hooks/install.mjs: when it created the settings file itself, a later run (here --remove) writes settings.json.revview-backup that holds revview's own hooks, not the user's original
severity: polish
area: hooks/install.mjs backup
how to reproduce: with an empty temp HOME: `HOME=/tmp/h CLAUDE_CONFIG_DIR=/tmp/h/.claude node hooks/install.mjs` (no file before, so no backup), run it again (idempotent, file unchanged), then `... install.mjs --remove`
evidence: after --remove: settings.json is `{}`, settings.json.revview-backup is 2824 bytes with 12 "# revview-hook" commands; both written at the same instant (19:20:30.760)
---

## Seen

The rule "the first change to an existing file copies it to <file>.revview-backup" (install.mjs line 106) also fires
on a file that install.mjs wrote itself. The only backup is then the file WITH revview's hooks. Someone who removes
the hooks and later "restores the backup" (the README offers it as the safety copy) puts all 12 hooks back.

## Expected

No backup when install.mjs created the file (there was no original), or the README says that the backup is the
state before the first change made by this tool, whatever that was.
