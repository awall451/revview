# Fixtures

Canonical recorded Claude Code hook events. Unit tests replay them, and the emulator and its per-state
screenshots should use them too. There were no placeholder fixtures before these.

`sessions/<name>.jsonl`: one real hook payload per line (stdin of the hook), in recorded order.
`sessions/<name>.expected.json`: the reviewed state after each event (`tests/unit/replay.test.js`).

| Session | Shows |
|---|---|
| `working-turn` | a full turn: prompt, Read, Edit (+1 -1), Write of a new file (+3), a Bash command with ANSI-coloured output, Stop |
| `permission-prompt` | a Bash command that needs permission: PermissionRequest, Notification `permission_prompt`, approval, Stop, Notification `idle_prompt` |
| `idle-prompt` | a turn without a prompt, Stop, then Notification `idle_prompt` |
| `subagent-permission` | two async subagents in one message; A's Bash needs permission (PermissionRequest with `agent_id`, no `tool_use_id`), B reads three files and runs `ls` meanwhile, the main turn Stops (`background_tasks` running), B's `<task-notification>` prompt, a late `permission_prompt` Notification, approval 45 s later, A's notification turn, Stop, `idle_prompt` |
| `permission-interrupted` | a main-thread prompt rejected with Esc (no Post, Stop or PermissionDenied follows), the driver's next prompt starts a subagent whose Bash prompt is approved after the main Stop |
| `compaction` | auto compaction twice in the middle of a turn (PreCompact `auto`, SessionStart `compact`, PostCompact) with `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=1`, then `/compact` at the prompt (`manual`), then one more turn |
| `ask-question` | `AskUserQuestion` in acceptEdits mode: a question answered (PreToolUse, PermissionRequest, Notification `permission_prompt`, PostToolUse), a call with two questions answered, a third question dismissed with Esc (nothing fires afterwards until SessionEnd) |
| `ask-bypass` | the same under `bypassPermissions`: the PermissionRequest still fires; question answered, Stop, SessionEnd |
| `plan-approve` | plan mode: `ExitPlanMode` (PreToolUse, PermissionRequest, Notification `permission_prompt`) rejected with Esc (nothing fires, the driver's next prompt follows), a second plan approved (PostToolUse with `tool_input {}`), Write, Bash, Stop, `idle_prompt` |
| `plan-feedback` | plan mode: "Tell Claude what to change" with text arrives as a plain `UserPromptSubmit` with the text; the revised plan is then dismissed with Esc (nothing fires), SessionEnd |
| `task-list` | the task tools of Claude Code 2.1.332 in acceptEdits mode: ToolSearch, four `TaskCreate` (each with a `TaskCreated` event), then per task `TaskUpdate` `in_progress` and `completed` (the latter with `TaskCompleted`) between Bash commands, Stop, SessionEnd. Also `PostToolBatch` and `MessageDisplay` |

The four ask/plan recordings (`ask-question`, `ask-bypass`, `plan-approve`, `plan-feedback`) were recorded on 2026-11-25 with Claude Code 2.1.331 (model haiku) in `/tmp/rec/repo` with its own `CLAUDE_CONFIG_DIR`, driven by a pexpect script through a pty; nothing was changed in them. They also contain `PostToolBatch` (new, ignored by the state core).

The first three were **recorded on this VM with Claude Code 2.1.330** (model haiku) on 2026-11-21, in a throwaway
repo under `/tmp`, with a hook on every event appending its stdin as a JSON line. Changed afterwards: only
`/home/agent/` -> `/home/user/`. Nothing here is hand-written; shapes that are only known from the package
source are listed in `docs/DECISIONS.md`.

To record more: in a scratch repo (not this one), give each hook event a command hook that appends stdin to
a file, e.g. `node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>require("fs").appendFileSync(process.argv[1],JSON.stringify(JSON.parse(s))+"\n"))' /tmp/events.jsonl`,
then run `claude -p ... -- "<prompt>"` (headless) or an interactive `claude --permission-mode default` in a
pty for Notification events (permission and idle prompts are interactive only). Use a separate
`CLAUDE_CONFIG_DIR` for interactive runs so onboarding and folder trust stay out of the real config.
Copy the file here, sanitise, then `REVVIEW_UPDATE_EXPECTED=1 npm run test:unit` and review the new
`.expected.json` before committing.

The last three were recorded the same way on 2026-11-22 (Claude Code 2.1.330, model haiku; the subagents ran
on the default subagent model), in `/tmp/rec/repo` with its own `CLAUDE_CONFIG_DIR`, driven through a pty by a
pexpect script that sent keystrokes (Enter to approve, Esc to reject) and waited for hook events in the file.
Nothing was changed in them (the paths are already under `/tmp`); nothing is hand-written.

`task-list` was recorded on 2026-11-26 with Claude Code 2.1.332 (model haiku), interactive in a pty (pexpect) in `/tmp/rec-tasks/repo` with its own `CLAUDE_CONFIG_DIR`, with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` (without it haiku found no task tool); a hook on every hook event name known to the binary; nothing was changed in it.
