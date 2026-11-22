import { test, expect } from './harness.js';
import { loadFixture } from '../fixtures.js';
import { expectFits, checkContrastAndFloor } from './checks.js';

// honest-states (others hint, lower-bound diff) together with line-polish (branch cut, file cut, separator)
const branch = 'feature/very-long-branch-name-for-refund-flow-fix-with-many-more-words-to-be-sure-it-overflows-the-band-2026';
const file = 'src/some/very/deeply/nested/directory/structure/with/a-rather-long-file-name-here.component.test.tsx';
const rect = (page, sel) => page.locator(sel).evaluate((e) => {
  const r = e.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
});
const busy = {
  ...loadFixture('working'), tool: 'Edit', file, repo: 'revview', branch, others: 3,
  command: 'make build', output: 'make: *** No rule to make target build. Stop.',
  diff: { added: 12345, removed: 56 }, diffIncomplete: true,
};

for (const view of ['working', 'waiting', 'permission', 'done']) {
  test(`${view}: +N hint, branch cut, file cut and ≥ diff together`, async ({ openView, page }, testInfo) => {
    await openView({ ...busy, view });
    const others = page.locator('#others');
    await expect(others).toBeVisible();
    await expect(others).toHaveText('+3');
    const w = page.locator('#where');
    const text = await w.textContent();
    expect(text.startsWith('revview'), text).toBe(true);
    if (view === 'done') {
      // enough room: middle cut, the end of the branch survives, nothing clipped
      expect(text).toContain('…');
      expect(text, text).toMatch(/2026$/);
      expect(await w.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
    }
    // otherwise (long state word + hint) fitWhere gives up and CSS clips the end: still inside the band
    const o = await rect(page, '#others');
    const wr = await rect(page, '#where');
    const wordR = await rect(page, '#state-word');
    // with the longest words #where gives way completely (stub rule); the hint never does
    if (await w.isVisible()) expect(wr.left).toBeGreaterThanOrEqual(o.right - 0.5);
    expect(o.right).toBeLessThanOrEqual(1280);
    expect(o.left).toBeGreaterThanOrEqual(wordR.right - 0.5);
    if (await w.isVisible()) expect(wr.right).toBeLessThanOrEqual(1280);
    // the file is cut but its base name survives; the lower-bound diff stays whole
    await expect(page.locator('#file')).toHaveAttribute('data-full', file);
    expect(await page.locator('#file').textContent()).toContain('.test.tsx');
    await expect(page.locator('#diff-approx')).toBeVisible();
    await expect(page.locator('#diff-added')).toHaveText('+12.3k');
    await expect(page.locator('#diff-removed')).toHaveText('−56');
    const d = await rect(page, '#diff');
    expect(d.right).toBeLessThanOrEqual(1280);
    const f = await rect(page, '#file');
    expect(f.right).toBeLessThanOrEqual(d.left + 0.5);
    // command and output sit on separate rows of their own and do not overlap (was: the → separator)
    const cmd = await rect(page, '#command');
    const out = await rect(page, '#out3');
    expect(cmd.bottom).toBeLessThanOrEqual(out.top);
    await expectFits(page);
    await checkContrastAndFloor(page, `combined/${view}`, testInfo);
  });
}

for (const view of ['unknown', 'ended', 'no-link']) {
  test(`${view}: long branch and stray fields stay inside the panel`, async ({ openView, page }, testInfo) => {
    await openView({ ...busy, view });
    await expect(page.locator('#diff')).toBeHidden();
    if (view !== 'ended') await expect(page.locator('#others')).toBeHidden();
    await expect(page.locator('#cmdbox')).toBeHidden();
    await expect(page.locator('#out3')).toHaveText('');
    if (view === 'no-link') await expect(page.locator('#where')).toBeHidden();
    else {
      expect(await page.locator('#where').evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
      if (view === 'ended') {
        // with the smaller type the branch is cut in its middle and keeps its end (the repo-alone rule is QA 13 in polish2)
        expect(await page.locator('#where').textContent()).toMatch(/^revview · .*….*2026$/);
        expect(await page.locator('#where').getAttribute('data-full')).toMatch(/^revview · .*2026$/);
      } else expect(await page.locator('#where').textContent()).toMatch(/2026$/);
    }
    await expectFits(page);
    await checkContrastAndFloor(page, `combined/${view}`, testInfo);
  });
}
