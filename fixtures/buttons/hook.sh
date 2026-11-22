#!/bin/bash
cat >> "${RVBTN_OUT:-/tmp/rvbtn/events-misc.jsonl}.tmp"; f="${RVBTN_OUT:-/tmp/rvbtn/events-misc.jsonl}"
# one json per line
tr -d '\n' < "$f.tmp" >> "$f"; echo >> "$f"; rm -f "$f.tmp"
