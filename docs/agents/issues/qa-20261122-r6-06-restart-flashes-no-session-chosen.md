---
id: qa-20261122-r6-06
title: After a service restart with one surviving window, --boot first shows "No session chosen: press up to open the list" with a crossed mic before it selects that window
severity: cosmetic
area: server --boot (`bootSessions` selects after the owned listing is applied)
how to reproduce: one `revview` tmux window alive; restart `node src/server/index.js 8320 --dev-bridge --sessions --boot` with a wrapper `tmux` on PATH that sleeps 1.5 s per call (/tmp/qa6-run/slowbin/tmux), poll /state every 100 ms
evidence: /tmp/qa6-shots/b4-restart-early.png
---

## Seen

`/state` over time: `starting` -> `unknown alpha-service`, `voice: none` (crossed mic, note "No session chosen: press up
to open the list") for about 1.2 s -> `unknown`, `voice: here`, "No events from this session yet". With real tmux
here the middle step is short (I did not catch it without the slow wrapper); on the Pi, at key-on, tmux calls are
slower.

## Expected

pi/README: "exactly one window (a service restart) selects it and starts nothing". The bar should go from STARTING
straight to that session; telling the driver to press up for something that resolves itself a second later is noise.
