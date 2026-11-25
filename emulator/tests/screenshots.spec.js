import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, shotsDir } from './harness.js';
import { expectFits } from './checks.js';
import { startLiveServer } from '../../src/server/index.js';
import { FIXTURE_IDS, loadFixture } from '../fixtures.js';
import { WORST_CASE_IDS, loadWorstCase, loadAskingLong, asPermission } from '../worst-case.js';

test.beforeAll(() => {
  fs.mkdirSync(shotsDir(), { recursive: true });
  console.log(`screenshots: ${shotsDir()}`);
});

function expectPng1280x400(file) {
  const b = fs.readFileSync(file);
  expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([1280, 400]);
}

for (const id of FIXTURE_IDS) {
  test(`screenshot ${id} is 1280x400`, async ({ openView, page }) => {
    const file = path.join(shotsDir(), `${id}.png`);
    await openView(id);
    await expect(page.locator('body')).toHaveAttribute('data-view', loadFixture(id).view);
    await expect(page.locator('html')).toHaveAttribute('data-rendered', /\S/);
    await page.screenshot({ path: file });
    expectPng1280x400(file);
  });
}

test('screenshot compacting (WORKING while Claude compacts its context) is 1280x400', async ({ openView, page }) => {
  const file = path.join(shotsDir(), 'compacting.png');
  await openView('compacting');
  await expect(page.locator('#tool')).toHaveText('Compacting context');
  await page.screenshot({ path: file });
  expectPng1280x400(file);
});

test('screenshot thermal (WORKING with the HOT and LOW POWER tags) is 1280x400', async ({ openView, page }) => {
  const file = path.join(shotsDir(), 'thermal.png');
  await openView('thermal');
  await expect(page.locator('#hot-tag')).toBeVisible();
  await expect(page.locator('#power-tag')).toBeVisible();
  await page.screenshot({ path: file });
  expectPng1280x400(file);
});

test('screenshot more-sessions (others and a lower-bound diff) is 1280x400', async ({ openView, page }) => {
  const file = path.join(shotsDir(), 'more-sessions.png');
  await openView({ ...loadFixture('working'), others: 2, diffIncomplete: true });
  await expect(page.locator('#others')).toHaveText('+2');
  await expect(page.locator('#diff-approx')).toBeVisible();
  await page.screenshot({ path: file });
  expectPng1280x400(file);
});

test('screenshot last-session-ended (r7-01 note) is 1280x400 and the note fits', async ({ openView, page }) => {
  const file = path.join(shotsDir(), 'last-session-ended.png');
  const note = 'a-long-project-name ended: open the menu for New session';
  await openView({ view: 'unknown', voice: 'no-session', note });
  await expect(page.locator('#note1')).toHaveText(note);
  await expectFits(page);
  await page.screenshot({ path: file });
  expectPng1280x400(file);
  // the longest label the reducer lets through for this note (80 characters)
  await openView({ view: 'unknown', voice: 'no-session', note: `${'W'.repeat(80)} ended: open the menu for New session` });
  await expectFits(page);
});

test('screenshot boot page is 1280x400', async ({ page }) => {
  const file = path.join(shotsDir(), 'boot.png');
  // a port with nothing listening: take a free one by starting and closing a server
  const s = await startLiveServer({ port: 0 });
  const port = s.port;
  await s.close();
  const boot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/view/boot.html');
  await page.goto(`file://${boot}?port=${port}`);
  await expect(page.locator('#state-word')).toHaveText('NO LINK');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file });
  expectPng1280x400(file);
});

for (const wc of WORST_CASE_IDS) {
  for (const [view, suffix] of [['working', ''], ['permission', '-permission']]) {
    test(`screenshot worst case ${wc} (${view}) is 1280x400`, async ({ openView, page }) => {
      const file = path.join(shotsDir(), `worst-${wc}${suffix}.png`);
      const content = loadWorstCase(wc);
      await openView({ ...loadFixture(view), ...(view === 'permission' ? asPermission(content) : content) });
      await expect(page.locator('body')).toHaveAttribute('data-view', view);
      if (view === 'permission') await expect(page.locator('#cmdbox')).toBeHidden(); // none of the worst cases is a Bash tool
      await expect(page.locator('html')).toHaveAttribute('data-rendered', view);
      await page.screenshot({ path: file });
      expectPng1280x400(file);
    });
  }
}

test('screenshot asking-plan (CLAUDE ASKS, a plan to approve) is 1280x400', async ({ openView, page }) => {
  const file = path.join(shotsDir(), 'asking-plan.png');
  await openView(loadFixture('asking-plan'));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'asking');
  await expect(page.locator('#ask-steps')).toBeVisible();
  await expectFits(page);
  await page.screenshot({ path: file });
  expectPng1280x400(file);
});

for (const [id, hint, chosen] of [['asking-choice', 'Allow picks · Deny cancels', '#ask-o3'], ['asking-terminal', 'Answer in the terminal when parked', null]]) {
  test(`screenshot ${id} (CLAUDE ASKS) is 1280x400`, async ({ openView, page }) => {
    const file = path.join(shotsDir(), `${id}.png`);
    await openView(loadFixture(id));
    await expect(page.locator('body')).toHaveAttribute('data-view', 'asking');
    await expect(page.locator('#ask-hint')).toHaveText(hint);
    if (chosen !== null) await expect(page.locator(chosen)).toHaveAttribute('data-chosen', 'true');
    else await expect(page.locator('[data-chosen]')).toHaveCount(0);
    await expectFits(page);
    await page.screenshot({ path: file });
    expectPng1280x400(file);
  });
}

test('screenshot asking-long (CLAUDE ASKS, worst case) is 1280x400', async ({ openView, page }) => {
  const file = path.join(shotsDir(), 'asking-long.png');
  const content = loadAskingLong();
  await openView({ ...loadFixture('asking'), ...content });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'asking');
  await expect(page.locator('#ask-t4')).toBeVisible();
  await expect(page.locator('#ask-question')).toHaveAttribute('data-full', content.ask.question);
  await expectFits(page);
  await page.screenshot({ path: file });
  expectPng1280x400(file);
});

test('screenshot permission-offline (needs the driver, no network) is 1280x400', async ({ openView, page }) => {
  const file = path.join(shotsDir(), 'permission-offline.png');
  const command = 'cd packages/frontend && pnpm exec vitest run --reporter=verbose --coverage --silent=false src/components/some.spec.ts && git push origin main';
  await openView({ ...loadFixture('permission'), offline: true, tool: 'Bash', command, others: 1 });
  await expect(page.locator('#state-word')).toHaveText('NEEDS PERMISSION');
  await expect(page.locator('#offline-note')).toBeVisible();
  await page.screenshot({ path: file });
  expectPng1280x400(file);
});
