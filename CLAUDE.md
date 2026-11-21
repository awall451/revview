# Project notes

A new project. The goal is in the charter (`/opt/agent-kit/CHARTER.md`); the owner's plan and design are
in `docs/`.

Checks: `bash tools/check /tmp/check-out`. The gate runs the same script on a fresh checkout (see
`/opt/agent-kit/GATE-CONTRACT.md`). Until the stack is chosen it only runs `tests/*.sh`.

Network goes through an allow-list proxy (the environment variables are set). Most documentation sites are
not reachable: read the installed package source instead of guessing an API.

## Agent team

This repo is developed by an autonomous agent team (a lead, area leads and their
workers;
`.claude/agents/area-lead-*`, `builder`, `scout`). Binding rules live outside the repo, read-only:
`/opt/agent-kit/CHARTER.md` and `/opt/agent-kit/GATE-CONTRACT.md`.
Team notes: `docs/agents/` (STATE.md, JOURNAL.md, ESCALATIONS.md, issues/).
Work reaches main only through the gate: `ready/<topic>` branches, `gate-status`.
Playwright browsers are preinstalled at `$PLAYWRIGHT_BROWSERS_PATH`; do not run `playwright install`.
A job the team installs for itself that runs Claude must load the same sign-in as the lead:
add `EnvironmentFile=-/etc/agent-kit/auth.env` to its unit (the file exists only when a token is stored).
Nobody here can push to a remote repository. If the project is published, the lead asks with
`owner-publish request` and the owner's console pushes the gate's `main` (`owner-publish status`).
