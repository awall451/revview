import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';
import { startServer } from '../serve.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function shotsDir() {
  return process.env.REVVIEW_SHOTS_DIR || path.join(repoRoot, 'out', 'shots');
}

// Takes the day shot <name>.png, then the same page in the night look as night-<name>.png (the gallery is flat); both must be 1280x400.
// The look is one attribute on <html> (view.css), so nothing is rendered again; the page goes back to day afterwards.
export async function shootBoth(page, name) {
  for (const [look, file] of [['day', `${name}.png`], ['night', `night-${name}.png`]]) {
    await page.evaluate((l) => { document.documentElement.dataset.look = l; }, look);
    const full = path.join(shotsDir(), file);
    await page.screenshot({ path: full });
    const b = fs.readFileSync(full);
    expect([b.readUInt32BE(16), b.readUInt32BE(20)], file).toEqual([1280, 400]);
  }
  await page.evaluate(() => { document.documentElement.dataset.look = 'day'; });
}

export const test = base.extend({
  server: [async ({}, use) => {
    const s = await startServer({ port: 0 });
    await use(s);
    await s.close();
  }, { scope: 'worker' }],

  // openView('working') loads a fixture; openView({...state}) passes the state in the URL.
  openView: async ({ page, server }, use) => {
    await use(async (stateOrId) => {
      const q = typeof stateOrId === 'string'
        ? `fixture=${encodeURIComponent(stateOrId)}`
        : `state=${encodeURIComponent(JSON.stringify(stateOrId))}`;
      await page.goto(`${server.url}/src/view/?${q}`);
      await page.waitForFunction(() => document.documentElement.dataset.rendered);
      await page.evaluate(() => document.fonts.ready);
      return page;
    });
  },
});

export { expect };
