import { test, expect } from './harness.js';
import { loadFixture } from '../fixtures.js';
import { loadWorstCase } from '../worst-case.js';

const box = (page, sel) => page.locator(sel).evaluate((e) => {
  const r = e.getBoundingClientRect();
  return { left: r.left, right: r.right, width: r.width };
});

test.describe('command and output rows (06, was the line 3 separator)', () => {
  const edit = {
    ...loadFixture('working'), tool: 'Edit', file: 'a.py', command: 'make build',
    output: 'make: *** No rule to make target build. Stop.', outputLines: ['make: *** No rule to make target build. Stop.'],
  };
  const vbox = (page, sel) => page.locator(sel).evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom };
  });

  test('command and output are on separate rows and do not overlap', async ({ openView, page }) => {
    await openView(edit);
    await expect(page.locator('#sep')).toHaveCount(0);
    const c = await vbox(page, '#cmdbox');
    const o = await vbox(page, '#out3');
    expect(c.bottom).toBeLessThanOrEqual(o.top);
  });

  test('same rows for Bash; the rows flow: a missing command leaves no hole', async ({ openView, page }) => {
    await openView(edit);
    const before = (await vbox(page, '#out3')).top;
    await openView({ ...edit, tool: 'Bash' });
    await expect(page.locator('#cmdbox')).toBeVisible();
    expect((await vbox(page, '#out3')).top).toBe(before);
    await openView({ ...edit, command: '' });
    await expect(page.locator('#cmdbox')).toBeHidden();
    expect((await vbox(page, '#out3')).top).toBe(before - 40);
    await openView({ ...edit, output: '', outputLines: [] });
    await expect(page.locator('#out3')).toHaveText('');
    await expect(page.locator('#cmdbox')).toBeVisible();
  });
});

test.describe('tool width (07)', () => {
  const tool = 'mcp__github__create_pull_request_review_comment_with_suggestions';
  test('no file: tool uses the free width', async ({ openView, page }) => {
    await openView({ ...loadFixture('working'), tool, file: '' });
    await expect(page.locator('#tool')).toHaveAttribute('data-full', tool);
    expect((await box(page, '#tool')).width).toBeGreaterThan(0.28 * 1280);
  });
  test('with a file: tool stays within 28%', async ({ openView, page }) => {
    await openView({ ...loadFixture('working'), tool, file: 'src/a.py' });
    await expect(page.locator('#tool')).toHaveAttribute('data-full', tool);
    expect((await box(page, '#tool')).width).toBeLessThanOrEqual(0.28 * 1280 + 1);
  });
});

test.describe('where cut in the branch middle (08)', () => {
  const branch = 'feature/very-long-branch-name-for-refund-flow-fix-2026';
  test('keeps repo and the branch end', async ({ openView, page }) => {
    await openView({ ...loadFixture('done'), repo: 'revview', branch });
    const w = page.locator('#where');
    const text = await w.textContent();
    expect(text).toContain('…');
    expect(text, text).toMatch(/x-2026$/);
    expect(text.startsWith('revview · feat'), text).toBe(true);
    await expect(w).toHaveAttribute('data-full', `revview · ${branch}`);
    expect(await w.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
  });
  test('short branch is untouched', async ({ openView, page }) => {
    await openView({ ...loadFixture('working'), repo: 'revview', branch: 'main' });
    await expect(page.locator('#where')).toHaveText('revview · main');
  });
  for (const wc of ['over-limits', 'cjk-wide']) {
    test(`worst case ${wc}: stays inside the band`, async ({ openView, page }) => {
      const content = loadWorstCase(wc);
      await openView({ ...loadFixture('working'), ...content });
      const w = page.locator('#where');
      const full = `${content.repo} · ${content.branch}`;
      if (await w.isVisible()) {
        await expect(w).toHaveAttribute('data-full', full);
        const b = await box(page, '#where');
        expect(b.left).toBeGreaterThanOrEqual(0);
        expect(b.right).toBeLessThanOrEqual(1280);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
    });
  }
});

test('09 a long file path is cut once and keeps the base name', async ({ openView }) => {
  const file = 'deeply/nested/dir/structure/with/many/parts/and/more/parts/AVeryLongComponentNameForTheSettingsPanelController.test.tsx';
  const page = await openView({ ...loadFixture('working'), tool: 'Edit', file, command: null, output: null });
  const text = await page.locator('#file').textContent();
  expect(await page.locator('#file').getAttribute('data-full')).toBe(file);
  expect(text.split('…').length - 1).toBeLessThanOrEqual(1);
  expect(text.endsWith('.test.tsx')).toBe(true);
});
