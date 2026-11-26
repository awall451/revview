#!/bin/bash
# start.sh MODE : a claude in tmux -L q2, session q2, 150x45
# shellcheck source=/dev/null
set -a; . /etc/agent-kit/auth.env; set +a
tmux -L q2 kill-server 2>/dev/null
cd /tmp/q2/repo || exit 1
tmux -L q2 new-session -d -s q2 -x 150 -y 45 -e CLAUDE_CONFIG_DIR=/tmp/q2/cfg -e CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" \
  "env -u CLAUDECODE -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_PID -u CLAUDE_CODE_CHILD_NOTES_DIR -u CLAUDE_CODE_SESSION_ATTENDED claude --model haiku --permission-mode ${1:-default}; sleep 600"
