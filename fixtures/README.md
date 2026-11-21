# Fixtures

Canonical recorded Claude Code hook events. Unit tests replay them, and the emulator and its per-state
screenshots should use them too. There were no placeholder fixtures before these.

`sessions/<name>.jsonl`: one real hook payload per line (stdin of the hook), in recorded order.
`sessions/<name>.expected.json`: the reviewed state after each event (`tests/unit/replay.test.js`).

| Session | Shows |
|---|---|
| `working-turn` | a full turn: prompt, Read, Edit (+1 -1), Write of a new file (+3), a Bash command with ANSI-coloured output, Stop |
| `permission-prompt` | a Bash command that needs permission: PermissionRequest, Notification `permission_prompt`, approval, Stop, Notification `idle_prompt` |
| `idle-prompt` | a turn without a prompt, Stop, then Notification `idle_prompt` |

All three were **recorded on this VM with Claude Code 2.1.330** (model haiku) on 2026-11-21, in a throwaway
repo under `/tmp`, with a hook on every event appending its stdin as a JSON line. Changed afterwards: only
`/home/agent/` -> `/home/user/`. Nothing here is hand-written; shapes that are only known from the package
source are listed in `docs/DECISIONS.md`.

To record more: in a scratch repo (not this one), give each hook event a command hook that appends stdin to
a file, e.g. `node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>require("fs").appendFileSync(process.argv[1],JSON.stringify(JSON.parse(s))+"\n"))' /tmp/events.jsonl`,
then run `claude -p ... -- "<prompt>"` (headless) or an interactive `claude --permission-mode default` in a
pty for Notification events (permission and idle prompts are interactive only). Use a separate
`CLAUDE_CONFIG_DIR` for interactive runs so onboarding and folder trust stay out of the real config.
Copy the file here, sanitise, then `REVVIEW_UPDATE_EXPECTED=1 npm run test:unit` and review the new
`.expected.json` before committing.
