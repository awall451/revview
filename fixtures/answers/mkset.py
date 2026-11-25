import json
ev = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionDenied", "Notification", "Stop", "SubagentStop", "SessionEnd"]
h = {e: [{"hooks": [{"type": "command", "command": "/tmp/q2/kit/hook.sh"}]}] for e in ev}
h["PermissionRequest"] = [{"hooks": [{"type": "command", "command": "/tmp/q2/kit/permhook.sh", "timeout": 300}]}]
json.dump({"hooks": h}, open("/tmp/q2/repo/.claude/settings.json", "w"), indent=1)
