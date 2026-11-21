// The ONE place for the panel's physical size. Pure ESM, no node imports: the dev page imports it too.
// 1280/190 = 6.737 px/mm horizontally, 400/60 = 6.667 vertically (about 1% apart). 190x60 mm is the
// approximate active area from docs/DESIGN.md, unverified on hardware. ONE uniform scale is used, the
// larger 1280/190, so converted mm are conservative (never overstate a size by the vertical figure);
// at that scale 400 px correspond to 59.4 mm.
export const PANEL = Object.freeze({
  widthPx: 1280,
  heightPx: 400,
  activeWidthMm: 190,
  activeHeightMm: 60,
  pxPerMm: 1280 / 190,
});

export const pxToMm = (px) => px / PANEL.pxPerMm;
export const mmToPx = (mm) => mm * PANEL.pxPerMm;
