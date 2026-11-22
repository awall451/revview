import { test, expect } from './harness.js';
import { loadFixture } from '../fixtures.js';
import { loadWorstCase } from '../worst-case.js';

const box = (page, sel) => page.locator(sel).evaluate((e) => {
  const r = e.getBoundingClientRect();
  return { left: r.left, right: r.right, width: r.width };
});

test.describe('line 3 separator (06)', () => {
  const edit = {
    ...loadFixture('working'), tool: 'Edit', file: 'a.py', command: 'make build',
    output: 'make: *** No rule to make target build. Stop.',
  };

  test('sits between command and output on a non-Bash line', async ({ openView, page }) => {
    await openView(edit);
    await expect(page.locator('#sep')).toBeVisible();
    const c = await box(page, '#cmdbox');
    const s = await box(page, '#sep');
    const o = await box(page, '#output');
    expect(s.left).toBeGreaterThanOrEqual(c.right);
    expect(s.right).toBeLessThanOrEqual(o.left);
  });

  test('hidden for Bash and without a command or output', async ({ openView, page }) => {
    await openView({ ...edit, tool: 'Bash' });
    await expect(page.locator('#sep')).toBeHidden();
    await openView({ ...edit, command: '' });
    await expect(page.locator('#sep')).toBeHidden();
    await openView({ ...edit, output: '' });
    await expect(page.locator('#sep')).toBeHidden();
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
