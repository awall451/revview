// Night and day looks end to end: a long press of the menu button (dev key bridge, hold = 400 ms) flips the look, and the
// page says so with <html data-look>. (The attribute is set by the view; this test needs that part of the view.)
import { test, expect } from './harness.js';
import { startLiveServer } from '../../src/server/index.js';

const html = (page) => page.locator('html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a menu hold flips day to night and back; a menu tap still opens the menu', async ({ page }) => {
  const server = await startLiveServer({ port: 0, devBridge: true, look: { mode: 'day', night: { from: '21:00', to: '07:00' } } });
  try {
    await page.goto(`${server.url}/?devkeys=1`);
    await expect(html(page)).toHaveAttribute('data-link', 'up');
    await expect(html(page)).toHaveAttribute('data-rendered', /.+/);
    await page.locator('body').click();
    await expect(html(page)).toHaveAttribute('data-look', 'day');
    const cdp = await page.context().newCDPSession(page);
    const ev = (type) => cdp.send('Input.dispatchKeyEvent', { type, code: 'F23', key: 'F23', windowsVirtualKeyCode: 134 });
    const hold = async (ms = 600) => { await ev('keyDown'); await sleep(ms); await ev('keyUp'); };

    await hold();
    await expect(html(page)).toHaveAttribute('data-look', 'night');
    await expect(page.locator('#nav')).toBeHidden(); // a hold opens nothing
    await sleep(150);
    await hold();
    await expect(html(page)).toHaveAttribute('data-look', 'day');
    await expect(page.locator('#nav')).toBeHidden();

    await sleep(150);
    await ev('keyDown');
    await sleep(60);
    await ev('keyUp'); // a short press is a tap: the menu opens, the look stays
    await expect(page.locator('#nav')).toBeVisible();
    await expect(html(page)).toHaveAttribute('data-look', 'day');
  } finally {
    await server.close();
  }
});
