# Button recordings (interrupt, permission answer by hook, background sessions)

Recorded on this VM with Claude Code 2.1.330 (model haiku), 2026-11-22, in a throwaway repo `/tmp/rvbtn-repo`
with a private tmux server (`tmux -L rvbtn`, 150x45 panes), a separate `CLAUDE_CONFIG_DIR=/tmp/rvbtn/cfg`
(copy of the earlier recording config; auth came from the agent-kit auth env file, which is not copied here)
and a project `.claude/settings.json` with a logging command hook on SessionStart, UserPromptSubmit,
PreToolUse, PostToolUse, PermissionRequest, PermissionDenied, Notification, Stop, SubagentStop, SessionEnd,
PreCompact. Nothing is hand-written. Sanitised: `/home/agent/` -> `/home/user/`; no token, e-mail, account or
org id (grepped). Session ids are the random ones. Not read by tests (`tests/unit` reads only
`fixtures/sessions/`).

`events-*.jsonl` are hook stdin, one JSON per line (`hook.sh` appends them). `pane-*.txt` are
`tmux capture-pane -p` with blank lines dropped and a `# captured HH:MM:SS` header line (UTC wall time).
Tools: `hook.sh` (logger), `mkset.py` (writes the settings; args: wait-hook timeout in seconds or `none`,
then `wait`), `permhook.sh` (the waiting hook: polls `/tmp/rvbtn/answer` every 0.2 s up to 60 s, then prints
the allow or deny decision JSON), `permhook-log.txt` (its timestamps for the c/d runs; only the last run's lines).
A prompt of the form `Run <cmd> with the Bash tool, nothing else.` was typed with `send-keys -l`, then `Enter`.
The long command was `node -e "setTimeout(()=>{},40000)"` (allowed by `Bash(node:*)`).

## (a) Esc mid-turn
- `events-a0-failed-sleep-blocked.jsonl`, `pane-a0-1-sleep-blocked.txt`: FAILED attempt. With
  `sleep 30; echo done` the harness blocked the foreground long sleep and Claude re-ran it as a background
  task, so the turn ended before Esc. Nothing learned except to use the node timer.
- `events-a-esc.jsonl`, `pane-a-1-before-esc.txt` (about 7 s into the tool), `pane-a-2-after-esc.txt` (2 s
  after `send-keys Escape`), `pane-a-3-next-prompt.txt` (`say hi` afterwards).
  Result: Esc stops the turn at once; the pane shows `Interrupted · What should Claude do instead?` and
  `No result recorded for 1 call`. Hook events: SessionStart, UserPromptSubmit, PreToolUse and then nothing:
  no PostToolUse, no Stop, no PermissionDenied. The session stays usable: the next prompt ran normally
  (UserPromptSubmit, Stop).

## (b) Ctrl+C mid-turn
- `events-b-ctrlc-once.jsonl`, `pane-b-1-ctrlc-once.txt`, `pane-b-2-ctrlc-once-3s-later.txt`: one `C-c` 8 s
  into the tool. Result: same as Esc (Interrupted, no Stop, no Post); the session did not exit.
- `pane-b-3-ctrlc-twice.txt`: two `C-c` 0.4 s apart mid-turn. Result: the first interrupts, the second
  (now at the empty prompt) did nothing visible; no exit.
- `pane-b-5-ctrlc-idle-twice.txt`: two `C-c` about 4 s apart at the idle prompt: no exit (the "press again"
  window had expired; the capture of the first press, `pane-b-4`, was not kept because the hint was not on screen).
- `pane-b-6-ctrlc-idle-first-of-fast-pair.txt`: at the idle prompt, `C-c` shows `Press Ctrl-C again to
  exit` in the footer; a second `C-c` 0.3 s later exited claude (the tmux session was gone) and the hook fired
  SessionEnd. `events-b-ctrlc-twice-and-idle-exit.jsonl` holds this run (UserPromptSubmit, PreToolUse,
  SessionEnd).

## (c) PermissionRequest answered by a waiting hook (`date > out.txt`, not on the allow list)
- `events-c1-hook-timeout5.jsonl`, `pane-c1-1-hook-waiting-3s.txt`, `pane-c1-2-after-timeout-8s.txt`,
  `pane-c1-3-after-terminal-1.txt`: wait hook with `"timeout": 5` that never answered. Result: the permission
  dialog (`Do you want to proceed? 1. Yes ... 4. No`) is already on screen 3 s in, while the hook waits, and
  is still there after the 5 s timeout. The timeout killed the hook (`permhook-log.txt` has no "gave up" line):
  no denial, no auto-allow, the dialog just stays. Sending `1` in the terminal approved it: PostToolUse, Stop,
  `out.txt` written. Events: PreToolUse, PermissionRequest, Notification, PostToolUse, Stop.
  Default timeout (no `timeout` field) was not measured; read the source.
- `events-c2-d-d2-allow-deny-terminal.jsonl` (runs c2, d, d2 in one session, no timeout field, hook waits up
  to 60 s), `pane-c2-1-hook-waiting.txt`, `pane-c2-2-after-answer-file.txt`: `echo allow > /tmp/rvbtn/answer`
  while the dialog was shown. Result: within 1.5 s the dialog disappeared and the pane shows
  `Allowed by PermissionRequest hook`; the command ran (PostToolUse, Stop).
- `events-c1-sessionend-after-kill-server.jsonl`, `events-c2-sessionend-after-kill-server.jsonl`: only the
  SessionEnd (`reason: other`) written when I killed the tmux server at the end of those runs.

## (d) Deny by hook
- `pane-d-1-after-deny.txt` (events in the c2 file): answer `deny`, message `denied by wheel button`.
  Result: the pane shows `Reason: denied by wheel button` and `Denied by PermissionRequest hook`; no file was
  written. Claude then says it was denied, does not retry, and waits for the user. Events: PreToolUse,
  PermissionRequest, Stop; no PostToolUse and no PermissionDenied event.

## (d2) Terminal answer while the hook waits
- `pane-d2-1-after-terminal-1-while-hook-waits.txt` (events in the c2 file): while the hook was polling, `1`
  was sent in the terminal. Result: the terminal answer won at once and the command ran (`out3.txt` exists,
  PostToolUse fired). The hook was not killed: it still wrote `answer deny` to its log 5 s later (I created
  the answer file after the terminal answer); that late deny had no effect.

## (e) Background sessions
- `agents.json`: `claude agents --json` about 5 s after `claude --bg --model haiku --name btn-one '<node 60 s
  timer prompt>'` and `... --name btn-two 'say hi, nothing else'` (both in `/tmp/rvbtn-repo`, same env as
  above). Fields per entry: `pid, id` (8-char short id), `cwd, kind` ("background"), `startedAt` (ms),
  `sessionId, name, status` ("busy" | "idle"), `state` ("working" | "done"). The first `--bg` printed
  `Starting background service…`.
- `pane-e-1-attached.txt`, `pane-e-2-attached-working.txt`, `pane-e-3-attached-after-esc.txt`: `claude attach
  cba61fff` (btn-two) in a tmux pane; the footer shows the name `btn-two`. Typed the 40 s node prompt, `Enter`,
  then `Escape` 8 s later. Result: the attached session got the text and the Esc (Interrupted, no Stop in
  `events-e.jsonl`); btn-one, not attached, kept running (`claude logs` showed its own prompt and timer; that
  raw terminal log is not saved). `events-e.jsonl` holds the hook events of both sessions keyed by
  `session_id` (5015e19a..., cba61fff...), plus one SessionStart from a third session id that I did not start
  on purpose (likely a `claude` helper run by the agents commands).
- `pane-e-4-after-left-arrow.txt`, `agents-after-attach.json`: `Left` in the attached pane opens the agent
  list (btn-two `Running node script that waits 40 seconds`, btn-one `Running a 60-second Node timer`).
  After the Esc, btn-two still showed `state: "working"` (status `idle`) in the list; I did not find out
  whether its 40 s node process really kept running.
- Cleanup: `claude stop` then `claude rm` for both ids (`stopped`, `removed`); `claude agents --json --all`
  then printed `[]`.

## (f) Space on an open permission dialog (push-to-talk's key), cycle 47
Recorded 2026-11-24 with Claude Code **2.1.331** (model haiku; the banner says `Haiku 5.5`), same setup, scripts and
config dir as above (`hook.sh`, `mkset.py`, `permhook.sh` unchanged; a fresh tmux server per run, killed after). Prompt
`Run date > f1.txt with the Bash tool, nothing else.` (`f2.txt` in the second run); `date > fN.txt` is not on the
allow list, so the dialog `Do you want to proceed? ❯ 1. Yes / 2. Yes, and always allow access to /tmp/rvbtn-repo
from this project / 3. Yes, and switch to auto mode / 4. No` came up with `1. Yes` highlighted. Then ONE
`tmux send-keys Space`, captures 2 s and 5 s after it. Sanitised as above (nothing matched; the session ids are
the random ones).
- `events-f1-space-hook-waiting.jsonl`, `pane-f1-space-hook-waiting-1-before-space.txt` (2 s after the dialog
  showed), `-2-after-space-2s.txt`, `-3-after-space-5s.txt`, `-4-after-deny-file.txt`: wait hook with no
  `timeout` field, polling. Space 2 s after the dialog appeared, hook still waiting (its log: `start` only).
  **Result: Space did nothing.** The dialog stayed as it was with `1. Yes` highlighted, `f1.txt` was not written,
  no hook event followed (events: SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest). Then `deny` in
  the answer file (hook log `answer deny` 14 s after start): `Denied by PermissionRequest hook`, Stop; the
  input line was empty afterwards (cursor at column 2 right after `❯ `, the text there is Claude's dim
  suggestion), so the Space was not queued into the prompt either.
- `events-f2-space-after-hook-timeout5.jsonl`, `pane-f2-space-after-hook-timeout5-1-before-space.txt` (8 s after
  the dialog showed, i.e. after the 5 s hook timeout), `-2-after-space-2s.txt`, `-3-after-space-5s.txt`,
  `-4-after-terminal-4.txt`: wait hook with `"timeout": 5` that never answered (its log: `start` only, killed by
  the timeout as in (c)). Events before Space: ..., PermissionRequest, Notification (`Claude needs your
  permission`). **Result: Space did nothing** here too: same dialog, `f2.txt` not written, no new event. `4`
  typed afterwards answered it at once (`Did not run 1 call`, `Interrupted · What should Claude do instead?`),
  which shows the dialog was taking keys; input line empty afterwards.
- Not tried: Space with another option highlighted (after an arrow key), Space held (auto-repeat), Space during
  the dialog's first moments before it is drawn, other Claude Code versions. The source was not read for this.

# WB3 (revview-owned sessions, real hook, real server): `wb3/`

Recorded 2026-11-22 with Claude Code 2.1.330 (`--model haiku`) started by revview's real session runner
(`createSessionRunner({ socket: { path }, claude: ['claude', '--model', 'haiku'] })`, a private tmux server on a
temp socket per scenario, 150x45 windows via `resize-window`), driven by `wb3/drive.mjs` (not run by the gate or the
tests), which runs the real `startLiveServer({ devBridge: true, sessions: runner })` in-process on port 8199.
Buttons were pressed with `POST /dev/key` down/up (same gesture detector as the device: F15 cancel, F21 allow,
F16 deny, F13 push-to-talk; long-hold = 1.2 s). Prompts were typed by the harness with `tmux send-keys -l` + Enter
(it stands in for the driver's voice). The hook is the real `hooks/permission-request.mjs` with `REVVIEW_PORT=8199`,
timeout 600; a logging command hook on SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest,
Notification, Stop, SubagentStop, SessionEnd appends stdin to the events file and posts every event except
PermissionRequest to `/event`. Throwaway repo `/tmp/rvwb3/repo`, `CLAUDE_CONFIG_DIR=/tmp/rvwb3/cfg` (settings and
trust copied from the earlier config, no history; auth from the agent-kit auth env, not copied). Project settings:
`permissions.defaultMode: "default"` and allow `Bash(node:*)`. The first try of scenario 1 had no permission
dialog at all: this config's default mode is auto mode (`auto mode on` in the footer; "Auto mode is now Claude
Code's default permission mode"), the command ran with no hook; adding `defaultMode: "default"` fixed it
(that run was discarded; the panes show `manual mode on`). Sanitised: `/home/agent/` -> `/home/user/`, the repo
path of the harness is `$REVVIEW_DIR`; grepped for tokens, e-mail, account and org ids (only the words "tokens" in
Claude's own cost line and `subagent_tokens` remain). Files per scenario: `events-<name>.jsonl` (hook stdin, one
JSON per line; the SessionEnd at the end is the tmux server being killed), `pane-<name>-<n>-<what>.txt`,
`state-<name>-<n>.json` (`GET /state`), `actions-<name>.txt` (the server's stderr action lines, with `# ` lines
from the harness). Replayed by `tests/unit/wb3-recordings.test.js` (no claude, network or tmux).

- `wb3-allow-main`: `Run date > out.txt with the Bash tool, nothing else.` The bar went to `permission` and the
  dialog was on the pane. A press of allow (F21) right away did nothing: `action allow: not done
  (not-shown-long-enough)`, dialog still there (`pane-...-1-early-press.txt`). After 2 more seconds a second press:
  `action allow: done`, the pane shows `Allowed by PermissionRequest hook`, `out.txt` exists. Events: the turn also
  has an earlier PreToolUse/PostToolUse pair: haiku first ran `date >` into the session scratchpad dir (no prompt for that path), then the asked-for `date > out.txt`, which raised the PermissionRequest.
- `wb3-deny-main`: same prompt, 2 s on the bar, deny (F16): `action deny: done`; the pane shows `Not run ·
  permission denied`, `Reason: Denied with the wheel button.`, `Denied by PermissionRequest hook`; `out.txt` does
  not exist; Claude says it was denied and did not retry.
- `wb3-allow-subagent`: `Use the Agent tool once with a general-purpose subagent ... touch marker.txt && echo made`.
  First try worked. Claude backgrounds the agent (`Backgrounded agent`), the main turn ends (Stop), and the
  subagent's Bash PermissionRequest (with `agent_id`) arrives afterwards. The bar showed `permission` with the
  command, but the MAIN pane shows no dialog at all while it waits (`pane-...-1-before-allow.txt`: the footer lists
  the background agent): the hook is the only way to answer it. Press allow after 2 s: `action allow: done`,
  `marker.txt` exists, PostToolUse and SubagentStop of the agent follow and Claude reports `made`.
- `wb3-esc`: long node timer (allowed), 6 s in the pane shows `Running node script ... (6s)`, the bar was
  `working`. Cancel tap (F15): `action cancel-escape: done`, `/state` was `waiting` 300 ms later (the internal
  RevviewInterrupted; Claude fired no hook), the pane shows `Interrupted · What should Claude do instead?`.
- `wb3-ctrlc`: same, cancel long-hold: `action cancel-ctrl-c: done`, `/state` `waiting`, pane `Interrupted`, claude
  still running (listed by the runner). Second long-hold 3 s later: `action cancel-ctrl-c: not done (ctrl-c too
  soon)`, the pane did not change and the session was still alive.
- `wb3-two-sessions`: A and B started (B chosen by `start`). A ran the long command. Harness `runner.choose(B)`, cancel
  tap: only B got the Esc (B idle: pane shows only the empty prompt), A's pane kept `Running ... (7s)` and `esc to
  interrupt`. `choose(A)`, cancel: A `Interrupted`. Push-to-talk tap (F13) on A, no microphone or voice set up:
  `action push-to-talk: done`; the pane shows no message at all, only the footer line lost `? for shortcuts` (it
  reads `manual mode on`); I did not check whether a space went into the prompt. Then a permission prompt in B
  (not chosen): the bar was `permission`; allow press (F21) after 2 s: `action allow: not done (session)`, B's dialog
  still on the pane. `1` typed in the terminal approved it; PostToolUse and Stop followed; the hook process (listed
  before) was gone afterwards, the server's request ended without decision (replayed as 204).
- Not tried: a second Ctrl+C after the 5 s window, a deny in the subagent, voice recording.
- About 9 Claude turns in the final runs (haiku), plus 1 for the discarded auto mode try, 2 for an earlier subagent
  run that was repeated after fixing the harness.
