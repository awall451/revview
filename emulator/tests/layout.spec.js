import { test, expect } from './harness.js';
import { FIXTURE_IDS, loadFixture } from '../fixtures.js';
import { LIMITS } from '../../src/state/format.js';
import { textSizeMm } from '../mm.js';
import { PANEL } from '../panel.js';

async function expectFits(page) {
  const m = await page.evaluate(({ w, h }) => {
    const de = document.documentElement;
    const outside = [];
    for (const el of document.querySelectorAll('body, body *')) {
      const r = el.getBoundingClientRect();
      if (r.left < 0 || r.top < 0 || r.right > w || r.bottom > h) {
        outside.push(`${el.tagName}#${el.id} ${[r.left, r.top, r.right, r.bottom].join(',')}`);
      }
    }
    return {
      sw: de.scrollWidth, sh: de.scrollHeight, iw: window.innerWidth, ih: window.innerHeight,
      cw: de.clientWidth, ch: de.clientHeight, outside,
    };
  }, { w: PANEL.widthPx, h: PANEL.heightPx });
  expect(m.sw).toBeLessThanOrEqual(PANEL.widthPx);
  expect(m.sh).toBeLessThanOrEqual(PANEL.heightPx);
  expect([m.iw, m.ih, m.cw, m.ch]).toEqual([PANEL.widthPx, PANEL.heightPx, PANEL.widthPx, PANEL.heightPx]);
  expect(m.outside).toEqual([]);
}

for (const id of FIXTURE_IDS) {
  test(`fixture ${id} fits the panel`, async ({ openView, page }) => {
    await openView(id);
    await expectFits(page);
    const word = page.locator('#state-word');
    await expect(word).toBeVisible();
    await expect(word).toHaveText(/\S/);
    expect((await textSizeMm(word)).capHeightMm).toBeGreaterThanOrEqual(10);
    await expect(page.locator('body')).toHaveAttribute('data-view', loadFixture(id).view);
  }, { w: PANEL.widthPx, h: PANEL.heightPx });
}

test('worst case: every field at its limit', async ({ openView, page }) => {
  const s = loadFixture('working');
  const fill = (n) => 'W'.repeat(n);
  const state = {
    ...s, repo: fill(LIMITS.path), branch: fill(LIMITS.path), tool: fill(LIMITS.path),
    file: fill(LIMITS.path), command: fill(LIMITS.command), output: fill(LIMITS.output),
    diff: { added: 999999, removed: 999999 },
  };
  await openView(state);
  await expectFits(page);
});
