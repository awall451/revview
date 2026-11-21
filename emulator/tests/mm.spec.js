import { test, expect } from './harness.js';
import { PANEL, mmToPx } from '../panel.js';
import { textSizeMm } from '../mm.js';

const FONT = "system-ui, 'DejaVu Sans', sans-serif"; // single quotes: it goes inside style="..."

test.beforeEach(async ({ page }) => {
  await page.setContent('<body style="margin:0"></body>');
});

test('viewport is 1280x400 at device pixel ratio 1', async ({ page }) => {
  expect(page.viewportSize()).toEqual({ width: PANEL.widthPx, height: PANEL.heightPx });
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1);
});

test('a 1280 px wide box is 190 mm', async ({ page }) => {
  await page.setContent('<div id="d" style="width:1280px;height:10px"></div>');
  const m = await textSizeMm(page.locator('#d'));
  expect(Math.abs(m.boxWidthMm - PANEL.activeWidthMm)).toBeLessThan(0.01);
});

test('font-size of mmToPx(10) is 10 mm', async ({ page }) => {
  await page.setContent(`<span id="s" style="font:${mmToPx(10)}px ${FONT}">H</span>`);
  const m = await textSizeMm(page.locator('#s'));
  expect(Math.abs(m.fontSizeMm - 10)).toBeLessThan(0.01);
  expect(m.capHeightPx).toBeLessThan(m.fontSizePx);
});

// Independent of measureText: paint an H and count the rows that contain ink.
async function inkHeightPx(page, size) {
  return page.evaluate(({ size, font }) => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = Math.ceil(size * 2);
    const ctx = c.getContext('2d');
    ctx.font = `normal 400 ${size}px ${font}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#000';
    ctx.fillText('H', 20, Math.ceil(size * 1.5));
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let top = -1; let bottom = -1;
    for (let y = 0; y < c.height; y++) {
      let ink = false;
      for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 127) { ink = true; break; }
      if (ink) { if (top < 0) top = y; bottom = y; }
    }
    return bottom - top + 1;
  }, { size, font: FONT });
}

for (const size of [60, 120, 200]) {
  test(`cap height at ${size}px matches painted ink`, async ({ page }) => {
    await page.setContent(`<span id="s" style="font:${size}px ${FONT}">H</span>`);
    const m = await textSizeMm(page.locator('#s'));
    const ink = await inkHeightPx(page, size);
    expect(Math.abs(m.capHeightPx - ink)).toBeLessThanOrEqual(1.5);
  });
}

test('cap height scales linearly with font size', async ({ page }) => {
  await page.setContent(`<span id="a" style="font:60px ${FONT}">H</span><span id="b" style="font:120px ${FONT}">H</span>`);
  const a = await textSizeMm(page.locator('#a'));
  const b = await textSizeMm(page.locator('#b'));
  // Glyph bounds come back pixel-rounded (up to 0.5 px each), so 2x can be off by 1.5 px.
  expect(Math.abs(b.capHeightPx - 2 * a.capHeightPx)).toBeLessThanOrEqual(2);
});
