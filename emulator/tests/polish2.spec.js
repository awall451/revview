/* global navigator, caches */
// QA round 2026-11-22, view and server polish: issues 03, 08, 09, 10, 11 (view), 12, 13, 14.
import net from 'node:net';
import { test, expect } from './harness.js';
import { loadFixture } from '../fixtures.js';
import { startLiveServer } from '../../src/server/index.js';
import { expectFits, checkContrastAndFloor } from './checks.js';

const rect = (page, sel) => page.locator(sel).evaluate((e) => {
  const r = e.getBoundingClientRect();
  return { left: r.left, right: r.right, width: r.width };
});

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

async function listenOn(port) {
  let last;
  for (let i = 0; i < 50; i++) {
    try {
      return await startLiveServer({ port });
    } catch (e) {
      last = e;
      if (e.code !== 'EADDRINUSE') throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw last;
}

test.describe('03 the repo names the session that needs the driver', () => {
  for (const view of ['waiting', 'permission']) {
    for (const repo of ['api', 'revview', 'customer-billing-service']) {
      test(`${view} +1, repo ${repo}`, async ({ openView, page }, testInfo) => {
        await openView({ ...loadFixture('working'), view, activity: view, repo, branch: 'main', others: 1, tool: 'Read', file: 'a.py', command: null, output: null });
        const shown = page.locator('#where:visible, #session:visible');
        await expect(shown).toHaveCount(1);
        const text = await shown.first().textContent();
        expect(text.startsWith(repo.slice(0, 8)), text).toBe(true);
        const r = await rect(page, await shown.first().evaluate((e) => `#${e.id}`));
        expect(r.right).toBeLessThanOrEqual(1280);
        await expectFits(page);
        await checkContrastAndFloor(page, `03/${view}/${repo}`, testInfo);
      });
    }
  }
  test('with a command and output the repo still shows and nothing overlaps', async ({ openView, page }) => {
    await openView({
      ...loadFixture('working'), view: 'permission', activity: 'permission', repo: 'revview', others: 2, tool: 'Bash',
      command: 'git push --force origin main', output: 'remote: error: something long that fills the output line completely',
    });
    await expect(page.locator('#session')).toHaveText('revview');
    await expect(page.locator('#session')).toHaveAttribute('data-full', 'revview');
    await expectFits(page);
  });
  test('not shown without other sessions, nor when the band shows the repo', async ({ openView, page }) => {
    await openView({ ...loadFixture('waiting'), repo: 'revview', others: 0 });
    await expect(page.locator('#session')).toBeHidden();
    await openView({ ...loadFixture('working'), repo: 'revview', others: 1 });
    await expect(page.locator('#session')).toBeHidden();
    await expect(page.locator('#where')).toBeVisible();
  });
});

test('09 a short command is not cut when there is no output', async ({ openView, page }) => {
  const base = { ...loadFixture('working'), tool: 'Read', file: 'a.py', command: 'psql -f migrate.sql' };
  await openView({ ...base, output: null });
  await expect(page.locator('#command')).toHaveText('psql -f migrate.sql');
  expect(await page.locator('#command').evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
  const long = 'psql -f migrate.sql --host db.internal.example.com --port 5432 --user admin --dbname customers';
  await openView({ ...base, command: long, output: 'ERROR: relation does not exist' });
  expect((await rect(page, '#cmdbox')).width).toBeLessThanOrEqual(0.4 * 1280 + 1);
  await openView({ ...base, command: long, output: null });
  expect((await rect(page, '#cmdbox')).right).toBeLessThanOrEqual(1280);
  await expectFits(page);
});

test('10 the first paint is the NO LINK look, not an empty grey band', async ({ page }) => {
  const server = await startLiveServer({ port: 0 });
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route('**/view.js', async (route) => { await gate; await route.continue(); });
  await page.goto(`${server.url}/`, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.getElementById('state-word'), null, { polling: 50 });
  const look = await page.evaluate(() => ({
    view: document.body.dataset.view,
    word: document.getElementById('state-word').textContent,
    bg: getComputedStyle(document.getElementById('band')).backgroundColor,
    shape: document.getElementById('shape').innerHTML.length > 0,
  }));
  release();
  await server.close();
  expect(look).toEqual({ view: 'no-link', word: 'NO LINK', bg: 'rgb(0, 0, 0)', shape: true });
});

test.describe('11 a lower bound of zero is not shown as information', () => {
  test('no counted lines: +? −?, no ≥', async ({ openView, page }) => {
    await openView({ ...loadFixture('working'), diff: { added: 0, removed: 0 }, diffIncomplete: true });
    await expect(page.locator('#diff-approx')).toBeHidden();
    await expect(page.locator('#diff-added')).toHaveText('+?');
    await expect(page.locator('#diff-removed')).toHaveText('−?');
    await expect(page.locator('#diff')).toHaveAttribute('data-full', 'diff unknown (an event was too large to read)');
    await expectFits(page);
  });
  test('some counted lines keep the ≥ form', async ({ openView, page }) => {
    await openView({ ...loadFixture('working'), diff: { added: 5, removed: 0 }, diffIncomplete: true });
    await expect(page.locator('#diff-approx')).toHaveText('≥');
    await expect(page.locator('#diff-added')).toHaveText('+5');
    await expect(page.locator('#diff-removed')).toHaveText('−0');
  });
});

test.describe('12 the sessions hint fits next to NEEDS PERMISSION', () => {
  for (const others of [1, 9, 10, 11, 50, 1234]) {
    test(`+${others}`, async ({ openView, page }) => {
      await openView({ ...loadFixture('permission'), others });
      const t = await page.locator('#others').textContent();
      expect(t).toBe(others > 9 ? '9+' : `+${others}`);
      await expect(page.locator('#others')).toHaveAttribute('data-full', `${others} more Claude session${others === 1 ? "" : "s"}`);
      expect((await rect(page, '#others')).right).toBeLessThanOrEqual(1280);
      await expectFits(page);
    });
  }
});

test.describe('13 no dangling separator when the repo nearly fills the band', () => {
  for (const [repo, branch] of [['会計システム', '機能/返金フローの修正-第二版'], ['customer-billing-service', 'feature/refund-flow-fix-2026']]) {
    test(repo, async ({ openView, page }) => {
      await openView({ ...loadFixture('working'), repo, branch, others: 1 });
      const w = page.locator('#where');
      if (await w.isVisible()) {
        const text = (await w.textContent()).trim();
        expect(text, text).not.toMatch(/·\s*…?$/);
        expect(text.startsWith(repo.slice(0, 3)), text).toBe(true);
      }
      await expectFits(page);
    });
  }
});

test.describe('14 OFFLINE note wording', () => {
  const cases = [
    ['working', 'Claude: working'], ['waiting', 'Claude: waiting for me'], ['permission', 'Claude: needs permission'],
    ['done', 'Claude: done'], ['ended', 'Claude exited'], ['unknown', 'Claude: not known'],
  ];
  for (const [activity, note] of cases) {
    test(activity, async ({ openView, page }) => {
      await openView({ ...loadFixture('offline'), view: 'offline', activity });
      await expect(page.locator('#note1')).toHaveText(note);
      await expect(page.locator('#note2')).toHaveText('No network: voice input will not work');
    });
  }
});

test.describe('08 reload of the live page while the server is down', () => {
  test('the page still starts (NO LINK) and recovers by itself', async ({ page }) => {
    test.setTimeout(40000);
    const port = await freePort();
    let server = await listenOn(port);
    try {
      await page.goto(`${server.url}/`);
      await expect(page.locator('html')).toHaveAttribute('data-link', 'up');
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        for (let i = 0; i < 50 && !(await caches.keys()).length; i++) await new Promise((r) => setTimeout(r, 100));
      });
      // the page must be controlled by the worker before the server goes away
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-link', 'up');
      expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
      await server.close();
      await expect(page.locator('body')).toHaveAttribute('data-view', 'no-link');
      await page.waitForTimeout(1500);
      await page.reload();
      expect(page.url()).toBe(`http://127.0.0.1:${port}/`);
      await expect(page.locator('body')).toHaveAttribute('data-view', 'no-link');
      await expect(page.locator('#state-word')).toHaveText('NO LINK');
      server = await listenOn(port);
      await expect(page.locator('html')).toHaveAttribute('data-link', 'up', { timeout: 10000 });
      await expect(page.locator('body')).not.toHaveAttribute('data-view', 'no-link');
    } finally {
      await server.close();
    }
  });
});
