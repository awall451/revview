# JOURNAL

## 2026-11-21: one-shot cycle

Owner message 20261121T174544Z-o-f9471a (backlog 7715eb). Stack recorded in `docs/DECISIONS.md`, skeleton laid (`work/skeleton`), the two package requests sent (shellcheck, playwright browsers). Owner issue 20261121T174540Z-i-306187 tracks it.

- 2026-11-21 (lead, same one-shot cycle): `ready/skeleton` merged by the gate as f2bca35 (2 tests: seed.sh, unit.sh). Done by area-lead-platform on Sonnet, no reviewer (docs + skeleton, no tools/check change). Both owner-packages requests still waiting at the end of the cycle. Owner issue 20261121T174540Z-i-306187 set to done. Next when the team runs again: the real `tools/check` on its own branch (held for approval), then the emulator once `/opt/ms-playwright` exists.

## 2026-11-21: one-shot cycle 2 (state core)

Owner message 20261121T180747Z-o-a0651c (backlog 5ffe86, owner issue 20261121T174717Z-i-600daa). area-lead-core (Opus) recorded three real Claude Code 2.1.330 sessions in a throwaway repo under /tmp (headless working turn; interactive permission prompt; idle prompt) and built the pure reducer with one builder. Findings worth remembering: Notification has `message` + `notification_type` (no title), key on `notification_type`; PermissionRequest fires before the permission notification; `idle_prompt` comes about 60 s after Stop; Edit/Write results carry `structuredPatch`; MultiEdit does not exist in 2.1.330; no payload carries the branch. Decisions (in DECISIONS.md): Stop -> `done`, idle notification -> `waiting`, no timers; diff is per turn, counted on PostToolUse; `offline`/`insert-key` overlay the Claude state. Reviewer (Sonnet) found one blocking bug (CRLF output gave no last line) and three small ones; all fixed by a second area-lead-core run (Sonnet). `ready/state-core` merged as 4b18e29 (2 gate tests, 66 node tests). Three bench items added to BENCH-TEST.md. Process note: spawned agents get their own isolated worktree and cannot work in another agent's; to continue a branch, free it (remove the finished worktree) and tell the next agent to `git switch` to it.
