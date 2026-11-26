// Contrast of the day and the night look, for every fixture state, the list and menu (selected row), the chosen ask option, the
// tags, the clock, the quiet mark and task progress. Re-runnable: it prints a markdown table (state, element, look, fg, bg, ratio)
// and writes it to out/contrast.md (REVVIEW_CONTRAST_OUT overrides the path).
//   day: every text >= 7:1 (as today). night: every text >= 4.5:1, no area bigger than 40x40 px brighter than MAX_AREA_LUM,
//   no pure white anywhere, every shape in one colour (shape, word and place tell the states apart, not colour).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './harness.js';
import { FIXTURE_IDS, EXTRA_FIXTURE_IDS, loadFixture } from '../fixtures.js';
import { WB4_IDS, wb4State } from '../wb4/recipes.js';
import { WORST_CASE_IDS, loadWorstCase, asPermission } from '../worst-case.js';
import { parseColor, luminance, contrastRatio } from '../contrast.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = process.env.REVVIEW_CONTRAST_OUT || path.join(repoRoot, 'out', 'contrast.md');
const MIN_DAY = 7;
const MIN_NIGHT = 4.5;
const MAX_AREA_LUM = 0.25; // night: relative luminance of any background bigger than 40x40 px
const LOOKS = ['day', 'night'];

const NOW = 1_800_000_000_000;
// states that only a look of their own shows: the tags, the clock, the quiet mark, task progress, a lower-bound diff
const SYNTHETIC = {
  'tags-all': { ...loadFixture('working'), hot: true, lowPower: true, buttons: 'missing', since: NOW - 3_900_000, now: NOW, quietSince: NOW - 420_000, tasks: { done: 3, total: 7 }, diff: { added: 12, removed: 3 }, diffIncomplete: true, others: 2 },
  'tags-permission': { ...asPermission(loadWorstCase(WORST_CASE_IDS[0])), hot: true, lowPower: true, buttons: 'missing' },
  'tasks-asking': { ...loadFixture('asking-choice'), tasks: { done: 1, total: 4 } },
};

function states() {
  const list = [];
  for (const id of [...FIXTURE_IDS, ...EXTRA_FIXTURE_IDS]) list.push([id, loadFixture(id)]);
  for (const id of WB4_IDS) list.push([`wb4-${id}`, wb4State(id)]);
  for (const [id, s] of Object.entries(SYNTHETIC)) list.push([id, s]);
  return list;
}

// In the page: every text element with its colours, every opaque background with its size, every painted colour (for pure white).
function collect() {
  const GREY_IDS = ['tasks-word', 'prompt', 'ask-hint', 'offline-note', 'voice-note', 'ask-multi', 'ask-count', 'ask-more', 'nav-title'];
  const TAGS = ['hot-tag', 'power-tag', 'buttons-tag', 'quiet-tag'];
  const visible = (e) => e.getClientRects().length > 0;
  const cat = (e) => {
    if (e.closest('.row[data-selected="true"]')) return 'selected row';
    if (e.closest('.ask-chosen')) return 'ask chosen';
    if (e.id === 'state-word') return 'state word';
    if (TAGS.includes(e.id)) return 'tag';
    if (e.id === 'clock') return 'clock';
    if (e.closest('#band')) return 'band text';
    if (e.id === 'diff-added' || e.id === 'diff-removed') return 'diff';
    if (e.id === 'diff-approx' || e.id === 'tasks-count' || e.hasAttribute('data-answer') || e.hasAttribute('data-failed')
      || (e.id === 'voice-note' && e.hasAttribute('data-board'))) return 'strong note';
    if (GREY_IDS.includes(e.id) || e.id === 'tool' || e.classList.contains('dir') || e.closest('.title')) return 'grey text';
    return 'primary text';
  };
  const texts = [];
  const areas = [];
  const painted = [];
  for (const e of document.querySelectorAll('html, body, body *')) {
    if (e !== document.documentElement && e !== document.body && !visible(e)) continue;
    const cs = getComputedStyle(e);
    const name = e.id || `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? `.${e.className.split(' ')[0]}` : ''}`;
    const direct = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '');
    if (direct) {
      let bg = null;
      for (let n = e; n && !bg; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (!/^rgba\(.*, 0\)$/.test(c) && c !== 'transparent') bg = c;
      }
      texts.push({ name, cat: cat(e), fg: cs.color, bg });
    }
    const r = e.getBoundingClientRect();
    if (!/^rgba\(.*, 0\)$/.test(cs.backgroundColor) && cs.backgroundColor !== 'transparent') {
      areas.push({ name, w: r.width, h: r.height, bg: cs.backgroundColor });
      painted.push({ name, prop: 'background', c: cs.backgroundColor });
    }
    painted.push({ name, prop: 'color', c: cs.color });
    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') painted.push({ name, prop: 'border', c: cs.borderTopColor });
    if (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none') painted.push({ name, prop: 'outline', c: cs.outlineColor });
    if (e.namespaceURI === 'http://www.w3.org/2000/svg') {
      if (cs.fill !== 'none') painted.push({ name, prop: 'fill', c: cs.fill });
      if (cs.stroke !== 'none') painted.push({ name, prop: 'stroke', c: cs.stroke });
    }
  }
  const shape = document.getElementById('shape');
  return { texts, areas, painted, shapeColor: getComputedStyle(shape).color, shapeMarkup: shape.innerHTML };
}

test('contrast of every state in both looks (day >= 7, night >= 4.5, nothing big and bright, no pure white)', async ({ openView, page }) => {
  test.setTimeout(180_000);
  await openView('working');
  const rows = []; // [state, element, look, fg, bg, ratio]
  const problems = [];
  const nightShapes = new Map(); // view -> markup
  const nightShapeColours = new Set();
  let maxAreaLum = { lum: 0, where: '' };
  const minByCat = { day: {}, night: {} };

  for (const [id, state] of states()) {
    for (const look of LOOKS) {
      await page.evaluate((s) => window.revviewRender(s), { ...state, look });
      await expect(page.locator('html')).toHaveAttribute('data-look', look);
      const got = await page.evaluate(collect);
      // the lowest ratio per element kind in this state
      const worst = new Map();
      for (const t of got.texts) {
        const fg = parseColor(t.fg);
        const bg = t.bg && parseColor(t.bg);
        if (!fg || !bg || fg.a !== 1 || bg.a !== 1) { problems.push(`${id} ${look} ${t.name}: colour not opaque (${t.fg} on ${t.bg})`); continue; }
        const ratio = contrastRatio(fg, bg);
        const min = look === 'day' ? MIN_DAY : MIN_NIGHT;
        if (ratio < min) problems.push(`${id} ${look} ${t.cat} #${t.name}: ${ratio.toFixed(2)} < ${min} (${t.fg} on ${t.bg})`);
        const k = t.cat;
        if (!worst.has(k) || ratio < worst.get(k).ratio) worst.set(k, { name: t.name, fg: t.fg, bg: t.bg, ratio });
        minByCat[look][k] = Math.min(minByCat[look][k] ?? Infinity, ratio);
      }
      for (const [k, w] of worst) rows.push([id, `${k} (#${w.name})`, look, w.fg, w.bg, w.ratio.toFixed(2)]);
      if (look === 'night') {
        for (const a of got.areas) {
          if (a.w * a.h <= 40 * 40) continue;
          const lum = luminance(a.bg);
          if (lum > maxAreaLum.lum) maxAreaLum = { lum, where: `${id} #${a.name} ${a.bg}` };
          if (lum > MAX_AREA_LUM) problems.push(`${id} night: large area #${a.name} ${a.w}x${a.h} has luminance ${lum.toFixed(3)} > ${MAX_AREA_LUM}`);
        }
        for (const p of got.painted) {
          const c = parseColor(p.c);
          if (c && c.a > 0 && c.r === 255 && c.g === 255 && c.b === 255) problems.push(`${id} night: pure white ${p.prop} on #${p.name}`);
        }
        nightShapeColours.add(got.shapeColor);
        const view = await page.evaluate(() => document.body.dataset.view);
        if (!SYNTHETIC[id] && FIXTURE_IDS.includes(id)) nightShapes.set(view, got.shapeMarkup);
      }
    }
  }

  // greyscale: one colour for every shape, so the shapes (all different) tell the states apart
  expect([...nightShapeColours], 'night: every #shape has the same colour').toHaveLength(1);
  expect(new Set(nightShapes.values()).size, 'night: every view has its own shape').toBe(nightShapes.size);
  expect(nightShapes.size).toBeGreaterThan(0);

  const fmt = (m) => Object.entries(m).sort(([, a], [, b]) => a - b).map(([k, v]) => `| ${k} | ${v.toFixed(2)} |`).join('\n');
  const md = [
    '# Contrast: day and night look',
    '',
    `Every text must reach ${MIN_DAY}:1 in day and ${MIN_NIGHT}:1 in night. Night: the brightest background bigger than 40x40 px has relative luminance ${maxAreaLum.lum.toFixed(3)} (${maxAreaLum.where}; limit ${MAX_AREA_LUM}).`,
    '',
    '## Lowest ratio per element kind, day',
    '', '| element | min ratio |', '|---|---|', fmt(minByCat.day),
    '',
    '## Lowest ratio per element kind, night',
    '', '| element | min ratio |', '|---|---|', fmt(minByCat.night),
    '',
    '## Every state (the lowest ratio per element kind)',
    '', '| state | element | look | fg | bg | ratio |', '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.join(' | ')} |`),
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, md);
  console.log(md);
  console.log(`contrast table: ${OUT}`);

  expect(problems).toEqual([]);
});
