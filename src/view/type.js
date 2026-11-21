// Type sizes of the glance view as CAP HEIGHTS (ink height of a capital H) in panel millimetres.
// TYPE_MM is what the design sets; view.js turns it into font sizes from the real font's cap ratio.
// MIN_MM is what the tests assert as the lowest acceptable size (state word, and any text at all).
export const TYPE_MM = Object.freeze({ state: 10.6, detail: 6.1 });
export const MIN_MM = Object.freeze({ state: 10.5, floor: 6.0 });
