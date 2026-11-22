---
status: closed (2026-11-22, work/qa5-fixes: failed turn shows "Turn failed: <error>" under WAITING FOR ME, see DECISIONS)
id: qa-20261122-r3-05
title: A failed turn (StopFailure) shows a plain WAITING FOR ME; nothing says the work did not finish
severity: minor
area: state core / view
how to reproduce: SessionStart, UserPromptSubmit, StopFailure
evidence: state core replay (replayView), /tmp/qa-r3-tools/r2check.mjs, case "stopfailure"
---

## Steps

`SessionStart` (startup), `UserPromptSubmit`, `StopFailure` (`{"error":"rate_limit"}`) for one session.
Replayed with `replayView`, the same function the server uses.

## What happened

The view is `waiting`: `WAITING FOR ME`, with the last tool, command and output of the turn. It looks the same as
a turn that ended normally and then went idle.

## Expected

StopFailure means the turn ended with an error (API error, rate limit, no network). The driver should see that
the task did not complete, not an invitation to speak the next instruction. A voice prompt after a rate limit
does nothing. The team's own rule ("a state is shown only when the events prove it", DECISIONS 2026-11-22 "honest
states") and DESIGN ("a dictation that failed must say so, not vanish") point the same way. The
StopFailure payload is not recorded (state README "Payload assumptions" does not list it either), so a recording
or a bench item is needed as well.

## What is known (2026-11-22, area lead, QA round 3 fixes; still open)

No recording in `fixtures/` contains a `StopFailure`. From static strings of the installed Claude Code 2.1.330
binary (`~/.local/share/claude/versions/2.1.330`; not run, not recorded, may differ in other versions):

- input: the common fields plus `hook_event_name: "StopFailure"`, `error` (required enum, `"unknown"` when the
  message has none), `error_details` (optional string), `last_assistant_message` (optional string);
- `error` values (also the matcher): `authentication_failed`, `oauth_org_not_allowed`, `account_on_hold`,
  `verification_required`, `billing_error`, `rate_limit`, `overloaded`, `invalid_request`, `model_not_found`,
  `server_error`, `unknown`, `max_output_tokens`, `cloud_credential_error`;
- fires "when the turn ends due to an API error", instead of `Stop`; not for subagent contexts; fire-and-forget
  (hook output and exit code ignored), default timeout 120 s.

A recording (or a bench item) is still needed before the view claims a failed turn.

## Recorded (2026-11-22, stage 2 hook wiring)

Now recorded with Claude Code 2.1.330 (`fixtures/sessions/hook-wiring/events-stop-failure*.jsonl`, API unreachable
through `ANTHROPIC_BASE_URL` to a closed port, `CLAUDE_CODE_MAX_RETRIES=0`): `StopFailure` with `error: "server_error"`,
`last_assistant_message` ("API Error: Connection refused ..."), no `error_details`, no `Stop`. Interactive: the hook
reached the server and the bar showed WAITING FOR ME (as reported); the terminal said "Resend your message to try
again". Headless `claude -p`: the hook post never reached the server (5 runs). Still open: the state core / view
change is for the state-core lead.
