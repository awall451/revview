// The dev bridge driven by ordinary laptop keys: real startLiveServer with devBridge + the laptop key map
// (config/buttons.laptop.json) and the page at /?devkeys=1. Playwright's keyboard knows all these keys.
import os from 'node:os';
import { test, expect } from './harness.js';
import { startLiveServer } from '../../src/server/index.js';
import { loadConfig } from '../../src/input/keymap.js';

const html = (page) => page.locator('html');
const nav = (page) => page.locator('#nav');
const title = (page) => page.locator('#nav-title');
const selectedRow = (page) => page.locator('#nav .row[data-selected="true"]');

const emptyRunner = () => ({
  list: async () => [],
  target: async () => null,
  send: async () => ({ sent: false, reason: 'gone' }),
  start: async () => { throw new Error('not expected'); },
});

async function withLaptop(fn) {
  const server = await startLiveServer({
    port: 0, devBridge: true, devKeys: loadConfig('config/buttons.laptop.json'), sessions: emptyRunner(), projects: [os.tmpdir()],
  });
  try {
    await fn(server);
  } finally {
    await server.close();
  }
}

async function open(page, server) {
  await page.goto(`${server.url}/?devkeys=1`);
  await expect(html(page)).toHaveAttribute('data-link', 'up');
  await expect(html(page)).toHaveAttribute('data-rendered', /.+/);
  await page.locator('body').click();
  // the page has fetched /dev/keys once a key's default action is prevented
  await page.evaluate(() => { window.__prevented = []; window.addEventListener('keydown', (e) => window.__prevented.push([e.code, e.defaultPrevented])); });
  await expect.poll(async () => {
    await page.keyboard.press('Space');
    return page.evaluate(() => window.__prevented.at(-1)?.[1]);
  }).toBe(true);
  // the Space presses above made push-to-talk taps; none of them may have left anything open
  await expect(nav(page)).toBeHidden();
}

// a pause after each tap: the same key pressed again within the debounce (30 ms) is a bounce
const tap = async (page, key) => {
  await page.keyboard.down(key);
  await page.keyboard.up(key);
  await page.waitForTimeout(100);
};

const hold = async (page, key) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(600); // a hold, not an assertion: longer than the 400 ms hold time
  await page.keyboard.up(key);
  await page.waitForTimeout(100);
};

test.describe('laptop keys through the dev bridge', () => {
  test('M opens the menu, arrows move the selection, Backspace closes it', async ({ page }) => {
    await withLaptop(async (server) => {
      await open(page, server);
      await tap(page, 'm');
      await expect(nav(page)).toBeVisible();
      await expect(title(page)).toHaveText('MENU');
      const first = (await selectedRow(page).textContent()) ?? '';
      await tap(page, 'ArrowDown');
      await expect.poll(async () => (await selectedRow(page).textContent()) ?? '').not.toBe(first);
      await tap(page, 'ArrowUp');
      await expect.poll(async () => (await selectedRow(page).textContent()) ?? '').toBe(first);
      await tap(page, 'ArrowDown');
      await expect(selectedRow(page)).toContainText('Projects');
      await tap(page, 'Enter');
      await expect(title(page)).toHaveText('PROJECTS');

      await tap(page, 'Backspace');
      await expect(title(page)).toHaveText('MENU');
      await expect(selectedRow(page)).toContainText('Projects');
      await tap(page, 'Backspace');
      await expect(nav(page)).toBeHidden();
    });
  });

  test('Backspace held also closes the menu', async ({ page }) => {
    await withLaptop(async (server) => {
      await open(page, server);
      await tap(page, 'm');
      await expect(nav(page)).toBeVisible();
      await hold(page, 'Backspace');
      await expect(nav(page)).toBeHidden();
    });
  });

  test('empty bar: Enter opens the session list, which says there are no sessions', async ({ page }) => {
    await withLaptop(async (server) => {
      await open(page, server);
      await tap(page, 'Enter');
      await expect(nav(page)).toBeVisible();
      await expect(title(page)).toHaveText('SESSIONS');
      await expect(nav(page)).toContainText('No sessions');
      await tap(page, 'Backspace');
      await expect(nav(page)).toBeHidden();
      await expect.poll(async () => (await (await fetch(`${server.url}/buttons`)).json()).gestures.map((g) => `${g.button}:${g.gesture}:${g.source}`)).toContain('press:tap:bridge');
    });
  });

  test('Space does not scroll the page: keydown default is prevented, scroll stays', async ({ page }) => {
    await withLaptop(async (server) => {
      await open(page, server);
      await page.evaluate(() => { document.body.style.minHeight = '5000px'; document.documentElement.style.overflow = 'auto'; });
      await page.keyboard.press('Space');
      await page.keyboard.press('ArrowDown');
      expect(await page.evaluate(() => window.__prevented.filter(([c]) => c === 'Space' || c === 'ArrowDown').every(([, p]) => p))).toBe(true);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });
  });

  test('a browser shortcut with Ctrl held is not prevented', async ({ page }) => {
    await withLaptop(async (server) => {
      await open(page, server);
      await page.keyboard.down('Control');
      await page.keyboard.down('m');
      const last = await page.evaluate(() => window.__prevented.at(-1));
      await page.keyboard.up('m');
      await page.keyboard.up('Control');
      expect(last).toEqual(['KeyM', false]);
    });
  });
});
