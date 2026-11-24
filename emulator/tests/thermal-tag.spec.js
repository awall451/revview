// The quiet HOT and LOW POWER tags: board-level marks (the box, not a session), never a state takeover.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, shotsDir } from './harness.js';
import { FIXTURE_IDS, loadFixture } from '../fixtures.js';
import { loadWorstCase, asPermission } from '../worst-case.js';
import { expectFits, checkContrastAndFloor } from './checks.js';
import { textSizeMm } from '../mm.js';
import { RANGE_MM } from '../../src/view/type.js';

const branch = 'feature/very-long-branch-name-for-refund-flow-fix-with-many-more-words-to-be-sure-it-overflows-the-band-2026';
const worst = { ...loadFixture('permission'), repo: 'a-very-long-repository-name-for-the-worst-case', branch, others: 12, elsewhere: 12, buttons: 'missing', hot: true, lowPower: true, voice: 'here', position: { index: 2, count: 3 } };
const NO_TAG = new Set(['no-link']);
const TAGS = [
  { sel: '#hot-tag', text: 'HOT', flag: 'hot', full: 'Pi is hot: it may be throttling, Claude and the bar can be slow' },
  { sel: '#power-tag', text: 'LOW POWER', flag: 'lowPower', full: 'Low power: weak supply (under-voltage), the Pi may be slow' },
];
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
  for (const t of TAGS) {
    test(`${id}: ${t.text} is ${NO_TAG.has(id) ? 'hidden' : 'shown'} when ${t.flag} is true, and changes nothing else`, async ({ openView, page }, testInfo) => {
      const fx = loadFixture(id);
      await openView({ ...fx });
      const plain = await look(page);
      const tag = page.locator(t.sel);
      await expect(tag).toBeHidden();
      for (const value of [false, undefined, 'true', 1, null, {}]) {
        await openView({ ...fx, [t.flag]: value });
        await expect(tag).toBeHidden();
        await expect(tag).toHaveAttribute('data-full', '');
      }
      await openView({ ...fx, [t.flag]: true });
      expect(await look(page)).toEqual(plain);
      if (NO_TAG.has(id)) {
        await expect(tag).toBeHidden();
        return;
      }
      await expect(tag).toBeVisible();
      await expect(tag).toHaveText(t.text);
      await expect(tag).toHaveAttribute('data-full', t.full);
      await expectFits(page);
      await checkContrastAndFloor(page, `thermal-tag/${t.flag}/${id}`, testInfo);
      const mm = (await textSizeMm(tag)).capHeightMm;
      expect(mm).toBeGreaterThanOrEqual(RANGE_MM.text[0]);
      expect(mm).toBeLessThanOrEqual(RANGE_MM.text[1]);
      const word = (await textSizeMm(page.locator('#state-word'))).capHeightMm;
      expect(word).toBeGreaterThanOrEqual(RANGE_MM.state[0]);
      expect(word).toBeLessThanOrEqual(RANGE_MM.state[1]);
      const r = await rect(page, t.sel);
      const band = await rect(page, '#band');
      expect(r.right).toBeLessThanOrEqual(1280 - 10);
      expect(Math.abs((r.top + r.bottom) / 2 - (band.top + band.bottom) / 2)).toBeLessThanOrEqual(1);
      const css = await tag.evaluate((e) => {
        const c = getComputedStyle(e);
        return { w: c.borderTopWidth, style: c.borderTopStyle, border: c.borderTopColor, color: c.color, bg: c.backgroundColor, weight: c.fontWeight };
      });
      expect(css).toEqual({ w: '2px', style: 'solid', border: css.color, color: 'rgb(0, 0, 0)', bg: 'rgba(0, 0, 0, 0)', weight: '700' });
    });
  }

  test(`${id}: both tags and NO BUTTONS together stay inside the band, in order, without overlap`, async ({ openView, page }, testInfo) => {
    await openView({ ...loadFixture(id), hot: true, lowPower: true, buttons: 'missing' });
    if (NO_TAG.has(id)) {
      await expect(page.locator('#hot-tag')).toBeHidden();
      await expect(page.locator('#power-tag')).toBeHidden();
      return;
    }
    // what does not fit gives way (LOW POWER first, then HOT); NO BUTTONS and the state word never do
    const hot = await page.locator('#hot-tag').isVisible();
    const power = await page.locator('#power-tag').isVisible();
    if (power) expect(hot).toBe(true);
    if (id !== 'permission') expect([hot, power]).toEqual([true, true]);
    await expect(page.locator('#state-word')).toBeVisible();
    const sels = [...(hot ? ['#hot-tag'] : []), ...(power ? ['#power-tag'] : []), ...(id === 'starting' ? [] : ['#buttons-tag'])];
    let prev = null;
    for (const s of sels) {
      await expect(page.locator(s)).toBeVisible();
      const r = await rect(page, s);
      if (prev) expect(prev.right).toBeLessThanOrEqual(r.left + 0.5);
      prev = r;
    }
    expect(prev.right).toBeLessThanOrEqual(1280 - 10 + 0.5);
    await expectFits(page);
    await checkContrastAndFloor(page, `thermal-tag/all/${id}`, testInfo);
  });
}

test('worst band (permission, 9+, voice, NO BUTTONS, HOT, LOW POWER, long repo and branch): LOW POWER gives way, nothing overlaps, the state word is whole', async ({ openView, page }, testInfo) => {
  await openView({ ...worst });
  // at the detail size not all three tags fit beside NEEDS PERMISSION, 9+ and the voice mark: LOW POWER gives way,
  // never the state word, the hint, the voice mark or NO BUTTONS
  for (const s of ['#hot-tag', '#buttons-tag', '#voice', '#others', '#state-word']) await expect(page.locator(s)).toBeVisible();
  await expect(page.locator('#power-tag')).toBeHidden();
  await expect(page.locator('#power-tag')).toHaveAttribute('data-full', '');
  await expect(page.locator('#state-word')).toHaveText('NEEDS PERMISSION');
  await expect(page.locator('#others')).toHaveText('9+');
  const fully = await page.locator('#state-word').evaluate((e) => e.scrollWidth <= e.clientWidth);
  expect(fully).toBe(true);
  const word = await rect(page, '#state-word');
  const others = await rect(page, '#others');
  const voice = await rect(page, '#voice');
  const hot = await rect(page, '#hot-tag');
  const btn = await rect(page, '#buttons-tag');
  expect(word.right).toBeLessThanOrEqual(others.left + 0.5);
  expect(others.right).toBeLessThanOrEqual(voice.left + 0.5);
  expect(voice.right).toBeLessThanOrEqual(hot.left + 0.5);
  expect(hot.right).toBeLessThanOrEqual(btn.left + 0.5);
  expect(btn.right).toBeLessThanOrEqual(1280 - 10);
  if (await page.locator('#where').isVisible()) {
    const w = await rect(page, '#where');
    expect(voice.right).toBeLessThanOrEqual(w.left + 0.5);
    expect(w.right).toBeLessThanOrEqual(hot.left + 0.5);
  }
  await expectFits(page);
  await checkContrastAndFloor(page, 'thermal-tag/worst', testInfo);
  // the same band without the tags shows the same words
  await openView({ ...worst, hot: false, lowPower: false });
  expect(await page.locator('#state-word').textContent()).toBe('NEEDS PERMISSION');
  expect(await page.locator('#others').textContent()).toBe('9+');
});

// the band-marks worst case (every band mark at once, long repo and branch) over each state with a band: nothing overflows
// the band at 1280x400 and the state word is whole
for (const id of FIXTURE_IDS.filter((v) => !NO_TAG.has(v))) {
  test(`worst case band-marks in ${id}: nothing overflows the band, the state word is whole`, async ({ openView, page }) => {
    const content = loadWorstCase('band-marks');
    await openView({ ...loadFixture(id), ...(id === 'permission' ? asPermission(content) : content) });
    await expectFits(page);
    const word = page.locator('#state-word');
    await expect(word).toBeVisible();
    expect(await word.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    const band = await rect(page, '#band');
    const inside = await page.evaluate(() => [...document.querySelectorAll('#band *')]
      .filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden')
      .map((e) => [e.id, e.getBoundingClientRect().right]));
    for (const [eid, right] of inside) expect(right, `#${eid}`).toBeLessThanOrEqual(Math.min(band.right, 1280) + 0.5);
    // HOT and LOW POWER only ever give way whole (shown with their words or hidden), NO BUTTONS stays
    if (id !== 'starting') await expect(page.locator('#buttons-tag')).toBeVisible();
    for (const t of TAGS) {
      if (await page.locator(t.sel).isVisible()) await expect(page.locator(t.sel)).toHaveText(t.text);
    }
  });
}

test('screenshot thermal-tags is 1280x400', async ({ openView, page }) => {
  const file = path.join(shotsDir(), 'thermal-tags.png');
  await openView({ ...worst });
  await page.screenshot({ path: file });
  const b = fs.readFileSync(file);
  expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([1280, 400]);
});
