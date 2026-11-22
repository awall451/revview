---
status: closed (fixed in 87c4235 state core, f6f7e46 view and gallery; branch work/qa-round-3)
id: qa-20261122-r3-01
title: NEEDS PERMISSION for a non-Bash tool shows the previous Bash command and its output, as if that were the request
severity: major
area: state core (board pending entry) / view
how to reproduce: see Steps (live server, page at 1280x400)
evidence: /tmp/qa-r3-shots/s01-perm-edit-after-bash/01-perm-edit.png; also the gate's own gallery shot worst-big-diff-permission.png
---

## Steps

Live server (`npm start` or any port), page open at 1280x400, POST in this order (one session `A`, cwd `/home/user/revview`):

1. `SessionStart` (source startup), `RevviewContext` (branch main), `UserPromptSubmit`
2. `PreToolUse` Bash `{"command":"rm -rf build && npm run build"}` tool_use_id t1
3. `PostToolUse` Bash, same input, t1, `tool_response {"stdout":"compiled 12 files\nwarning: x\nbuild ok\n","stderr":""}`
4. `PreToolUse` Edit `{"file_path":"/home/user/revview/src/app.py","old_string":"a","new_string":"b"}` t2
5. `PermissionRequest` Edit, same input

Scenario file: `/tmp/qa-r3-scen/s01-perm-edit-after-bash.jsonl` (driver `/tmp/qa-r3-tools/drive.mjs`).

## What happened

The amber NEEDS PERMISSION bar shows:

```
▲ NEEDS PERMISSION                              revview · main
Edit src/app.py
$ rm -rf build && npm run build
compiled 12 files
warning: x
build ok
```

The request is for an Edit of `src/app.py`. The large white command row under the amber band is a Bash
command that already ran, with its output. The same happens for any tool without a command (WebFetch, an MCP
tool, Write, a subagent's Edit). The gallery's `worst-big-diff-permission.png` shows the same pattern (Edit and
an old `$ npm run build`) and nobody has flagged it.

Cause: the pending entry takes `command`, `output` and `outputLines` from `reduce(prev, event)`, and only a
Bash request replaces `command`, so a non-Bash request inherits the session's last command (`board.js`,
`PermissionRequest` branch, and the generic `permission_prompt` entry, which copies `prev.command`).

## Expected

In NEEDS PERMISSION, show only what is being asked: tool and file (and, for Bash, the command). No command or
output from earlier steps, or at least marked clearly as earlier. NEEDS PERMISSION is the state the driver must
act on (and the planned allow/deny buttons answer it). An old `rm -rf` under an amber band invites a wrong
answer.

## Why major

The view misstates what it knows in the one state where the driver has to make a decision. At a one-second
glance the driver sees the amber band and the biggest line of text, which is the command.
