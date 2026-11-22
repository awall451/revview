// WB4 end to end: wheel buttons as KEY PRESSES (dev key bridge) -> gestures -> actions -> board -> SSE -> the page.
// A fake runner (no tmux) records every send and start; the page shows what the board decided.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect } from './harness.js';
import { startLiveServer } from '../../src/server/index.js';

const html = (page) => page.locator('html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeRunner(ids = []) {
  const rows = ids.map((id, i) => ({ id, window: `@${i + 1}`, cwd: `/tmp/wb4/repo${i + 1}`, name: `repo${i + 1}` }));
  const calls = { send: [], start: [] };
  return {
    calls,
    list: async () => rows.map((r) => ({ ...r })),
    target: async (id) => { const r = rows.find((x) => x.id === id); return r ? { id: r.id, window: r.window } : null; },
    send: async (key, id) => {
      calls.send.push([key, id]);
      const r = rows.find((x) => x.id === id);
      return r ? { sent: true, id, window: r.window } : { sent: false, reason: 'gone' };
    },
    start: async ({ cwd }) => {
      calls.start.push(cwd);
      const id = randomUUID();
      rows.push({ id, window: `@${rows.length + 1}`, cwd, name: path.basename(cwd) });
      return { id, window: `@${rows.length}`, cwd };
    },
  };
}

async function post(server, body) {
  return fetch(`${server.url}/event`, { method: 'POST', body: JSON.stringify(body) });
}

const hook = (id, cwd, name, extra = {}) => ({
  session_id: id, transcript_path: `/tmp/wb4/${id}.jsonl`, cwd, hook_event_name: name, ...extra,
});

async function startSession(server, id, repo) {
  const cwd = `/tmp/wb4/${repo}`;
  expect((await post(server, hook(id, cwd, 'SessionStart', { source: 'startup', model: 'claude-haiku-5-5' }))).status).toBe(204);
  expect((await post(server, hook(id, cwd, 'UserPromptSubmit', { prompt: 'hi', permission_mode: 'default' }))).status).toBe(204);
  expect((await post(server, hook(id, cwd, 'Stop', { stop_hook_active: false, last_assistant_message: 'ok' }))).status).toBe(204);
}

async function withBoard(opts, fn, n = 3) {
  const ids = Array.from({ length: n }, () => randomUUID());
  const runner = fakeRunner(ids);
  const server = await startLiveServer({ port: 0, devBridge: true, sessions: runner, ...opts });
  try {
    for (const [i, id] of ids.entries()) {
      await startSession(server, id, `repo${i + 1}`);
      await sleep(5);
    }
    await server.refreshOwned();
    server.select(ids[0]);
    await fn({ server, runner, ids });
  } finally {
    await server.close();
  }
}

async function open(page, server) {
  await page.goto(`${server.url}/?devkeys=1`);
  await expect(html(page)).toHaveAttribute('data-link', 'up');
  await expect(html(page)).toHaveAttribute('data-rendered', /.+/);
  await page.locator('body').click();
  const cdp = await page.context().newCDPSession(page);
  const vk = (name) => 124 + Number(name.slice(1)) - 13;
  const ev = (type, name) => cdp.send('Input.dispatchKeyEvent', { type, code: name, key: name, windowsVirtualKeyCode: vk(name) });
  return {
    // a pause after each tap: the same key pressed again within the debounce (30 ms) is a bounce, not a press
    tap: async (name) => { await ev('keyDown', name); await ev('keyUp', name); await sleep(100); },
    hold: async (name, ms = 600) => { await ev('keyDown', name); await sleep(ms); await ev('keyUp', name); },
  };
}

const position = (page) => page.locator('#position');
const where = (page) => page.locator('#where');
const nav = (page) => page.locator('#nav');
const selectedRow = (page) => page.locator('#nav .row[data-selected="true"]');

test.describe('WB4 wheel buttons by key presses', () => {
  test('switch: right and left move the position, wraps, push-to-talk goes to the shown session', async ({ page }) => {
    await withBoard({}, async ({ server, runner, ids }) => {
      const k = await open(page, server);
      await expect(position(page)).toHaveText('1/3');
      await expect(where(page)).toContainText('repo1');
      await k.tap('F20');
      await expect(position(page)).toHaveText('2/3');
      await expect(where(page)).toContainText('repo2');
      await k.tap('F19');
      await expect(position(page)).toHaveText('1/3');
      await expect(where(page)).toContainText('repo1');
      await k.tap('F19'); // wraps
      await expect(position(page)).toHaveText('3/3');
      await expect(where(page)).toContainText('repo3');
      await k.tap('F13');
      await expect.poll(() => runner.calls.send).toEqual([['Space', ids[2]]]);
    });
  });

  test('list: down opens it, down moves, press chooses; push-to-talk and deny do nothing while it is open', async ({ page }) => {
    await withBoard({}, async ({ server, runner, ids }) => {
      const k = await open(page, server);
      await expect(position(page)).toHaveText('1/3');
      await k.tap('F18');
      await expect(nav(page)).toBeVisible();
      await expect(page.locator('#nav-title')).toHaveText('SESSIONS');
      await expect(page.locator('#nav .row')).toHaveCount(3);
      await expect(selectedRow(page)).toHaveCount(1);
      await expect(selectedRow(page)).toContainText('repo1');
      await k.tap('F18');
      await expect(selectedRow(page)).toContainText('repo2');

      await k.tap('F13');
      await k.tap('F16');
      await sleep(400);
      expect(runner.calls.send).toEqual([]);
      await expect(nav(page)).toBeVisible();

      await k.tap('F21');
      await expect(nav(page)).toBeHidden();
      await expect(position(page)).toHaveText('2/3');
      await k.tap('F13');
      await expect.poll(() => runner.calls.send).toEqual([['Space', ids[1]]]);
    });
  });

  test('back: a tap closes the list; menu, Projects, back to MENU with Projects highlighted, back closes', async ({ page }) => {
    await withBoard({ projects: [os.tmpdir()] }, async ({ server }) => {
      const k = await open(page, server);
      await k.tap('F18');
      await expect(page.locator('#nav-title')).toHaveText('SESSIONS');
      await k.tap('F22');
      await expect(nav(page)).toBeHidden();

      await k.tap('F23');
      await expect(page.locator('#nav-title')).toHaveText('MENU');
      await k.tap('F18'); // down to Projects
      await expect(selectedRow(page)).toContainText('Projects');
      await k.tap('F21');
      await expect(page.locator('#nav-title')).toHaveText('PROJECTS');
      await k.tap('F22');
      await expect(page.locator('#nav-title')).toHaveText('MENU');
      await expect(selectedRow(page)).toContainText('Projects');
      await k.tap('F22');
      await expect(nav(page)).toBeHidden();
    });
  });

  test('home: a prompt elsewhere shows as a hint; holding back goes to that session', async ({ page }) => {
    await withBoard({}, async ({ server, ids }) => {
      const k = await open(page, server);
      const cwd = '/tmp/wb4/repo3';
      await post(server, hook(ids[2], cwd, 'UserPromptSubmit', { prompt: 'run', permission_mode: 'default' }));
      await post(server, hook(ids[2], cwd, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_x1' }));
      await post(server, hook(ids[2], cwd, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } }));
      await expect(page.locator('#others svg')).toHaveCount(1);
      await expect(page.locator('#others')).toHaveAttribute('data-full', /need.* permission/);
      await expect(page.locator('#state-word')).not.toHaveText('NEEDS PERMISSION');
      await expect(position(page)).toHaveText('1/3');

      await k.hold('F22', 600);
      await expect(page.locator('#state-word')).toHaveText('NEEDS PERMISSION');
      await expect(position(page)).toHaveText('3/3');
      await expect(where(page)).toContainText('repo3');
    });
  });

  test('new session: menu, New session, second project starts there and the band shows it selected', async ({ page }) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wb4-proj-'));
    const dirs = ['one', 'two'].map((d) => { const p = path.join(base, d); fs.mkdirSync(p); return p; });
    try {
      await withBoard({ projects: dirs }, async ({ server, runner }) => {
        const k = await open(page, server);
        await expect(position(page)).toHaveText('1/1');
        await k.tap('F23');
        await expect(page.locator('#nav-title')).toHaveText('MENU');
        await k.tap('F21');
        await expect(page.locator('#nav-title')).toHaveText(/^NEW SESSION/);
        await expect(page.locator('#nav .row')).toHaveCount(2);
        await k.tap('F18');
        await expect(selectedRow(page)).toContainText('two');
        await k.tap('F21');
        await expect.poll(() => runner.calls.start).toEqual([dirs[1]]);
        await expect(nav(page)).toBeHidden();
        const [{ id }] = (await runner.list()).slice(-1);
        await startSession(server, id, 'two');
        await expect(position(page)).toHaveText('2/2');
        await expect(where(page)).toContainText('two');
        expect(runner.calls.start).toHaveLength(1);
      }, 1);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test('timeout: an open list closes by itself', async ({ page }) => {
    await withBoard({ navTimeoutMs: 1500 }, async ({ server }) => {
      const k = await open(page, server);
      await k.tap('F18');
      await expect(nav(page)).toBeVisible();
      await sleep(900);
      await expect(nav(page)).toBeVisible();
      await expect(nav(page)).toBeHidden({ timeout: 2500 });
    });
  });

  test('a posted RevviewNav or RevviewSelect gets 403 and the page does not change', async ({ page }) => {
    await withBoard({}, async ({ server, ids }) => {
      await open(page, server);
      await expect(position(page)).toHaveText('1/3');
      const seq = await html(page).getAttribute('data-seq');
      expect((await post(server, { hook_event_name: 'RevviewNav', button: 'down', gesture: 'tap' })).status).toBe(403);
      expect((await post(server, { hook_event_name: 'RevviewSelect', session_id: ids[2] })).status).toBe(403);
      await sleep(400);
      await expect(nav(page)).toBeHidden();
      await expect(position(page)).toHaveText('1/3');
      await expect(html(page)).toHaveAttribute('data-seq', seq);
    });
  });
});
