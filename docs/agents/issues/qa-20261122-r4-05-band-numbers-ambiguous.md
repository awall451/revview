---
status: closed (2026-11-22, work/core-small-14: with a position the band shows the permission count, no +N; not yet re-run by QA)
id: qa-20261122-r4-05
title: The band shows two numbers ("+3" and "3/4"); with the triangle, "+7" does not say how many need permission
severity: minor
area: view (band: others, elsewhere, position)
how to reproduce: dev server, 4 then 8 sessions, one of them with a pending prompt; look at the band
evidence: /tmp/qa-wb4-shots/s5-03-gamma-long-name-band.png, /tmp/qa-wb4-shots/s6-01-8-sessions.png, /tmp/qa-wb4-shots/gallery/wb4-list-long.png, /tmp/qa-wb4-shots/s2-03-B-permission-elsewhere.png
---

## Steps

1. Four sessions, the third selected: the band reads `● WORKING  +3  🎤 3/4  gamma-very-long-repository-name-fo…`.
2. Eight sessions, one other (`hand-three`) needs permission: the band reads `▲+7  🎤 3/8`.

## What I saw

- `+3` (three other sessions) sits next to `3/4` (this is session 3 of 4). Both say how many sessions there are; in
  a glance the driver sees two numbers and has to remember which is which. The `+N` is redundant once the
  position is shown.
- `▲+7` means "7 others, at least one of which needs permission" (`view.js` line 226-230). It does not say how many
  ask; one prompt among 8 sessions looks the same as 7 prompts. The triangle is about 18 px wide (about 2.7 mm
  on the panel) in black on the band colour, the only thing that tells "+1" (s1-03) from "▲+1" (s2-03).
- Sessions elsewhere that are WAITING FOR ME or DONE get no hint at all, although home ranks them above working.

## What I expected

When the position is shown, drop `+N` and put the hint next to it as the number of sessions that need permission
(e.g. `▲1`), so one number means one thing. Not proven on the panel either way (bench V8).
