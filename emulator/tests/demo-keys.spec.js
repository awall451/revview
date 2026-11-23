// The demo keys typed in the page (1-9, P, [ ]) reach the demo player through the server (POST /dev/key -> GET /dev/demo)
// and never the bar's own key map: real startLiveServer with devBridge + devKeys + devDemo, a real player on a FAKE
// clock that never fires (so only keys move it), and the page at /?devkeys=1.
import os from 'node:os';
import { test, expect } from './harness.js';
import { startLiveServer } from '../../src/server/index.js';
import { loadConfig } from '../../src/input/keymap.js';
import { createPlayer } from '../demo/player.js';

const html = (page) => page.locator('html');
const body = (page) => page.locator('body');
const title = (page) => page.locator('#nav-title');

const emptyRunner = () => ({
  list: async () => [],
  target: async () => null,
  send: async () => ({ sent: false, reason: 'gone' }),
  start: async () => { throw new Error('not expected'); },
});

// timers are recorded and never run
const fakeClock = { setTimeout: () => 1, clearTimeout: () => {} };

async function withDemo(fn) {
  const server = await startLiveServer({
    port: 0, devBridge: true, devKeys: loadConfig('config/buttons.laptop.json'), devDemo: true, sessions: emptyRunner(), projects: [os.tmpdir()],
  });
  const player = createPlayer({ url: server.url, clock: fakeClock, log: () => {} });
  try {
    player.start();
    await fn({ server, player });
  } finally {
    player.stop();
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
}

const tap = async (page, key) => {
  await page.keyboard.down(key);
  await page.keyboard.up(key);
  await page.waitForTimeout(100);
};

test.describe('demo keys through the dev bridge', () => {
  test('1-7 jump to a scene, P pauses, ] and [ change the speed, and a laptop key still reaches the bar', async ({ page }) => {
    await withDemo(async ({ server, player }) => {
      await open(page, server);

      await tap(page, '2');
      await expect(body(page)).toHaveAttribute('data-view', 'permission');
      await expect.poll(() => player.status().scene).toBe(2); // the next scene to play

      await tap(page, '6');
      await expect(body(page)).toHaveAttribute('data-view', 'insert-key');
      await expect.poll(() => player.status().scene).toBe(6);

      expect(player.status().paused).toBe(false);
      await tap(page, 'p');
      await expect.poll(() => player.status().paused).toBe(true);
      await tap(page, 'p');
      await expect.poll(() => player.status().paused).toBe(false);
      await tap(page, 'p');
      await expect.poll(() => player.status().paused).toBe(true);

      expect(player.status().speed).toBe(1);
      await tap(page, ']');
      await expect.poll(() => player.status().speed).toBe(2);
      await tap(page, '[');
      await tap(page, '[');
      await expect.poll(() => player.status().speed).toBe(0.5);

      // no collision: a bar key still works and was not taken by the player
      await tap(page, 'm');
      await expect(page.locator('#nav')).toBeVisible();
      await expect(title(page)).toHaveText('MENU');
      expect(player.status().paused).toBe(true);
      await tap(page, 'Backspace');
      await expect(page.locator('#nav')).toBeHidden();
    });
  });
});
