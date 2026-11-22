// The boot page (src/view/boot.html): opened from file:// before the server may be up.
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './harness.js';
import { startLiveServer } from '../../src/server/index.js';
import { textSizeMm } from '../mm.js';
import { MIN_MM } from '../../src/view/type.js';
import { expectFits, checkContrastAndFloor } from './checks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const bootUrl = (port) => `file://${path.resolve(here, '../../src/view/boot.html')}?port=${port}`;

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const look = (page) => page.evaluate(() => {
  const cs = (id) => getComputedStyle(document.getElementById(id));
  return {
    shape: document.getElementById('shape').innerHTML,
    band: [cs('band').backgroundColor, cs('band').color, cs('band').borderTopWidth, cs('band').borderTopColor, cs('band').borderTopStyle],
    bodyBg: getComputedStyle(document.body).backgroundColor,
    word: document.getElementById('state-word').textContent,
    wordColor: cs('state-word').color,
  };
});

test.describe('boot page', () => {
  test('shows the no-link look, same as the view, and fits', async ({ page, openView }, testInfo) => {
    await openView({ view: 'no-link' });
    const ref = await look(page);
    const port = await freePort();
    await page.goto(bootUrl(port));
    await expect(page.locator('#state-word')).toHaveText('NO LINK');
    await page.evaluate(() => document.fonts.ready);
    expect(await look(page)).toEqual(ref);
    await expect(page.locator('#note1')).toHaveText('Waiting for the revview server');
    await expect(page.locator('#note2')).toHaveText('Retrying every second');
    await expectFits(page);
    const mm = (await textSizeMm(page.locator('#state-word'))).capHeightMm;
    console.log(`boot state word cap=${mm.toFixed(2)}mm`);
    expect(mm).toBeGreaterThanOrEqual(MIN_MM.state);
    await checkContrastAndFloor(page, 'boot', testInfo);
  });

  test('goes to the live view by itself once the server is up', async ({ page }) => {
    test.setTimeout(30000);
    const port = await freePort();
    await page.goto(bootUrl(port));
    await expect(page.locator('#state-word')).toHaveText('NO LINK');
    await page.waitForTimeout(2200);
    expect(page.url()).toContain('file://');
    const server = await startLiveServer({ port });
    try {
      await page.waitForURL(`http://127.0.0.1:${port}/`, { timeout: 5000 });
      await expect(page.locator('html')).toHaveAttribute('data-link', 'up');
      await expect(page.locator('body')).not.toHaveAttribute('data-view', 'no-link');
      await expect(page.locator('html')).toHaveAttribute('data-seq', '0');
    } finally {
      await server.close();
    }
  });

  test('a bad port parameter does not break the page', async ({ page }) => {
    await page.goto(bootUrl('12abc'));
    await expect(page.locator('#state-word')).toHaveText('NO LINK');
  });
});
