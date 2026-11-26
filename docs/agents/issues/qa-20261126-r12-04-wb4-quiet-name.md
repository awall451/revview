---
id: qa-20261126-r12-04
title: Gallery shot wb4-quiet.png shows UNKNOWN, not the new QUIET mark (quiet.png); the old name now misleads
severity: polish
area: emulator/tests/wb4.spec.js (shot name), gate gallery
reproduce: |
  Open /var/lib/agent-kit/gate/logs/864829f0b40de0cbfc0321bb8a93217d928689da-out/shots/wb4-quiet.png and quiet.png.
evidence: |
  wb4-quiet.png: "? UNKNOWN  mic 1/2 / Not known until Claude's next step / No events from this session yet"
  (test 'quiet: owned session after a restart, UNKNOWN with its note', wb4.spec.js line 123-130).
  quiet.png: "WORKING 1h05 QUIET 7 MIN". Copy at /tmp/qa-r12-shots/wb4-quiet.png.
---
Since #29, "quiet" is a named mark on the bar. The owner looking for the QUIET mark in the 140-shot gallery finds two
"quiet" shots, one of which shows no QUIET at all. Expected: rename the older shot (e.g. wb4-unknown-after-restart).
Severity: polish.
