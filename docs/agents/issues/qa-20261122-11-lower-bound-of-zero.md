---
id: qa-20261122-11
title: A lost diff event with nothing counted yet shows "≥ +0 −0", and an id-less lost event marks every session
severity: polish
area: view, state
how to reproduce: |
  UserPromptSubmit, then POST a PostToolUse Write (type create) of 70000 lines (1.68 MB body) with
  `curl -s -X POST --data-binary @-` (413). Second case: two live sessions, the same body without session_id.
expected: |
  Something that does not read as "no changes", e.g. `+? −?` or `≥ +0` replaced by a "diff unknown" mark; and the
  id-less case marking only what it must (or saying so in DECISIONS).
evidence: |
  Emulator: `≥ +0 −0` on line 2 (/tmp/qa2-shots/f-09-after-curl-big.png); data-full "at least +0 −0". The lost
  Write had 70000 lines. In the id-less case the shown session `other`, which received nothing, also shows `≥ +0 −0`
  (f-11). Recomputed by hand: f-03 shows `≥ +123k −0` after a 123456-line Write plus a lost 50000-line Write, true
  total +173456: the lower bound is correct and rounds down (`formatCount`).
---
