// Claude is compacting its context (state key `compacting`): the tool line says "Compacting context", the file
// slot is empty; the state itself (WORKING / WAITING / DONE) is unchanged. Shown wherever the tool line is shown.
import { test, expect } from './harness.js';
import { FIXTURE_IDS, loadFixture } from '../fixtures.js';
import { WORST_CASE_IDS, loadWorstCase } from '../worst-case.js';
import { expectFits } from './checks.js';

const WORD = 'Compacting context';
const fontSize = (page) => page.locator('#tool').evaluate((e) => getComputedStyle(e).fontSize);

test('the compacting fixture is WORKING and shows the words, no file', async ({ openView, page }) => {
  const fx = loadFixture('compacting');
  expect(fx.view).toBe('working');
  expect(fx.compacting).toBe(true);
  await openView('compacting');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'working');
  await expect(page.locator('#state-word')).toHaveText('WORKING');
  await expect(page.locator('#tool')).toHaveText(WORD);
  await expect(page.locator('#tool')).toHaveAttribute('data-compacting', '1');
  await expect(page.locator('#file')).toHaveText('');
  await expectFits(page);
});

test('same type size as the tool line normally has', async ({ openView, page }) => {
  await openView('working');
  const normal = await fontSize(page);
  await openView('compacting');
  expect(await fontSize(page)).toBe(normal);
});

for (const id of FIXTURE_IDS) {
  test(`fixture ${id} does not show the words`, async ({ openView, page }) => {
    await openView(id);
    await expect(page.locator('#tool')).not.toContainText(WORD);
    await expect(page.locator('#tool')).not.toHaveAttribute('data-compacting', /.*/);
  });
}

test('done with compacting: DONE and the line; diff, command and output stay', async ({ openView, page }) => {
  const done = loadFixture('done');
  await openView({ ...done, compacting: true });
  await expect(page.locator('#state-word')).toHaveText('DONE');
  await expect(page.locator('#tool')).toHaveText(WORD);
  await expect(page.locator('#file')).toHaveText('');
  await expect(page.locator('#command')).toHaveAttribute('data-full', done.command);
  await expect(page.locator('#out3')).toHaveText(done.output);
  await expect(page.locator('#diff')).toBeVisible();
  await expectFits(page);
});

test('waiting with compacting: WAITING FOR ME and the line', async ({ openView, page }) => {
  await openView({ ...loadFixture('waiting'), compacting: true });
  await expect(page.locator('#state-word')).toHaveText('WAITING FOR ME');
  await expect(page.locator('#tool')).toHaveText(WORD);
  await expect(page.locator('#file')).toHaveText('');
});

test('compacting false or not a boolean: no words', async ({ openView, page }) => {
  await openView({ ...loadFixture('compacting'), compacting: false });
  await expect(page.locator('#tool')).toHaveText('Read');
  await expect(page.locator('#file')).toHaveText('src/f2.txt');
  await openView({ ...loadFixture('compacting'), compacting: 'yes' });
  await expect(page.locator('#tool')).toHaveText('Read');
});

test('a failed turn says so, not compacting', async ({ openView, page }) => {
  await openView({ ...loadFixture('waiting'), compacting: true, failed: { error: 'rate_limit', message: 'x' } });
  await expect(page.locator('#tool')).toHaveText('Turn failed: rate limit');
  await expect(page.locator('#tool')).not.toHaveAttribute('data-compacting', /.*/);
});

test('not under permission, starting, unknown, ended, insert-key, no-link, whatever the flag says', async ({ openView, page }) => {
  for (const id of ['permission', 'starting', 'unknown', 'ended', 'insert-key', 'no-link']) {
    await openView({ ...loadFixture(id), compacting: true });
    await expect(page.locator('#tool')).not.toContainText(WORD);
  }
});

test('under OFFLINE the line shows when the activity is working, waiting or done', async ({ openView, page }) => {
  for (const activity of ['working', 'waiting', 'done']) {
    await openView({ ...loadFixture('offline'), activity, compacting: true });
    await expect(page.locator('#state-word')).toHaveText('OFFLINE');
    await expect(page.locator('#tool')).toHaveText(WORD);
    await expect(page.locator('#note1')).toContainText('Claude:');
    await expectFits(page);
  }
  for (const activity of ['permission', 'starting', 'unknown', 'ended']) {
    await openView({ ...loadFixture('offline'), activity, compacting: true });
    await expect(page.locator('#tool')).not.toContainText(WORD);
  }
  await openView({ ...loadFixture('offline'), compacting: false });
  await expect(page.locator('#tool')).not.toContainText(WORD);
});

// Worst case: long repo and branch, big diff, others, offline overlay; in the normal bar and with the multi-session
// extras (others, mic and position, a prompt elsewhere). The list and menu replace the lower part: no tool line there.
const MULTI = { others: 12, voice: 'here', position: { index: 12, count: 13 }, elsewhere: 3, buttons: 'missing' };
for (const wc of WORST_CASE_IDS) {
  for (const base of ['working', 'done', 'waiting', 'offline']) {
    for (const [name, extra] of [['bar', {}], ['multi-session', MULTI]]) {
      test(`worst case ${wc} over ${base} (${name}): the line fits`, async ({ openView, page }) => {
        const state = { ...loadFixture(base), ...loadWorstCase(wc), others: 3, ...extra, compacting: true };
        await openView(state);
        await expect(page.locator('#tool')).toHaveText(WORD);
        await expect(page.locator('#file')).toHaveText('');
        await expectFits(page);
        const t = await page.locator('#tool').evaluate((e) => ({ over: e.scrollWidth - e.clientWidth, fs: getComputedStyle(e).fontSize }));
        expect(t.over).toBeLessThanOrEqual(0);
        await openView({ ...state, compacting: false });
        expect(await fontSize(page)).toBe(t.fs);
      });
    }
  }
}
