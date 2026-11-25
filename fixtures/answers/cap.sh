#!/bin/bash
# cap.sh NAME : capture the pane into /tmp/q2/pane-NAME.txt (blank lines dropped, header)
{ echo "# captured $(date -u +%T)"; tmux -L q2 capture-pane -p -t q2 | grep -v '^\s*$'; } > /tmp/q2/pane-$1.txt; cat /tmp/q2/pane-$1.txt
