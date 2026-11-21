import fs from 'node:fs';
import path from 'node:path';
import { test, expect, shotsDir } from './harness.js';
import { FIXTURE_IDS, loadFixture } from '../fixtures.js';
import { WORST_CASE_IDS, loadWorstCase } from '../worst-case.js';

test.beforeAll(() => {
  fs.mkdirSync(shotsDir(), { recursive: true });
  console.log(`screenshots: ${shotsDir()}`);
});

function expectPng1280x400(file) {
  const b = fs.readFileSync(file);
  expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([1280, 400]);
}

for (const id of FIXTURE_IDS) {
  test(`screenshot ${id} is 1280x400`, async ({ openView, page }) => {
    const file = path.join(shotsDir(), `${id}.png`);
    await openView(id);
    await expect(page.locator('body')).toHaveAttribute('data-view', loadFixture(id).view);
    await expect(page.locator('html')).toHaveAttribute('data-rendered', /\S/);
    await page.screenshot({ path: file });
    expectPng1280x400(file);
  });
}

for (const wc of WORST_CASE_IDS) {
  for (const [view, suffix] of [['working', ''], ['permission', '-permission']]) {
    test(`screenshot worst case ${wc} (${view}) is 1280x400`, async ({ openView, page }) => {
      const file = path.join(shotsDir(), `worst-${wc}${suffix}.png`);
      await openView({ ...loadFixture(view), ...loadWorstCase(wc) });
      await expect(page.locator('body')).toHaveAttribute('data-view', view);
      await expect(page.locator('html')).toHaveAttribute('data-rendered', view);
      await page.screenshot({ path: file });
      expectPng1280x400(file);
    });
  }
}
