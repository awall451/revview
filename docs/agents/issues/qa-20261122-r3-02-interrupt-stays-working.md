---
status: closed (fixed in ddf1f6d state core and 7895184 server, branch work/wb3-sessions)
id: qa-20261122-r3-02
title: After Esc or Ctrl+C mid-turn (recorded) the bar keeps showing WORKING and the interrupted command
severity: minor
area: state core / bench coverage
how to reproduce: replay fixtures/buttons/events-a-esc.jsonl or events-b-ctrlc-once.jsonl into the live server
evidence: /tmp/qa-r3-shots/btn-events-a-esc/02-PreToolUse-8183.png, /tmp/qa-r3-shots/btn-events-b-ctrlc-once/01-PreToolUse-8183.png
---

## Steps

POST the lines of `fixtures/buttons/events-a-esc.jsonl` (Claude Code 2.1.330, recorded on main in c25ad10) to
the live server one by one, with the page open. Stop after line 3 (`PreToolUse` Bash
`node -e "setTimeout(()=>{},40000)"`), which is the last hook before the Esc. The same applies to
`events-b-ctrlc-once.jsonl` (UserPromptSubmit, PreToolUse, then nothing).

## What happened

The bar shows `WORKING` / `Bash` / `$ node -e "setTimeout(()=>{},40000)"`. Per the recording
(`pane-a-2-after-esc.txt`), Claude stopped at once and shows "Interrupted · What should Claude do instead?",
waiting for the driver. No hook fires after the interrupt (fixtures/buttons/README.md, DECISIONS "Recorded
facts"), so the bar says WORKING until the next prompt. In the recording that came 13 s later. It may change
after about 60 s if Claude Code sends `idle_prompt` after an interrupt, but no recording shows that.

## Expected

Either the bar leaves WORKING after an interrupt, or the gap is written down: a bench item (BENCH-TEST has
B7 for Esc on a permission prompt, nothing for Esc or Ctrl+C mid-tool) and a "not solved" line in DECISIONS.
Neither exists. The recordings are on main, but `tests/unit` replays only `fixtures/sessions/`, so no test
covers this behaviour.

## Severity

Minor today: nothing built yet lets the driver press Esc while driving. It becomes major with the planned
Cancel button (BUTTONS.md: tap = Esc). The driver presses Cancel and the bar keeps saying WORKING.

## Fix (WB3)

revview now sends Esc / Ctrl+C itself (cancel button), and right after a sent key it feeds the internal event
`RevviewInterrupted {session_id}` to the board: a session in a turn becomes WAITING FOR ME. It cannot be POSTed
(403). Tests: `tests/unit/board-wb3.test.js` (replays `events-a-esc.jsonl` and `events-b-ctrlc-once.jsonl`),
`tests/unit/wb3-tmux.test.js`, `tests/unit/wb3-recordings.test.js`; real run `fixtures/buttons/wb3/` (`/state`
was `waiting` 300 ms after the press). Still open: an Esc typed by hand in the terminal (not by revview) fires no
hook, so the bar stays WORKING then (DECISIONS, WB3 residual risks).
