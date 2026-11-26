---
id: qa-20261126-r11-04
title: Up/Down move the highlighted choice in reading order over a two-column grid, so Down from option 1 jumps right to option 2 and Down from 2 jumps down-left to 3
severity: small
area: src/view/view.js (option layout under CLAUDE ASKS)
reproduce: Demo key 0 (Red/Green/Blue), Down, Down; or the asking-choice fixture with four options.
evidence: |
  Options laid out 1 Red | 2 Green on the first row, 3 Blue (| 4) on the second (boxes x=24/652). After one Down the
  block is on Green (to the right), after two on Blue (below-left). Screenshot ask-down2.png.
---
On the dash the driver presses "down" and sees the highlight move sideways. The terminal picker is one vertical list,
so the numbers agree, but the direction does not. Either one column (four options fit: 4 x 40 px) or say it.
