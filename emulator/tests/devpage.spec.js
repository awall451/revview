import { test, expect } from './harness.js';
import { PANEL } from '../panel.js';
import { STATES } from '../../src/state/states.js';

test.use({ viewport: { width: 1600, height: 1000 } });

const NOMINAL = 96 / 25.4;

async function stripWidth(page) {
  return (await page.locator('#strip').boundingBox()).width;
}
async function pxPerMm(page) {
  return Number(await page.locator('#px-per-mm').textContent());
}
const expectedStrip = (ppm) => (PANEL.widthPx / PANEL.pxPerMm) * ppm;

test.beforeEach(async ({ page, server }) => {
  await page.goto(`${server.url}/emulator/dev/`);
});

test('picker lists exactly the states', async ({ page }) => {
  const options = await page.locator('#state option').evaluateAll((o) => o.map((e) => e.value));
  expect(options).toEqual([...STATES]);
});

test('picking each state renders it in the iframe and updates the URL', async ({ page }) => {
  for (const id of STATES) {
    await page.locator('#state').selectOption(id);
    await expect(page.locator('#view')).toHaveAttribute('src', new RegExp(`fixture=${id}$`));
    const frame = page.frameLocator('#view').locator('html');
    await expect(frame).toHaveAttribute('data-rendered', id);
    expect(new URL(page.url()).searchParams.get('state')).toBe(id);
  }
});

test('initial state comes from ?state= and arrow keys step', async ({ page, server }) => {
  const second = STATES[1];
  await page.goto(`${server.url}/emulator/dev/?state=${second}`);
  await expect(page.locator('#state')).toHaveValue(second);
  await page.locator('body').click();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#state')).toHaveValue(STATES[2]);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#state')).toHaveValue(second);
});

test('iframe is 1280x400 CSS px and the strip is scaled uniformly', async ({ page }) => {
  const size = await page.locator('#view').evaluate((f) => [f.offsetWidth, f.offsetHeight]);
  expect(size).toEqual([PANEL.widthPx, PANEL.heightPx]);
  const box = await page.locator('#strip').boundingBox();
  expect(box.height / box.width).toBeCloseTo(PANEL.heightPx / PANEL.widthPx, 2);
});

test('default is the CSS nominal scale', async ({ page }) => {
  expect(await pxPerMm(page)).toBeCloseTo(NOMINAL, 3);
  expect(Math.abs((await stripWidth(page)) - expectedStrip(NOMINAL))).toBeLessThan(1);
});

test('monitor diagonal and resolution set the scale', async ({ page }) => {
  await page.locator('#res-w').fill('1920');
  await page.locator('#res-h').fill('1080');
  await page.locator('#diagonal').fill('24');
  const expected = Math.hypot(1920, 1080) / (24 * 25.4);
  expect(await pxPerMm(page)).toBeCloseTo(expected, 3);
  expect(Math.abs((await stripWidth(page)) - expectedStrip(expected))).toBeLessThan(1);
});

test('card width sets the scale and persists across reload', async ({ page }) => {
  await page.locator('#card-width').fill('300');
  const expected = 300 / 85.6;
  expect(await pxPerMm(page)).toBeCloseTo(expected, 3);
  expect(Math.abs((await stripWidth(page)) - expectedStrip(expected))).toBeLessThan(1);
  await page.reload();
  expect(await pxPerMm(page)).toBeCloseTo(expected, 3);
});

test('reset returns to the nominal scale', async ({ page }) => {
  await page.locator('#card-width').fill('300');
  await page.locator('#reset').click();
  expect(await pxPerMm(page)).toBeCloseTo(NOMINAL, 3);
  expect(Math.abs((await stripWidth(page)) - expectedStrip(NOMINAL))).toBeLessThan(1);
  await page.reload();
  expect(await pxPerMm(page)).toBeCloseTo(NOMINAL, 3);
});
