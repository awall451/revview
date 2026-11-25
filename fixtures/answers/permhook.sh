#!/bin/bash
# logs stdin, then waits up to 200 s for /tmp/q2/answer.json (a full decision object) and prints it
t=$(mktemp); cat > "$t"; f=/tmp/q2/events.jsonl; tr -d '\n' < "$t" >> "$f"; echo >> "$f"; cp "$t" /tmp/q2/perm-stdin.json; rm -f "$t"
echo "start $(date +%T.%N)" >> /tmp/q2/permhook.log
for ((i=0;i<1000;i++)); do
  if [ -f /tmp/q2/answer.json ]; then
    d=$(cat /tmp/q2/answer.json); rm -f /tmp/q2/answer.json
    echo "answer $d $(date +%T.%N)" >> /tmp/q2/permhook.log
    printf '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":%s}}\n' "$d"; exit 0
  fi
  sleep 0.2
done
echo "gave up $(date +%T.%N)" >> /tmp/q2/permhook.log
