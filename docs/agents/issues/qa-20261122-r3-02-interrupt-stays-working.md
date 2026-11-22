---
status: open
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
