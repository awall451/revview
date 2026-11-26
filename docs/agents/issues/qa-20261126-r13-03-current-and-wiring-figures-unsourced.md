---
id: qa-20261126-r13-03
title: pi/README Lights gives current and part values (20 mA per channel, 1 mA idle, 330-470 ohm, 100-1000 uF) with no source and no "from memory" mark
severity: polish
area: pi/README.md Lights, docs/PI-FACTS.md section 11 (honesty of hardware numbers)
---
## What the docs say

`pi/README.md`, "Lights (LEDs per session)":
- "**Current.** About 20 mA per colour channel at full drive. ... so 8 LEDs are about 120 mA, plus about 1 mA idle
  each."
- Wiring table: DIN "through a 330-470 ohm resistor close to the first LED"; "**Capacitor.** 100-1000 uF across 5 V
  and GND".

None of these figures carries a source or a "from memory" mark there, unlike the next bullet of the same section
("Pi 4 clock *(from memory, not checked)*"). `docs/DECISIONS.md` (Lights per project) does say "about 20 mA per channel
at full drive (datasheet value, from memory)", but the README a builder wires from does not, and `docs/PI-FACTS.md`
section 11 (L1-L11) lists the 0.7 x VDD level and the 2.4 MHz timing as "from memory" but none of the current figures or
the part values. Bench LT12 checks only the total ("about 120 mA extra at most") and nothing checks the 1 mA idle
figure or the resistor / capacitor values.

## How to reproduce

`grep -n "20 mA\|1 mA\|330-470\|1000 uF" pi/README.md docs/PI-FACTS.md docs/BENCH-TEST.md docs/DECISIONS.md`.

## Evidence

The arithmetic itself checks out (recomputed: 3 x 20 mA x 64/255 = 15.1 mA per LED, x 8 = 120 mA; at the default 48:
11.3 mA; config comment "about 11 mA" agrees). Only the source of the 20 mA / 1 mA inputs and the part values is
missing. Suggested: mark them "(from memory, WS2812B datasheet not checked)" in pi/README and add a PI-FACTS 11 row.
