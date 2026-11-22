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
