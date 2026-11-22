// The quiet NO BUTTONS tag: shown only when the wheel buttons are known to be missing, never a state takeover.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, shotsDir } from './harness.js';
import { FIXTURE_IDS, loadFixture } from '../fixtures.js';
import { expectFits, checkContrastAndFloor } from './checks.js';
import { textSizeMm } from '../mm.js';
import { RANGE_MM } from '../../src/view/type.js';

const branch = 'feature/very-long-branch-name-for-refund-flow-fix-with-many-more-words-to-be-sure-it-overflows-the-band-2026';
const worst = { ...loadFixture('permission'), repo: 'a-very-long-repository-name-for-the-worst-case', branch, others: 12 };
const NO_TAG = new Set(['starting', 'no-link']);
const rect = (page, sel) => page.locator(sel).evaluate((e) => {
  const r = e.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
});
const look = (page) => page.evaluate(() => ({
  bg: getComputedStyle(document.getElementById('band')).backgroundColor,
  word: document.getElementById('state-word').textContent,
  shape: document.getElementById('shape').innerHTML,
  view: document.body.dataset.view,
}));

test.beforeAll(() => {
  fs.mkdirSync(shotsDir(), { recursive: true });
});

for (const id of FIXTURE_IDS) {
  test(`${id}: tag is ${NO_TAG.has(id) ? 'hidden' : 'shown'} when buttons are missing, and changes nothing else`, async ({ openView, page }, testInfo) => {
    const fx = loadFixture(id);
    await openView({ ...fx, buttons: 'unknown' });
    const plain = await look(page);
    await expect(page.locator('#buttons-tag')).toBeHidden();
    for (const value of ['present', 'unknown', 'bogus', true, null]) {
      await openView({ ...fx, buttons: value });
      await expect(page.locator('#buttons-tag')).toBeHidden();
    }
    await openView({ ...fx, buttons: 'missing' });
    expect(await look(page)).toEqual(plain);
    const tag = page.locator('#buttons-tag');
    if (NO_TAG.has(id)) {
      await expect(tag).toBeHidden();
      return;
    }
    await expect(tag).toBeVisible();
    await expect(tag).toHaveText('NO BUTTONS');
    await expect(tag).toHaveAttribute('data-full', 'Wheel buttons not found: the buttons do nothing');
    await expectFits(page);
    await checkContrastAndFloor(page, `buttons-tag/${id}`, testInfo);
    const mm = (await textSizeMm(tag)).capHeightMm;
    expect(mm).toBeGreaterThanOrEqual(RANGE_MM.text[0]);
    expect(mm).toBeLessThanOrEqual(RANGE_MM.text[1]);
    const word = (await textSizeMm(page.locator('#state-word'))).capHeightMm;
    expect(word).toBeGreaterThanOrEqual(RANGE_MM.state[0]);
    expect(word).toBeLessThanOrEqual(RANGE_MM.state[1]);
    // right end of the band, vertically centred in it, 2 px outline in the band's text colour
    const t = await rect(page, '#buttons-tag');
    const band = await rect(page, '#band');
    expect(t.right).toBeLessThanOrEqual(1280 - 10);
    expect(Math.abs((t.top + t.bottom) / 2 - (band.top + band.bottom) / 2)).toBeLessThanOrEqual(1);
    const css = await tag.evaluate((e) => {
      const c = getComputedStyle(e);
      return { w: c.borderTopWidth, style: c.borderTopStyle, border: c.borderTopColor, color: c.color, bg: c.backgroundColor, weight: c.fontWeight };
    });
    expect(css).toEqual({ w: '2px', style: 'solid', border: css.color, color: 'rgb(0, 0, 0)', bg: 'rgba(0, 0, 0, 0)', weight: '700' });
    console.log(`buttons-tag/${id} cap height ${mm.toFixed(2)} mm`);
  });
}

test('worst band (permission, 12 others, long repo and branch): tag, hint and state word do not overlap', async ({ openView, page }, testInfo) => {
  await openView({ ...worst, buttons: 'missing' });
  await expect(page.locator('#buttons-tag')).toBeVisible();
  await expect(page.locator('#others')).toHaveText('9+');
  const word = await rect(page, '#state-word');
  const others = await rect(page, '#others');
  const tag = await rect(page, '#buttons-tag');
  expect(word.right).toBeLessThanOrEqual(others.left + 0.5);
  expect(others.right).toBeLessThanOrEqual(tag.left + 0.5);
  expect(tag.right).toBeLessThanOrEqual(1280);
  if (await page.locator('#where').isVisible()) {
    const w = await rect(page, '#where');
    expect(others.right).toBeLessThanOrEqual(w.left + 0.5);
    expect(w.right).toBeLessThanOrEqual(tag.left + 0.5);
  }
  await expectFits(page);
  await checkContrastAndFloor(page, 'buttons-tag/worst', testInfo);
  // the same band without the tag shows the same words
  await openView({ ...worst, buttons: 'present' });
  expect(await page.locator('#state-word').textContent()).toBe('NEEDS PERMISSION');
  expect(await page.locator('#others').textContent()).toBe('9+');
});

test('screenshot no-buttons is 1280x400', async ({ openView, page }) => {
  const file = path.join(shotsDir(), 'no-buttons.png');
  await openView({ ...loadFixture('working'), buttons: 'missing' });
  await expect(page.locator('#buttons-tag')).toBeVisible();
  await page.screenshot({ path: file });
  const b = fs.readFileSync(file);
  expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([1280, 400]);
});

test('screenshot no-buttons-permission (worst band) is 1280x400', async ({ openView, page }) => {
  const file = path.join(shotsDir(), 'no-buttons-permission.png');
  await openView({ ...worst, buttons: 'missing' });
  await expect(page.locator('#buttons-tag')).toBeVisible();
  await page.screenshot({ path: file });
  const b = fs.readFileSync(file);
  expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([1280, 400]);
});
