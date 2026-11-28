# Task-progress recordings (cycle 81, owner issue #38)

Real Claude Code sessions for the `tasks n/m` count on the bar. They sit in this subdirectory so that nothing that
enumerates `fixtures/sessions/*.jsonl` (replay, server and long-run tests) counts them; `tests/unit/board-tasks.test.js`
replays them by name.

Recorded on 2026-11-28 on this VM with Claude Code 2.1.332, interactive in a pty (pexpect, 160x50), `--permission-mode
acceptEdits`, `--model <id>` on the command line, each session in its own throwaway directory `/tmp/rec-tp/<name>` with its
own `CLAUDE_CONFIG_DIR`, a command hook on every hook event name known to the binary appending its stdin as one JSON line.
Nothing was changed in the events (the paths are already under `/tmp`; no home path, account or token data in them).

`<name>.times.jsonl` (where present): one line per event, same order, `{ms, hook_event_name}`, the hook's receive time
in ms since the session's first event (the same hook wrote both files; the names match line by line).

| Recording | Model | `CLAUDE_CODE_ENABLE_TODO_TOOLS` | What it shows |
|---|---|---|---|
| `compact-haiku` | `claude-haiku-5-5` | 1 | list of 3, first done, `/compact` (PreCompact `manual`, SessionStart `compact`, PostCompact), then TaskUpdate 2 and 3 to completed with the same ids: the list lives on across compaction |
| `delete-two-lists-haiku` (+ times) | `claude-haiku-5-5` | 1 | list of 3, `TaskUpdate {taskId:"3", status:"deleted"}` (Post `updatedFields ["deleted"]`, `statusChange {from:"pending", to:"deleted"}`, no TaskCompleted), 1 and 2 completed (screen: `2/2 tasks done`); a second prompt, TaskCreate "4" 15 s after the last completion, then "5" (the numbering goes on); the screen's list then holds only d (then d and e): the old list is gone |
| `delete-two-lists-sonnet` | `claude-sonnet-5-5` | 1 | the same prompts, the same events; also a `TaskList` call after the first list (`tool_response.tasks` lists 1 and 2 completed, 3 gone) |
| `add-after-done-haiku` (+ times) | `claude-haiku-5-5` | 1 | list of 2 completed, task "3" created 0.5 s later in the same turn; a second prompt "add one more task to your task list": id "4" 18 s after the last completion, the screen's list holds only that task |
| `add-after-done-sonnet` (+ times) | `claude-sonnet-5-5` | 1 | the same (task "3" 0.2 s after the completion; screen `3/3 tasks done`, then after the second prompt `1/1`) |
| `no-switch-haiku` | `claude-haiku-5-5` | unset | asked to use its task tool: ToolSearch `task list create update` finds no TaskCreate (only TaskStop), the files are written without a list |
| `no-switch-sonnet` | `claude-sonnet-5-5` | unset | the same |

Prompts (`<files>` as in the table): "Use your task tool to make a task list with 3 steps: create a.txt, b.txt, c.txt, each
containing its letter (use the Write tool, no Bash). ..." followed by "Do only the first step now, mark it completed, then
stop and wait for me." / "Then delete the c.txt task from the list (we do not need it), and do the other two, marking each
completed." / "Then do them one by one, marking each completed."; second prompts "Continue with the remaining tasks of your
task list, marking each completed." (after `/compact`), "New job: make a new task list with 2 steps: create d.txt and e.txt
(Write tool), then do them, marking each completed.", "Now add one more task "create d.txt" to your task list and do it,
marking it completed." The add-after-done first prompt: "... task list with 2 steps: create a.txt and b.txt ... Do both,
marking each completed. Right after the last one is completed, without stopping, add a third task "create c.txt" to the
list and do it too, marking it completed."
