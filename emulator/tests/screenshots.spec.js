import fs from 'node:fs';
import path from 'node:path';
import { test, expect, shotsDir } from './harness.js';
import { FIXTURE_IDS } from '../fixtures.js';

test.beforeAll(() => {
  fs.mkdirSync(shotsDir(), { recursive: true });
  console.log(`screenshots: ${shotsDir()}`);
});

for (const id of FIXTURE_IDS) {
  test(`screenshot ${id} is 1280x400`, async ({ openView, page }) => {
    const file = path.join(shotsDir(), `${id}.png`);
    await openView(id);
    await page.screenshot({ path: file });
    const b = fs.readFileSync(file);
    expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([1280, 400]);
  });
}
