---
id: qa-20261121-04
title: After Claude Code exits (SessionEnd) the view keeps saying WAITING FOR ME / DONE forever
severity: major
area: state
how to reproduce: |
  Replay fixtures/sessions/permission-prompt.jsonl (or idle-prompt.jsonl) to the live server to the end,
  including the final SessionEnd.
evidence: |
  Emulator: after SessionEnd, `WAITING FOR ME · repo / $ python3 -c "print('ok')" / ok`
  (/tmp/qa-shots/qa-004-waiting-after-sessionend.png). working-turn.jsonl ends on `DONE` the same way.
  The reducer ignores SessionEnd on purpose (DECISIONS, src/state/README), and STATE.md lists it as an
  open point, but nothing on the screen tells the driver that no Claude is running: pressing push-to-talk
  then does nothing while the bar invites it. The recordings carry the real SessionEnd payload, so this
  can be handled from recorded data.
---
