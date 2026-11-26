---
id: qa-20261126-r12-02
title: config/look.json still explains the rejected "year before 2026" clock rule; equal from/to hours silently mean "never night"
severity: minor
area: config/look.json (_comment_night), src look config parsing, docs/DECISIONS.md "Night and day looks"
reproduce: |
  Read config/look.json.
  Start the server with a look file {"look":"auto","night":{"from":"07:00","to":"07:00"}} and GET /state.
evidence: |
  config/look.json _comment_night: "The Pi has no RTC: before the clock is set (year before 2026) auto shows day."
  DECISIONS (after the review fix round): the year alone proves nothing on the Pi (systemd starts at its build date,
  2026-04); on the Pi auto shows day until /run/systemd/timesync/synchronized exists (--clock-sync).
  from == to: the server logs "look: auto (night 07:00-07:00)" and gives look=day at 07:04 (no warning; not in the docs).
---
What I did: read the file the owner is told to edit (it is "the lasting place" for the look); tried edge configs
("dusk", "25:00", not JSON: all logged and gave day, good; from == to: accepted, never night).
What I saw: the comment describes the rule the reviewer rejected as blocking. An owner reading it on the Pi would
expect auto to work after any boot in 2026, which is the case the fix round says it does not.
What I expected: the comment matches DECISIONS (time sync file, --clock-sync, laptop: year check only). For from == to,
either a log line "from equals to: never night" or a sentence in the comment.
Severity: minor.
