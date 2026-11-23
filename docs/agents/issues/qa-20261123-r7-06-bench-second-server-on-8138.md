---
id: qa-20261123-r7-06
title: Bench items that start their own server (`npm start`, `node src/server/index.js --input ...`) collide with the installed revview user unit on port 8138 and the dongle grab; none says to stop the service first
severity: minor
area: docs/BENCH-TEST.md items 20, 21, 28, 32, S1, W3, W5 (written before the appliance existed)
how to reproduce: with one server on 8138 (`node src/server/index.js 8138`), run `node src/server/index.js` (the default port) as item 28/S1 do
evidence: the second start ends with `node:net:1941 ... UVExceptionWithHostPort(err, 'listen', ...)` (EADDRINUSE stack trace), exit non-zero
---

## Seen

After pi/README step 7 the service (`--input --sessions --boot --netmon` on 8138) runs at every boot. Item 20 says
"Run `npm start` on the Pi", 21 "stop the server (Ctrl-C)", 28 and 32 "`node src/server/index.js --input`", S1
"`node src/server/index.js --input --start <repo>`", W3/W5 "run the server with `--input`". On the installed Pi each
of these fails to listen (stack trace above), and with `--input` would also fight the service's exclusive grab of
the dongle (item 32 expects a second grab to fail). An owner following these items as written gets a crash and may
report a bug that is only the instructions.

## Expected

Either a line at the top of BENCH-TEST ("items that run `node src/server/index.js` by hand: first `systemctl --user
stop revview` as the kiosk user, `start` it afterwards") or the items rewritten to use the service
(`systemctl --user restart revview`, `journalctl --user -u revview`) as D1-D4 and the P items do.
