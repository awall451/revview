// The dense glance layout: rows below the band flow without holes, nothing is clipped, the command wraps and is
// cut only when it does not fit the rows left by the output lines.
import { test, expect } from './harness.js';
import { FIXTURE_IDS, loadFixture } from '../fixtures.js';
import { WORST_CASE_IDS, loadWorstCase, asPermission } from '../worst-case.js';
import { expectFits, checkContrastAndFloor } from './checks.js';

const ROW = 40;
const words = (n, w = 'alpha') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');
const line = (c) => c.repeat(80);
const longCommand = (n) => words(100).slice(0, n).trimEnd();

// one extra worst-case Bash state: 300-char multi-word command, 3 long output lines, others, long repo and branch
const WORST_BASH = {
  ...loadFixture('working'), tool: 'Bash', file: null, others: 12, // working: a permission state has no output rows
  repo: 'customer-billing-service-with-a-very-long-name', branch: 'feature/some-very-long-branch-name-for-a-refund-flow-fix',
  command: longCommand(300), output: line('c'), outputLines: [line('a'), line('b'), line('c')],
};

const box = (page, sel) => page.locator(sel).evaluate((e) => {
  const r = e.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
});

test.describe('nothing clipped, outside the panel or overlapping', () => {
  for (const id of FIXTURE_IDS) {
    test(`fixture ${id}`, async ({ openView, page }) => {
      await openView(id);
      await expectFits(page);
    });
  }
  for (const wc of WORST_CASE_IDS) {
    for (const view of ['working', 'permission']) {
      test(`worst case ${wc} (${view})`, async ({ openView, page }) => {
        const content = loadWorstCase(wc);
        await openView({ ...loadFixture(view), ...(view === 'permission' ? asPermission(content) : content) });
        await expectFits(page);
      });
    }
  }
  test('worst case Bash state: long command, 3 output lines, 12 others, long repo and branch', async ({ openView, page }, testInfo) => {
    await openView(WORST_BASH);
    await expectFits(page);
    await expect(page.locator('#out1')).toBeVisible();
    await expect(page.locator('#command')).toContainText('…');
    await checkContrastAndFloor(page, 'worst-bash', testInfo);
  });
});

test.describe('wrapped command', () => {
  const out3 = [line('a'), line('b'), line('c')];
  const withOut = { ...loadFixture('working'), tool: 'Read', file: 'a.py', output: out3[2], outputLines: out3 };

  test('about 150 characters with 3 output lines: shown in full on several rows', async ({ openView, page }) => {
    const cmd = longCommand(150);
    await openView({ ...withOut, command: cmd });
    await expect(page.locator('#command')).toHaveText(cmd);
    expect((await box(page, '#command')).height).toBeGreaterThan(ROW);
    await expectFits(page);
  });

  test('300 characters with 3 output lines: cut with an ellipsis within 3 rows', async ({ openView, page }) => {
    const cmd = longCommand(300);
    await openView({ ...withOut, command: cmd });
    const shown = await page.locator('#command').textContent();
    expect(shown.endsWith('…')).toBe(true);
    expect(cmd.startsWith(shown.slice(0, -1))).toBe(true);
    await expect(page.locator('#command')).toHaveAttribute('data-full', cmd);
    expect((await box(page, '#command')).height).toBeLessThanOrEqual(3 * ROW);
    await expectFits(page);
  });

  test('300 characters without output lines: more than 3 rows', async ({ openView, page }) => {
    const cmd = longCommand(300);
    await openView({ ...withOut, command: cmd, output: null, outputLines: [] });
    expect((await box(page, '#command')).height).toBeGreaterThan(3 * ROW);
    await expectFits(page);
  });

  test('output rows sit below the command, newest last', async ({ openView, page }) => {
    await openView({ ...withOut, command: longCommand(300) });
    const c = await box(page, '#cmdbox');
    const o = [await box(page, '#out1'), await box(page, '#out2'), await box(page, '#out3')];
    expect(o[0].top).toBeGreaterThanOrEqual(c.bottom);
    expect(o[1].top).toBeGreaterThan(o[0].top);
    expect(o[2].top).toBeGreaterThan(o[1].top);
    await expect(page.locator('#out1')).toHaveText(out3[0]);
    await expect(page.locator('#out3')).toHaveText(out3[2]);
  });

  test('command rows plus output rows are at most 6 (7 rows with row A)', async ({ openView, page }) => {
    for (const n of [0, 1, 2, 3]) {
      const lines = out3.slice(3 - n);
      await openView({ ...withOut, command: longCommand(300), output: lines.at(-1) ?? null, outputLines: lines });
      const h = (await box(page, '#cmdbox')).height / ROW + n;
      expect(h).toBeLessThanOrEqual(6);
      await expectFits(page);
    }
  });
});

test.describe('output rows flow without gaps', () => {
  const all = ['first line', 'second line', 'third line'];
  for (const n of [1, 2, 3]) {
    test(`${n} output line${n > 1 ? 's' : ''}`, async ({ openView, page }) => {
      const lines = all.slice(3 - n);
      await openView({ ...loadFixture('working'), tool: 'Read', file: 'a.py', command: 'make build', output: lines.at(-1), outputLines: lines });
      const c = await box(page, '#cmdbox');
      expect(c.height).toBe(ROW);
      const rows = [];
      for (const id of ['out1', 'out2', 'out3']) {
        if (await page.locator(`#${id}`).isVisible()) rows.push(await box(page, `#${id}`));
      }
      expect(rows).toHaveLength(n);
      expect(rows[0].top).toBe(c.bottom);
      for (let i = 1; i < n; i++) expect(rows[i].top).toBe(rows[i - 1].bottom);
      await expect(page.locator('#out3')).toHaveText(lines.at(-1));
      await expectFits(page);
    });
  }
  test('rows follow row A directly: no holes without command or note', async ({ openView, page }) => {
    await openView({ ...loadFixture('working'), tool: 'Read', file: 'a.py', command: null, output: 'x', outputLines: ['x'] });
    const a = await box(page, '#line2');
    expect((await box(page, '#out3')).top).toBe(a.bottom);
  });
});
