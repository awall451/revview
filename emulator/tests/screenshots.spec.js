import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, shotsDir } from './harness.js';
import { startLiveServer } from '../../src/server/index.js';
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

test('screenshot more-sessions (others and a lower-bound diff) is 1280x400', async ({ openView, page }) => {
  const file = path.join(shotsDir(), 'more-sessions.png');
  await openView({ ...loadFixture('working'), others: 2, diffIncomplete: true });
  await expect(page.locator('#others')).toHaveText('+2');
  await expect(page.locator('#diff-approx')).toBeVisible();
  await page.screenshot({ path: file });
  expectPng1280x400(file);
});

test('screenshot boot page is 1280x400', async ({ page }) => {
  const file = path.join(shotsDir(), 'boot.png');
  // a port with nothing listening: take a free one by starting and closing a server
  const s = await startLiveServer({ port: 0 });
  const port = s.port;
  await s.close();
  const boot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/view/boot.html');
  await page.goto(`file://${boot}?port=${port}`);
  await expect(page.locator('#state-word')).toHaveText('NO LINK');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file });
  expectPng1280x400(file);
});

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
