// Physical-size measurements for the panel emulator (Playwright side).
import { pxToMm } from './panel.js';

/**
 * Size of the element's box in mm (CSS px / PANEL.pxPerMm; the config uses deviceScaleFactor 1, so
 * CSS px equal device px).
 * @param {import('@playwright/test').Locator} locator
 * @returns {Promise<{widthMm:number, heightMm:number}>}
 */
export async function boxSizeMm(locator) {
  const r = await locator.evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { w: b.width, h: b.height };
  });
  return { widthMm: pxToMm(r.w), heightMm: pxToMm(r.h) };
}

/**
 * Text size of an element, in px and mm.
 *
 * "Text height" here means CAP HEIGHT: the ink height of a capital "H" (baseline to top of the H) in
 * the element's computed font. It is measured in the page with a 2D canvas,
 * `measureText('H').actualBoundingBoxAscent`, with `ctx.font` built from the element's computed
 * font-style / weight / size / family. `fontSizePx`/`fontSizeMm` is the em box, which is NOT glyph
 * height (always larger than the cap height). Measurement uses the font engine of the browser running
 * the test, so it is only as true as that browser's fonts (headless Chromium here versus Chromium on
 * the Pi can differ).
 * @param {import('@playwright/test').Locator} locator
 * @returns {Promise<{fontSizePx:number, fontSizeMm:number, capHeightPx:number, capHeightMm:number,
 *   boxWidthMm:number, boxHeightMm:number}>}
 */
export async function textSizeMm(locator) {
  const m = await locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const b = el.getBoundingClientRect();
    return {
      fontSizePx: parseFloat(cs.fontSize),
      capHeightPx: ctx.measureText('H').actualBoundingBoxAscent,
      w: b.width,
      h: b.height,
    };
  });
  return {
    fontSizePx: m.fontSizePx,
    fontSizeMm: pxToMm(m.fontSizePx),
    capHeightPx: m.capHeightPx,
    capHeightMm: pxToMm(m.capHeightPx),
    boxWidthMm: pxToMm(m.w),
    boxHeightMm: pxToMm(m.h),
  };
}
