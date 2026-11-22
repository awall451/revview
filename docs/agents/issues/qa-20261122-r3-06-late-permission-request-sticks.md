---
status: closed (87c4235: an untied prompt clears on its agent's next tool event; a tied prompt whose Post was lost still waits for Stop, see DECISIONS "QA round 3")
id: qa-20261122-r3-06
title: A PermissionRequest whose PostToolUse came first (or was lost) keeps NEEDS PERMISSION through later tools until Stop
severity: minor
area: state core (board pending)
how to reproduce: Pre, Post, then PermissionRequest of the same Bash; then Read and Edit
evidence: /tmp/qa-r3-shots/s06-order/00-perm-after-post.png, 02-edit-after.png
---

## Steps

One session, page open (`/tmp/qa-r3-scen/s06-order.jsonl`):

1. `SessionStart`, `UserPromptSubmit`
2. `PreToolUse` Bash `make deploy` (q1), `PostToolUse` Bash q1 stdout `ok`, then `PermissionRequest` Bash `make deploy`
3. `PreToolUse`/`PostToolUse` Read `a.txt`, then `PreToolUse`/`PostToolUse` Edit `a.txt` (+2 −1)
4. `Stop`

## What happened

From step 2 to `Stop` the bar shows `NEEDS PERMISSION / Bash / $ make deploy / ok`. Row A says `Bash` while
Read and Edit run, and the diff grows to `+2 −1` next to an old request whose output (`ok`) proves it already
ran. The same happens if the PostToolUse after an approval is lost (hook curl failed). The entry has no tuid
because its call was already closed, so only a Post of the same tool in the same agent, a Stop, an idle_prompt
or a driver prompt clears it.

## Expected

A request that arrives after its call has finished is already answered, so it should be ignored. Any later tool
event of the same agent (a PreToolUse of another call) also proves the agent is no longer blocked and should
clear a main-thread entry with no tuid. Claude Code runs one main-thread call at a time while a dialog is open.
Today's rule hides real work behind a false prompt for the rest of the turn.

Likelihood: hook commands are run in order by Claude Code, so the out-of-order case needs an async hook or a
lost POST. Hence minor.
