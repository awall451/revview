---
id: qa-20261121-14
title: Two device assumptions are in neither the emulator proof nor BENCH-TEST: colour emoji font, Node version for `npm start`
severity: minor
area: bench-test
how to reproduce: |
  `fc-list : family` on this VM; read BENCH-TEST items 19 and 20; `package.json` engines.
evidence: |
  1. The emulator renders emoji in colour because this VM has `Noto Color Emoji`; the worst-case
     screenshots (`emulator/worst-case/cjk-wide.json`) show them. Bench 19 checks DejaVu and a CJK font
     but not an emoji font; on a Pi without one, emoji in commands/output render as boxes or monochrome
     glyphs of other widths (layout not proven).
  2. Bench 20 says "Run `npm start` on the Pi"; `package.json` requires `node >=22` and DECISIONS pins
     Node 22, but no document says how Node 22 gets onto Raspberry Pi OS Trixie (to my knowledge its
     Debian package is Node 20; not checkable here). Bench 20 should name the Node version to check.
---
