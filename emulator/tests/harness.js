import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';
import { startServer } from '../serve.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function shotsDir() {
  return process.env.REVVIEW_SHOTS_DIR || path.join(repoRoot, 'out', 'shots');
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
