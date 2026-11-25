// Type sizes of the glance view as CAP HEIGHTS (ink height of a capital H) in panel millimetres.
// TYPE_MM is what the design sets; view.js turns it into font sizes from the real font's cap ratio.
// The owner's targets are 6.0 mm (state word) and 3.5 mm (all other text). The design values sit a little above
// them (6.05, 3.55) because the emulator's canvas measurement reports the hinted cap height in whole pixels,
// rounded down (the true cap height at 6.05 mm is about 6.04 mm and measures 40 px = 5.94 mm; at 3.55 mm it is
// about 3.54 mm and measures 23 px = 3.41 mm). With the exact targets the measurement can fall to 5.9 and 3.3.
// RANGE_MM is what the tests assert, two-sided: the state word, and every other text.
export const TYPE_MM = Object.freeze({ state: 6.05, detail: 3.55 });
export const RANGE_MM = Object.freeze({ state: Object.freeze([5.8, 6.3]), text: Object.freeze([3.3, 3.7]), ask: Object.freeze([4.0, 6.3]) });
// ask: the question of CLAUDE ASKS is larger than the 3.55 mm text: the state word's size when it fits, else the largest that does (never under 4.0 mm).

// The font size (px) of the question of CLAUDE ASKS: the state word's size when it fits, else the largest that does
// (`room` = the height the two lines may take, in px of font size), and never under minPx (the 4.0 mm size: the text is then cut instead).
export const askFontPx = (stateFont, room, minPx) => Math.max(minPx, Math.min(stateFont, Math.floor(room * 10) / 10));
