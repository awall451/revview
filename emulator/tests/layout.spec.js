import { test, expect } from './harness.js';
import { FIXTURE_IDS, loadFixture } from '../fixtures.js';
import { WORST_CASE_IDS, loadWorstCase } from '../worst-case.js';
import { LIMITS } from '../../src/state/format.js';
import { textSizeMm } from '../mm.js';
import { PANEL } from '../panel.js';
import { MIN_MM } from '../../src/view/type.js';

const LABELS = {
  working: 'WORKING', waiting: 'WAITING FOR ME', permission: 'NEEDS PERMISSION', done: 'DONE',
  starting: 'STARTING', offline: 'OFFLINE', 'insert-key': 'INSERT KEY',
};

async function expectFits(page) {
  const m = await page.evaluate(({ w, h }) => {
    const de = document.documentElement;
    const outside = [];
    for (const el of document.querySelectorAll('body, body *')) {
      const r = el.getBoundingClientRect();
      if (r.left < 0 || r.top < 0 || r.right > w || r.bottom > h) {
        outside.push(`${el.tagName}#${el.id} ${[r.left, r.top, r.right, r.bottom].join(',')}`);
      }
    }
    return {
      sw: de.scrollWidth, sh: de.scrollHeight, iw: window.innerWidth, ih: window.innerHeight,
      cw: de.clientWidth, ch: de.clientHeight, outside,
    };
  }, { w: PANEL.widthPx, h: PANEL.heightPx });
  expect(m.sw).toBeLessThanOrEqual(PANEL.widthPx);
  expect(m.sh).toBeLessThanOrEqual(PANEL.heightPx);
  expect([m.iw, m.ih, m.cw, m.ch]).toEqual([PANEL.widthPx, PANEL.heightPx, PANEL.widthPx, PANEL.heightPx]);
  expect(m.outside).toEqual([]);
}

// Visible elements that have a direct non-whitespace text node, with their real colours.
function textElements() {
  const parse = (c) => {
    const m = /^rgba?\(([^)]+)\)$/.exec(c);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '');
    if (!direct || el.getClientRects().length === 0) continue;
    const fg = parse(getComputedStyle(el).color);
    let bg = null;
    let problem = fg && fg.a === 1 ? '' : 'text colour not opaque';
    for (let n = el; n && !bg; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (!c) { problem = problem || 'unparsable background'; break; }
      if (c.a === 1) bg = c;
      else if (c.a > 0) { problem = problem || `semi-transparent background on ${n.tagName}#${n.id}`; break; }
    }
    let ratio = 0;
    if (!problem && bg) {
      const [a, b] = [lum(fg.rgb), lum(bg.rgb)].sort((x, y) => y - x);
      ratio = (a + 0.05) / (b + 0.05);
    } else if (!bg) problem = problem || 'no opaque background';
    out.push({ id: el.id, text: el.textContent.slice(0, 30), ratio, problem });
  }
  return out;
}

async function checkContrastAndFloor(page, label, testInfo) {
  const els = await page.evaluate(textElements);
  expect(els.length).toBeGreaterThan(0);
  expect(els.filter((e) => e.problem)).toEqual([]);
  for (const e of els) expect(e.id, `text element without id: ${e.text}`).not.toBe('');
  const min = Math.min(...els.map((e) => e.ratio));
  const line = `contrast ${label} min=${min.toFixed(2)} pairs=${els.length}`;
  console.log(line);
  testInfo.annotations.push({ type: 'contrast', description: line });
  for (const e of els) expect(e.ratio, `${label} #${e.id} contrast`).toBeGreaterThanOrEqual(7);
  let smallest = Infinity;
  for (const e of els) {
    const mm = (await textSizeMm(page.locator(`#${e.id}`))).capHeightMm;
    smallest = Math.min(smallest, mm);
    expect(mm, `${label} #${e.id} cap height mm`).toBeGreaterThanOrEqual(MIN_MM.floor);
  }
  return smallest;
}

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
    expect(mm).toBeGreaterThanOrEqual(MIN_MM.state);
    await expect(page.locator('body')).toHaveAttribute('data-view', loadFixture(id).view);
    await expect(page.locator('#shape')).toHaveAttribute('data-shape', /\S/);
  });

  test(`fixture ${id} contrast and smallest text`, async ({ openView, page }, testInfo) => {
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
