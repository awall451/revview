import { test, expect } from './harness.js';
import { FIXTURE_IDS, loadFixture } from '../fixtures.js';
import { WORST_CASE_IDS, loadWorstCase } from '../worst-case.js';
import { LIMITS } from '../../src/state/format.js';
import { textSizeMm } from '../mm.js';
import { RANGE_MM } from '../../src/view/type.js';
import { expectFits, checkContrastAndFloor } from './checks.js';
import { PANEL } from '../panel.js';

const LABELS = {
  working: 'WORKING', waiting: 'WAITING FOR ME', permission: 'NEEDS PERMISSION', done: 'DONE',
  starting: 'STARTING', offline: 'OFFLINE', 'insert-key': 'INSERT KEY',
  unknown: 'UNKNOWN', ended: 'CLAUDE EXITED', 'no-link': 'NO LINK',
};

for (const id of FIXTURE_IDS) {
  test(`fixture ${id} fits the panel`, async ({ openView, page }) => {
    await openView(id);
    await expectFits(page);
    const word = page.locator('#state-word');
    await expect(word).toBeVisible();
    await expect(word).toHaveText(LABELS[id]);
    const cut = await word.evaluate((e) => [e.scrollWidth, e.clientWidth]);
    expect(cut[0]).toBeLessThanOrEqual(cut[1]);
    const mm = (await textSizeMm(word)).capHeightMm;
    console.log(`state word ${id} cap=${mm.toFixed(2)}mm`);
    expect(mm).toBeGreaterThanOrEqual(RANGE_MM.state[0]);
    expect(mm).toBeLessThanOrEqual(RANGE_MM.state[1]);
    await expect(page.locator('body')).toHaveAttribute('data-view', id);
    await expect(page.locator('#shape')).toHaveAttribute('data-shape', /\S/);
  });

  test(`fixture ${id} contrast and text sizes`, async ({ openView, page }, testInfo) => {
    await openView(id);
    const smallest = await checkContrastAndFloor(page, id, testInfo);
    console.log(`smallest text ${id} cap=${smallest.toFixed(2)}mm`);
  });
}

test('every state has its own shape and band colour; unknown input shows "no state"', async ({ openView, page }) => {
  const shapes = new Set();
  const colours = new Set();
  for (const id of [...FIXTURE_IDS, null]) {
    await openView(id ?? { garbage: true });
    // the drawn markup, not data-shape (which is just the view name and cannot show two states sharing a shape)
    const shape = await page.locator('#shape').innerHTML();
    const colour = await page.locator('#band').evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(await page.locator('#shape').evaluate((e) => e.children.length)).toBeGreaterThan(0);
    shapes.add(shape);
    colours.add(colour);
    if (id === null) {
      await expect(page.locator('body')).toHaveAttribute('data-view', 'none');
      await expect(page.locator('#state-word')).toHaveText('NO STATE');
    }
  }
  expect(shapes.size).toBe(FIXTURE_IDS.length + 1);
  expect(colours.size).toBe(FIXTURE_IDS.length + 1);
});

test('prototype keys in state data are plain text, not lookups', async ({ openView, page }) => {
  for (const view of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    await openView({ view });
    await expect(page.locator('body')).toHaveAttribute('data-view', 'none');
    await expect(page.locator('#state-word')).toHaveText('NO STATE');
  }
  await openView({ view: 'offline', activity: 'constructor' });
  await expect(page.locator('#state-word')).toHaveText('OFFLINE');
  await expect(page.locator('#note1')).toHaveText('Claude: constructor');
});

test('worst case: every field at its limit', async ({ openView, page }) => {
  const s = loadFixture('working');
  const fill = (n) => 'W'.repeat(n);
  const state = {
    ...s, repo: fill(LIMITS.path), branch: fill(LIMITS.path), tool: fill(LIMITS.path),
    file: fill(LIMITS.path), command: fill(LIMITS.command), output: fill(LIMITS.output),
    diff: { added: 999999, removed: 999999 },
  };
  await openView(state);
  await expectFits(page);
});

const basename = (p) => p.slice(p.lastIndexOf('/') + 1);

// In every state, with every worst-case content over it (and once as a Bash tool call).
for (const id of FIXTURE_IDS) {
  for (const wc of WORST_CASE_IDS) {
    for (const bash of [false, true]) {
      if (bash && id !== 'working' && id !== 'permission') continue;
      const name = `worst case ${wc}${bash ? ' (Bash)' : ''} in ${id}`;
      test(name, async ({ openView, page }, testInfo) => {
        const content = loadWorstCase(wc);
        const state = { ...loadFixture(id), ...content, ...(bash ? { tool: 'Bash' } : {}) };
        await openView(state);
        await expectFits(page);

        const word = page.locator('#state-word');
        await expect(word).toBeVisible();
        const cut = await word.evaluate((e) => [e.scrollWidth, e.clientWidth]);
        expect(cut[0]).toBeLessThanOrEqual(cut[1]);

        const scrolling = await page.evaluate(() => [...document.querySelectorAll('body *')]
          .filter((e) => e.scrollWidth > e.clientWidth)
          .filter((e) => {
            const cs = getComputedStyle(e);
            return !(cs.overflowX === 'hidden' && cs.textOverflow === 'ellipsis') && e.id !== 'file';
          })
          .map((e) => `${e.tagName}#${e.id} ${e.scrollWidth}>${e.clientWidth}`));
        expect(scrolling).toEqual([]);

        const file = page.locator('#file');
        const fileOverflow = await file.evaluate((e) => e.scrollWidth - e.clientWidth);
        expect(fileOverflow).toBeLessThanOrEqual(0);
        const showsFile = ['working', 'waiting', 'permission', 'done'].includes(id) && !bash;
        if (showsFile) {
          await expect(file).toHaveAttribute('data-full', content.file);
          const visible = await file.textContent();
          const base = basename(content.file);
          const chars = Array.from(base);
          const ok = visible.endsWith(base) || visible.endsWith(chars.slice(-3).join(''));
          expect(ok, `file shows ${visible}`).toBe(true);
          expect(Array.from(visible).length).toBeLessThanOrEqual(Array.from(content.file).length);
        }
        await checkContrastAndFloor(page, `${wc}/${id}${bash ? '/bash' : ''}`, testInfo);
      });
    }
  }
}

// ---- band hint for more sessions, and the diff lower-bound marker ----
const LONG = 'W'.repeat(120);

for (const view of ['working', 'permission']) {
  for (const n of [1, 9]) {
    test(`#others shows +${n} in ${view} with a long repo and fits`, async ({ openView, page }) => {
      await openView({ ...loadFixture(view), repo: LONG, branch: LONG, others: n });
      const o = page.locator('#others');
      await expect(o).toBeVisible();
      await expect(o).toHaveText(`+${n}`);
      await expect(o).toHaveAttribute('data-full', `${n} more Claude session${n === 1 ? '' : 's'}`);
      const cut = await o.evaluate((e) => [e.scrollWidth, e.clientWidth]);
      expect(cut[0]).toBeLessThanOrEqual(cut[1]);
      await expect(page.locator('#state-word')).toBeVisible();
      await expectFits(page);
      // #others sits after the state word, before #where
      const order = await page.evaluate(() => {
        const a = document.getElementById('others').getBoundingClientRect();
        const w = document.getElementById('state-word').getBoundingClientRect();
        return a.left >= w.right;
      });
      expect(order).toBe(true);
    });
  }
}

test('#others is hidden when 0, missing or not a positive integer, and in unlisted views', async ({ openView, page }) => {
  for (const others of [0, -1, 1.5, '2', null, undefined, NaN, true]) {
    await openView({ ...loadFixture('working'), others });
    await expect(page.locator('#others')).toBeHidden();
  }
  for (const view of ['no-link', 'unknown', 'starting', 'insert-key']) {
    await openView({ ...loadFixture('working'), view, others: 3 });
    await expect(page.locator('#others')).toBeHidden();
  }
  for (const view of ['waiting', 'done', 'offline', 'ended']) {
    await openView({ ...loadFixture('working'), view, others: 3 });
    await expect(page.locator('#others')).toHaveText('+3');
  }
});

test('#diff-approx marks a lower bound; +A and −R stay as they are', async ({ openView, page }) => {
  const base = { ...loadFixture('working'), diff: { added: 12, removed: 3 } };
  await openView({ ...base, diffIncomplete: true });
  await expect(page.locator('#diff-approx')).toBeVisible();
  await expect(page.locator('#diff-approx')).toHaveText('≥');
  await expect(page.locator('#diff-added')).toHaveText('+12');
  await expect(page.locator('#diff-removed')).toHaveText('−3');
  await expect(page.locator('#diff')).toHaveAttribute('data-full', 'at least +12 −3');
  const style = (sel) => page.locator(sel).evaluate((e) => {
    const cs = getComputedStyle(e);
    return [cs.fontWeight, cs.color, cs.fontSize];
  });
  const approx = await style('#diff-approx');
  expect(approx[0]).toBe('700');
  expect(approx[1]).toBe('rgb(255, 255, 255)');
  expect(approx[2]).toBe((await style('#diff-added'))[2]);
  await expectFits(page);

  for (const d of [false, undefined, 'true', 1]) {
    await openView({ ...base, diffIncomplete: d });
    await expect(page.locator('#diff-approx')).toBeHidden();
    await expect(page.locator('#diff')).toHaveAttribute('data-full', '+12 −3');
  }
  await openView({ ...base, diff: { added: 0, removed: 0 }, diffIncomplete: false });
  await expect(page.locator('#diff')).toBeHidden();
});

test('diffIncomplete with no counted lines shows "+? −?" (QA 11) where a diff is shown', async ({ openView, page }) => {
  for (const view of ['working', 'waiting', 'permission', 'done', 'offline']) {
    await openView({ ...loadFixture('working'), view, diff: { added: 0, removed: 0 }, diffIncomplete: true });
    await expect(page.locator('#diff-approx')).toBeHidden();
    await expect(page.locator('#diff-added')).toHaveText('+?');
    await expect(page.locator('#diff-removed')).toHaveText('−?');
    await expect(page.locator('#diff')).toHaveAttribute('data-full', 'diff unknown (an event was too large to read)');
  }
  for (const view of ['starting', 'insert-key', 'unknown', 'ended', 'no-link']) {
    await openView({ ...loadFixture('working'), view, diff: { added: 0, removed: 0 }, diffIncomplete: true });
    await expect(page.locator('#diff')).toBeHidden();
  }
});

test('contrast and sizes with others and diffIncomplete', async ({ openView, page }, testInfo) => {
  await openView({ ...loadFixture('working'), others: 2, diffIncomplete: true });
  await expect(page.locator('#others')).toBeVisible();
  await expect(page.locator('#diff-approx')).toBeVisible();
  await checkContrastAndFloor(page, 'others+approx', testInfo);
  await expectFits(page);
});

test('no-link is inverted: black band, white outline, nothing outside the panel', async ({ openView, page }) => {
  await openView({ view: 'no-link', repo: 'r', branch: 'b', others: 4, diff: { added: 1, removed: 1 } });
  const m = await page.locator('#band').evaluate((e) => {
    const cs = getComputedStyle(e);
    return [cs.backgroundColor, cs.color, cs.borderTopWidth, cs.borderTopColor];
  });
  expect(m[0]).toBe('rgb(0, 0, 0)');
  expect(m[1]).toBe('rgb(255, 255, 255)');
  expect(m[3]).toBe('rgb(255, 255, 255)');
  const bw = parseFloat(m[2]) / PANEL.pxPerMm;
  expect(bw).toBeGreaterThan(0.5);
  expect(bw).toBeLessThan(0.7);
  await expect(page.locator('#where')).toBeHidden();
  await expect(page.locator('#others')).toBeHidden();
  await expect(page.locator('#diff')).toBeHidden();
  await expect(page.locator('#note1')).toHaveText('Display lost the revview server');
  await expect(page.locator('#note2')).toHaveText('Claude may still be running');
  await expectFits(page);
});

test('new looks: notes, repo and diff', async ({ openView, page }) => {
  await openView({ view: 'unknown', repo: 'r', branch: 'b', diff: { added: 1, removed: 1 } });
  await expect(page.locator('#note1')).toHaveText("Not known until Claude's next step");
  await expect(page.locator('#note2')).toHaveText('Push-to-talk may still work');
  await expect(page.locator('#diff')).toBeHidden();
  await openView({ view: 'ended', repo: 'myrepo', branch: 'main', diff: { added: 1, removed: 1 } });
  await expect(page.locator('#note1')).toHaveText('No Claude Code session running');
  await expect(page.locator('#note2')).toHaveText('Voice input goes nowhere');
  // at the smaller size repo and branch both fit next to CLAUDE EXITED
  await expect(page.locator('#where')).toHaveText('myrepo · main');
  await expect(page.locator('#where')).toHaveAttribute('data-full', 'myrepo · main');
  await expect(page.locator('#diff')).toBeHidden();
});
