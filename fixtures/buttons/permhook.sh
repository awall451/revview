#!/bin/bash
# waits for /tmp/rvbtn/answer containing allow|deny, up to ${RVBTN_WAIT:-60}s
cat > /tmp/rvbtn/perm-stdin.json
echo "start $(date +%T.%N)" >> /tmp/rvbtn/permhook.log
n=$(( ${RVBTN_WAIT:-60} * 5 ))
for ((i=0;i<n;i++)); do
  if [ -f /tmp/rvbtn/answer ]; then
    a=$(cat /tmp/rvbtn/answer)
    echo "answer $a $(date +%T.%N)" >> /tmp/rvbtn/permhook.log
    if [ "$a" = deny ]; then echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"denied by wheel button"}}}'
    else echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}'; fi
    exit 0
  fi
  sleep 0.2
done
echo "gave up $(date +%T.%N)" >> /tmp/rvbtn/permhook.log
exit 0
