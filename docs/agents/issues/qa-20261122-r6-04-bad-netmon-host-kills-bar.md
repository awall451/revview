---
id: qa-20261122-r6-04
title: A typo in the optional REVVIEW_NETMON_HOST makes the server exit 2 at start; on the Pi the whole bar would then sit on NO LINK with no reason shown
severity: minor
area: src/server/index.js (--netmon argument check), pi/revview.service, /etc/revview/server.env, pi/README step 8, BENCH-TEST
how to reproduce: `REVVIEW_NETMON_HOST='<value>' node src/server/index.js 8321 --netmon` with the values below
evidence: exit codes and stderr below
---

## Steps

Start the server with `--netmon` and each of `host:99999`, `a b`, `:443`, `[::1]:443`, `example.com:`.

## Seen

Each: exit code 2, stderr `REVVIEW_NETMON_HOST must be host or host:port, got ...`, nothing listens.

## Expected / why it matters

The check itself is fine and documented ("a bad value exits with code 2"). But on the Pi this value comes from
`/etc/revview/server.env`, an optional setting for the network check. With `Restart=always`, `RestartSec=2` the unit
would restart, fail again and (systemd's default start limit, from memory) end up failed. The kiosk then shows NO
LINK "Waiting for the revview server" for good: the driver loses the whole bar, not just the OFFLINE tag, and nothing
on screen says that a setting is wrong. A bad optional setting should be logged and ignored (fall back to the
default host), the way a missing `REVVIEW_START` folder is logged and the server stays up.

Not in BENCH-TEST: no item tries a bad value in server.env. `[::1]:443` (an IPv6 literal) is also refused, which
pi/README does not mention.
