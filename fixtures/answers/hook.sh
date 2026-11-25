#!/bin/bash
f=/tmp/q2/events.jsonl; t=$(mktemp); cat > "$t"; tr -d '\n' < "$t" >> "$f"; echo >> "$f"; rm -f "$t"
