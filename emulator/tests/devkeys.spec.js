// End to end: key presses on the page -> /dev/key -> the same gesture detector as the device -> GET /buttons.
// Only with devBridge on and ?devkeys=1. Playwright's keyboard knows only F1-F12, so F13-F24 go through CDP.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './harness.js';
import { startLiveServer } from '../../src/server/index.js';
import { parseConfig } from '../../src/input/keymap.js';

const html = (page) => page.locator('html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gestures = async (s) => (await (await fetch(`${s.url}/buttons`)).json()).gestures;
const summary = async (s) => (await gestures(s)).map((g) => `${g.button}:${g.gesture}:${g.source}`);

async function withServer(opts, fn) {
  const server = await startLiveServer({ port: 0, ...opts });
  try {
    await fn(server);
  } finally {
    await server.close();
  }
}

async function openLive(page, server, query = '') {
  await page.goto(`${server.url}/${query}`);
  await expect(html(page)).toHaveAttribute('data-link', 'up');
  await expect(html(page)).toHaveAttribute('data-rendered', /.+/);
  await page.locator('body').click(); // focus the page so key events reach it
}

async function cdpKeys(page) {
  const cdp = await page.context().newCDPSession(page);
  const vk = (name) => 124 + Number(name.slice(1)) - 13; // F13 = 124 ... F24 = 135
  const send = (type, name, extra = {}) => cdp.send('Input.dispatchKeyEvent', {
    type, code: name, key: name, windowsVirtualKeyCode: vk(name), ...extra,
  });
  return {
    down: (name, autoRepeat = false) => send('keyDown', name, autoRepeat ? { autoRepeat: true } : {}),
    up: (name) => send('keyUp', name),
  };
}

test.describe('dev key bridge', () => {
  test('F13 tap, F14 hold, F15 long-hold, F17 autorepeat', async ({ page }) => {
    await withServer({ devBridge: true }, async (server) => {
      await openLive(page, server, '?devkeys=1');
      const k = await cdpKeys(page);

      await k.down('F13');
      await k.up('F13');
      await expect.poll(() => summary(server)).toEqual(['push-to-talk:tap:bridge']);

      await k.down('F14');
      await sleep(600);
      await k.up('F14');
      await expect.poll(() => summary(server)).toEqual(['push-to-talk:tap:bridge', 'read-aloud:hold:bridge']);

      await k.down('F15');
      await sleep(1200);
      await k.up('F15');
      await expect.poll(() => summary(server)).toEqual([
        'push-to-talk:tap:bridge', 'read-aloud:hold:bridge', 'cancel:long-hold:bridge',
      ]);

      await k.down('F17');
      for (let i = 0; i < 3; i++) await k.down('F17', true);
      await k.up('F17');
      await expect.poll(async () => (await summary(server)).filter((x) => x.startsWith('up:'))).toEqual(['up:tap:bridge']);
    });
  });

  test('a modifier combination from the config: Shift+F24', async ({ page }) => {
    const input = parseConfig({
      device: { path: join(tmpdir(), 'revview-no-such-device'), grab: false },
      buttons: [{ key: 'Shift+F24', button: 'combo-test' }],
    });
    await withServer({ devBridge: true, input, inputRetryMs: 100 }, async (server) => {
      await openLive(page, server, '?devkeys=1');
      const k = await cdpKeys(page);
      await page.keyboard.down('Shift');
      await k.down('F24');
      await k.up('F24');
      await page.keyboard.up('Shift');
      await expect.poll(() => summary(server)).toEqual(['combo-test:tap:bridge']);
    });
  });

  test('without devkeys=1 the page forwards nothing', async ({ page }) => {
    await withServer({ devBridge: true }, async (server) => {
      await openLive(page, server);
      const k = await cdpKeys(page);
      await k.down('F13');
      await k.up('F13');
      await sleep(400);
      expect(await gestures(server)).toEqual([]);
    });
  });

  test('losing page focus releases a held key without a gesture', async ({ page }) => {
    await withServer({ devBridge: true }, async (server) => {
      await openLive(page, server, '?devkeys=1');
      const k = await cdpKeys(page);
      await k.down('F15');
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await sleep(1200);
      expect(await gestures(server)).toEqual([]);
    });
  });
});

test.describe('NO BUTTONS end to end', () => {
  test('RevviewInput present:false shows the tag, present:true hides it', async ({ page }) => {
    await withServer({}, async (server) => {
      await openLive(page, server);
      const post = (present) => fetch(`${server.url}/event`, { method: 'POST', body: JSON.stringify({ hook_event_name: 'RevviewInput', present }) });
      await post(false);
      await expect(page.locator('#buttons-tag')).toBeVisible();
      await post(true);
      await expect(page.locator('#buttons-tag')).toBeHidden();
    });
  });
});
