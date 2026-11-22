# Hooks

`permission-request.mjs` is a Claude Code `PermissionRequest` command hook. It posts the request
JSON (unchanged) to the revview server (`http://127.0.0.1:$REVVIEW_PORT/permission`, default 8138) and
waits. If the driver answers with a wheel button, the server replies with `{behavior:'allow'}` or
`{behavior:'deny',message}` and the hook prints the matching `hookSpecificOutput` for Claude Code.

Install: merge `settings-snippet.json` into a Claude Code settings file and replace `$REVVIEW_DIR`
with the absolute path of this repository.

## No decision means the terminal prompt stays

Connection refused, timeout, non-200, a malformed or extended response, or stdin that is not JSON
(or over 1 MiB): the hook prints nothing and exits 0. The normal terminal dialog is shown at once
anyway and stays. The hook never allows or denies by default, and an allow never carries
`updatedPermissions` (no "always allow").

## Timeouts

| Where | Value | Why |
| --- | --- | --- |
| server wait per request | 540 s | ends first, answers the hook with no decision |
| hook wait (`REVVIEW_HOOK_WAIT_MS`) | 570 s | backstop if the server hangs |
| settings `timeout` | 600 s | Claude Code kills the hook last |

## Do not also post PermissionRequest to /event

The server feeds `PermissionRequest` from this hook into the board itself. Another hook posting the
same event to `/event` would create a duplicate pending entry.
