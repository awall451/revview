// NEEDS PERMISSION: no diff, the offline mark, honest worst cases, commands that break at spaces, pinned row
// heights, and the repo in row A (#session) when the band has no room for it.
import { test, expect } from './harness.js';
import { loadFixture } from '../fixtures.js';
import { WORST_CASE_IDS, loadWorstCase, asPermission } from '../worst-case.js';
import { expectFits, checkContrastAndFloor } from './checks.js';

const WJ = '⁠';
const perm = loadFixture('permission');
const OFFLINE_TEXT = 'No network: voice input will not work';

test.describe('no diff under NEEDS PERMISSION (QA r3-03)', () => {
  for (const extra of [{}, { diffIncomplete: true }]) {
    test(`diff hidden ${JSON.stringify(extra)}`, async ({ openView, page }) => {
      await openView({ ...perm, tool: 'Edit', file: 'src/a.js', diff: { added: 5, removed: 3 }, ...extra });
      await expect(page.locator('#diff')).toBeHidden();
      await expect(page.locator('#diff')).toHaveAttribute('data-full', '');
    });
  }
  test('working still shows it', async ({ openView, page }) => {
    await openView({ ...loadFixture('working'), diff: { added: 5, removed: 3 } });
    await expect(page.locator('#diff')).toBeVisible();
  });
});

test.describe('permission while offline (QA r3-04)', () => {
  const command = 'cd packages/frontend && pnpm exec vitest run --reporter=verbose --coverage --coverage.reporter=text --coverage.reporter=html --silent=false src/components/very/long/path/to/some.spec.ts && '.repeat(2).slice(0, 300);
  const state = { ...perm, offline: true, tool: 'Bash', command };

  test('full NEEDS PERMISSION look plus one offline row', async ({ openView, page }, testInfo) => {
    await openView(state);
    await expect(page.locator('#state-word')).toHaveText('NEEDS PERMISSION');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'permission');
    await expect(page.locator('#tool')).toHaveText('Bash');
    const note = page.locator('#offline-note');
    await expect(note).toBeVisible();
    await expect(note).toHaveText(OFFLINE_TEXT);
    await expect(note).toHaveAttribute('data-full', OFFLINE_TEXT);
    const h = await page.locator('#command').evaluate((e) => e.getBoundingClientRect().height);
    expect(h).toBeLessThanOrEqual(5 * 40);
    expect(h).toBeGreaterThan(40);
    // the offline row is the last row, below the command
    const [c, n] = await page.evaluate(() => ['cmdbox', 'offline-note'].map((i) => document.getElementById(i).getBoundingClientRect().bottom));
    expect(n).toBeGreaterThan(c);
    await expectFits(page);
    await checkContrastAndFloor(page, 'permission-offline', testInfo);
  });
  test('not shown when online, or in other views', async ({ openView, page }) => {
    await openView({ ...state, offline: false });
    await expect(page.locator('#offline-note')).toBeHidden();
    await expect(page.locator('#offline-note')).toHaveAttribute('data-full', '');
    for (const view of ['working', 'waiting', 'done']) {
      await openView({ ...loadFixture(view), offline: true });
      await expect(page.locator('#offline-note')).toBeHidden();
    }
    await openView({ view: 'offline', activity: 'working' });
    await expect(page.locator('#offline-note')).toBeHidden();
  });
});

test.describe('worst cases over permission are honest (QA r3-01)', () => {
  test('asPermission follows the state core rule', () => {
    const a = asPermission({ tool: 'Edit', command: 'x', output: 'y', outputLines: ['y'] });
    expect([a.command, a.output, a.outputLines]).toEqual([null, null, []]);
    const b = asPermission({ tool: 'Bash', command: 'x', output: 'y', outputLines: ['y'] });
    expect([b.command, b.output, b.outputLines]).toEqual(['x', null, []]);
  });
  test('worst-big-diff over permission has no command box; a Bash worst case has one', async ({ openView, page }) => {
    expect(WORST_CASE_IDS).toContain('big-diff');
    await openView({ ...perm, ...asPermission(loadWorstCase('big-diff')) });
    await expect(page.locator('#cmdbox')).toBeHidden();
    await expect(page.locator('#out3')).toBeHidden();
    await openView({ ...perm, ...asPermission({ ...loadWorstCase('over-limits'), tool: 'Bash' }) });
    await expect(page.locator('#cmdbox')).toBeVisible();
    await expect(page.locator('#out3')).toBeHidden();
  });
});

// The rendered lines of #command: characters grouped by the top of their client rect.
async function commandLines(page) {
  return page.locator('#command').evaluate((e) => {
    const t = e.firstChild;
    const lines = [];
    let top = null;
    const r = document.createRange();
    let i = 0;
    for (const ch of t.data) {
      r.setStart(t, i); r.setEnd(t, i + ch.length);
      i += ch.length;
      const rect = r.getClientRects()[0];
      if (!rect || rect.width === 0) { if (lines.length) lines.at(-1).text += ch; continue; }
      if (top === null || Math.abs(rect.top - top) > 4) { top = rect.top; lines.push({ text: '' }); }
      lines.at(-1).text += ch;
    }
    return lines.map((l) => l.text);
  });
}

test.describe('commands break at spaces, not after "--" (QA r3-09)', () => {
  const cmds = [
    'cd packages/frontend && pnpm exec vitest run --reporter=verbose --coverage --coverage.reporter=text --coverage.reporter=html --silent=false src/components/very/long/path/to/some.spec.ts',
    'git log --oneline --graph --decorate --all --abbrev-commit --date=relative --pretty=format:%h --author=someone --since=2.weeks --no-merges',
  ];
  for (const cmd of cmds) {
    test(cmd.slice(0, 30), async ({ openView, page }) => {
      await openView({ ...perm, tool: 'Bash', command: cmd });
      const lines = await commandLines(page);
      expect(lines.length).toBeGreaterThan(1);
      for (const l of lines.slice(0, -1)) expect(l.replaceAll(WJ, '').replaceAll('\u200B', '').trimEnd(), `line ends with "-": ${l}`).not.toMatch(/-$/);
      const text = await page.locator('#command').textContent();
      expect(text.replaceAll(WJ, '').replaceAll('\u200B', '')).toBe(cmd);
      await expect(page.locator('#command')).toHaveAttribute('data-full', cmd);
      await expectFits(page);
    });
  }
  test('a token longer than a row still breaks inside; an over-long command gets an ellipsis', async ({ openView, page }) => {
    await openView({ ...perm, tool: 'Bash', command: `echo --${'a'.repeat(200)}` });
    expect((await commandLines(page)).length).toBeGreaterThan(1);
    await expectFits(page);
    await openView({ ...perm, tool: 'Bash', command: '--flag-name '.repeat(80) });
    const text = await page.locator('#command').textContent();
    expect(text.endsWith('…')).toBe(true);
    expect(await page.locator('#command').evaluate((e) => e.getBoundingClientRect().height)).toBeLessThanOrEqual(240);
  });
});

test.describe('a long path token breaks after a separator, not inside a word (QA r5-06)', () => {
  test('lines end after "/" or "-" where the path allows it', async ({ openView, page }) => {
    const path = '/tmp/qa5-run/test-results-with-a-very-long-directory-name';
    const cmd = `npx playwright test tests/emulator.spec.js --workers=2 --reporter=line --output=${path} --grep something`;
    for (const pad of ['', 'x'.repeat(23) + ' ', 'xx '.repeat(7)]) {
      await openView({ ...perm, tool: 'Bash', command: pad + cmd });
      const lines = (await commandLines(page)).map((l) => l.replaceAll(WJ, '').replaceAll('\u200B', ''));
      expect(lines.length).toBeGreaterThan(1);
      for (const l of lines.slice(0, -1)) {
        const t = l.trimEnd();
        // a line that ends inside the path ends right after a separator, never between letters
        const i = (pad + cmd).indexOf(path);
        const joined = lines.join('');
        if (joined.indexOf(t) + t.length > i && joined.indexOf(t) + t.length < i + path.length) expect(t, `mid-word break: ${t}`).toMatch(/[/-]$/);
      }
      expect((await page.locator('#command').textContent()).replaceAll(WJ, '').replaceAll('\u200B', '')).toBe(pad + cmd);
      await expectFits(page);
    }
  });
  test('data-full has no zero width characters', async ({ openView, page }) => {
    const cmd = 'ls /tmp/qa5-run/test-results-with-a-very-long-directory-name';
    await openView({ ...perm, tool: 'Bash', command: cmd });
    await expect(page.locator('#command')).toHaveAttribute('data-full', cmd);
  });
});

test.describe('row heights are pinned (STATE follow-up b)', () => {
  test('#command and the output rows use a 40 px line, the command has at most 6 rows', async ({ openView, page }) => {
    await openView({ ...loadFixture('working'), tool: 'Bash', command: 'word '.repeat(300), output: 'x', outputLines: ['a', 'b', 'x'] });
    for (const id of ['command', 'out1', 'out2', 'out3']) {
      expect(await page.locator(`#${id}`).evaluate((e) => getComputedStyle(e).lineHeight), id).toBe('40px');
    }
    await openView({ ...loadFixture('working'), tool: 'Bash', command: 'word '.repeat(300), output: null, outputLines: [] });
    expect(await page.locator('#command').evaluate((e) => e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight))).toBe(6);
  });
});

test.describe('#session when #where gives way (STATE follow-up a)', () => {
  const repo = 'r'.repeat(45);
  const state = { ...perm, repo, branch: 'feature/some-long-branch-name', others: 12, buttons: 'missing' };
  // Found while writing this: with the real fonts #where never gets under the 8-character floor in any view
  // that shows #session (NEEDS PERMISSION + "9+" + NO BUTTONS leaves it about 190 px; the floor is about 157 px),
  // so no honest input hides it. The test therefore squeezes the band with a style (a stand-in for a wider
  // font on the Pi) and renders again: it checks the #session logic, not that the real inputs reach it.
  test('real inputs: #where keeps its room, #session stays empty', async ({ openView, page }) => {
    await openView(state);
    await expect(page.locator('#where')).toBeVisible();
    await expect(page.locator('#session')).toBeHidden();
  });
  test('squeezed band: #where hidden, #session shows the repo in row A', async ({ openView, page }) => {
    await openView(state);
    await page.addStyleTag({ content: '#band { padding-right: 300px !important; }' });
    await page.evaluate((s) => window.revviewRender(s), state);
    await expect(page.locator('#where')).toBeHidden();
    const s = page.locator('#session');
    await expect(s).toBeVisible();
    await expect(s).toHaveText(repo);
    await expect(s).toHaveAttribute('data-full', repo);
    for (const view of ['offline', 'ended']) {
      await page.evaluate((st) => window.revviewRender(st), { ...state, view });
      await expect(page.locator('#session')).toBeHidden();
    }
  });
});
