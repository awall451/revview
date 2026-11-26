import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';
import { startServer } from '../serve.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function shotsDir() {
  return process.env.REVVIEW_SHOTS_DIR || path.join(repoRoot, 'out', 'shots');
}

// Takes the day shot <name>.png, then the night look as night-<name>.png (the gallery is flat); both must be 1280x400.
// The day shot is the page as it is, with the look forced to day. The night shot is a real render: the last state given to the
// view is rendered again with look 'night' (or `nightState`, when the state itself reads differently at night, e.g. the Settings
// Look row), through window.revviewRender; then the page goes back to what it was, in the day look.
export async function shootBoth(page, name, nightState = null) {
  await page.evaluate(() => { document.documentElement.dataset.look = 'day'; });
  const day = `${name}.png`;
  const night = `night-${name}.png`;
  await shootTo(page, day);
  const original = await page.evaluate((ns) => {
    const last = window.revviewLastState();
    window.revviewRender(ns ?? { ...last, look: 'night' });
    return last;
  }, nightState);
  await shootTo(page, night);
  await page.evaluate((last) => {
    window.revviewRender(last);
    document.documentElement.dataset.look = 'day';
  }, original);
}

async function shootTo(page, file) {
  const full = path.join(shotsDir(), file);
  await page.screenshot({ path: full });
  const b = fs.readFileSync(full);
  expect([b.readUInt32BE(16), b.readUInt32BE(20)], file).toEqual([1280, 400]);
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
