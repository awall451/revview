// The laptop emulator's lights strip (?lights=1): the page draws the lights module's real frames below the panel, and does
// not change a pixel of the 1280x400 panel.
import { test, expect } from './harness.js';
import { startLiveServer } from '../../src/server/index.js';
import { createNullDriver } from '../../src/lights/index.js';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const AMBER = '48,33,6'; // #ffb020 under the day cap 48
const BLUE = '18,33,48'; // #5eb1ff under the day cap 48
const ev = (name, extra = {}) => JSON.stringify({ session_id: A, cwd: '/w/alpha', hook_event_name: name, ...extra });

// fake time: the server's clock and timers are injected; the flash ticks are fired by hand (no sleeping in the tests)
const fakeTime = () => {
  const list = [];
  const state = { now: 0 };
  const timers = { setTimeout(fn, ms) { const t = { fn, ms, cleared: false, fired: false, unref() {} }; list.push(t); return t; }, clearTimeout(t) { if (t) t.cleared = true; } };
  const ticks = () => list.filter((t) => t.ms === 250 && !t.cleared && !t.fired);
  const tick = (now) => { state.now = now; const t = ticks().at(-1); expect(t, 'a flash tick is scheduled').toBeTruthy(); t.fired = true; t.fn(); };
  return { clock: () => state.now, timers, ticks, tick };
};

async function withServer(fn) {
  const ft = fakeTime();
  const server = await startLiveServer({
    port: 0, devBridge: true, clock: ft.clock, timers: ft.timers,
    lights: { config: { lights: 'on', leds: 8, driver: 'none', device: '/dev/spidev0.0', brightness: { day: 48, night: 12 } }, driver: createNullDriver() },
  });
  const post = async (name, extra) => { const r = await fetch(`${server.url}/event`, { method: 'POST', body: ev(name, extra) }); expect(r.status).toBe(204); };
  try { await fn(server, post, ft); } finally { await server.close(); }
}

const rgb = (page, i) => page.locator(`#led-${i}`).getAttribute('data-rgb');

test.use({ viewport: { width: 1280, height: 440 } });

test('led-0 flashes amber for a permission request and is steady for working', async ({ page }) => {
  await withServer(async (server, post, ft) => {
    await page.goto(`${server.url}/?devkeys=1&lights=1`);
    await expect(page.locator('#led-7')).toHaveCount(1);
    const box = await page.locator('#dev-lights').boundingBox();
    expect(box).toMatchObject({ x: 0, y: 400, width: 1280, height: 40 });
    await post('SessionStart');
    await post('UserPromptSubmit', { prompt: 'go' });
    await post('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } });
    await expect.poll(() => rgb(page, 0), { timeout: 8000 }).toBe(AMBER); // phase 0: on
    ft.tick(1000); // the second half of the slow flash
    await expect.poll(() => rgb(page, 0), { timeout: 8000 }).toBe('0,0,0');
    ft.tick(2000);
    await expect.poll(() => rgb(page, 0), { timeout: 8000 }).toBe(AMBER);
    expect(await rgb(page, 1)).toBe('0,0,0');
    await post('UserPromptSubmit', { prompt: 'again' });
    await expect.poll(() => rgb(page, 0), { timeout: 8000 }).toBe(BLUE);
    expect(ft.ticks().length, 'steady: no flash tick is left').toBe(0);
    const frame = async () => (await (await fetch(`${server.url}/dev/lights`)).json()).frame;
    const before = JSON.stringify(await frame());
    expect(JSON.stringify(await frame())).toBe(before);
    expect(await rgb(page, 0)).toBe(BLUE);
  });
});

test('the panel (clip 0,0,1280,400) is pixel-equal with and without lights=1', async ({ page }) => {
  await withServer(async (server, post) => {
    await post('SessionStart');
    await post('UserPromptSubmit', { prompt: 'go' });
    await post('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } });
    const shot = async (q) => {
      await page.goto(`${server.url}/?${q}`);
      await expect(page.locator('html')).toHaveAttribute('data-rendered', /.+/);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('#state-word')).toHaveText('NEEDS PERMISSION');
      const clip = { x: 0, y: 0, width: 1280, height: 400 };
      let prev = await page.screenshot({ clip });
      await expect(async () => { // settled: two shots in a row are equal
        const next = await page.screenshot({ clip });
        const same = next.equals(prev);
        prev = next;
        expect(same).toBe(true);
      }).toPass({ timeout: 10000 });
      return prev;
    };
    const without = await shot('devkeys=1');
    const withLights = await shot('devkeys=1&lights=1');
    await expect(page.locator('#led-0')).toHaveCount(1);
    expect(withLights.equals(without)).toBe(true);
  });
});
