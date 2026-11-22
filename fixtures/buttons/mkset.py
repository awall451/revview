import json,sys
to = sys.argv[1] if len(sys.argv)>1 else ""
log={"type":"command","command":"/tmp/rvbtn/hook.sh"}
ev=["SessionStart","UserPromptSubmit","PreToolUse","PostToolUse","PermissionRequest","PermissionDenied","Notification","Stop","SubagentStop","SessionEnd","PreCompact"]
hooks={e:[{"hooks":[dict(log)]}] for e in ev}
w={"type":"command","command":"/tmp/rvbtn/permhook.sh"}
if to and to != "none": w["timeout"]=int(to)
if len(sys.argv)>2 and sys.argv[2]=="wait": hooks["PermissionRequest"].append({"hooks":[w]})
json.dump({"permissions":{"allow":["Bash(sleep:*)","Bash(echo:*)","Bash(node:*)"],"defaultMode":"default"},"hooks":hooks},open("/tmp/rvbtn-repo/.claude/settings.json","w"),indent=1)
