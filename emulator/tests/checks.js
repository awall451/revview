// Shared layout checks: the panel fit, and contrast and size ranges of every visible text.
import { expect } from './harness.js';
import { textSizeMm } from '../mm.js';
import { PANEL } from '../panel.js';
import { RANGE_MM } from '../../src/view/type.js';

// Visible text boxes (elements with their own text): inside the panel, not clipped by an ancestor with
// overflow other than visible, and no two of them overlapping. Returns a list of problems.
function textBoxProblems({ w, h }) {
  const boxes = [];
  const problems = [];
  const name = (e) => `${e.tagName}#${e.id}`;
  for (const el of document.querySelectorAll('body *')) {
    const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '');
    if (!direct || el.getClientRects().length === 0) continue;
    const r = el.getBoundingClientRect();
    boxes.push({ el, r });
    if (r.left < -0.5 || r.top < -0.5 || r.right > w + 0.5 || r.bottom > h + 0.5) problems.push(`${name(el)} outside the panel`);
    for (let a = el.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const ar = a.getBoundingClientRect();
      if (r.left < ar.left - 0.5 || r.top < ar.top - 0.5 || r.right > ar.right + 0.5 || r.bottom > ar.bottom + 0.5) {
        problems.push(`${name(el)} clipped by ${name(a)}`);
      }
    }
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r;
      const b = boxes[j].r;
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5) {
        problems.push(`${name(boxes[i].el)} overlaps ${name(boxes[j].el)}`);
      }
    }
  }
  return problems;
}

export async function expectFits(page) {
  expect(await page.evaluate(textBoxProblems, { w: PANEL.widthPx, h: PANEL.heightPx })).toEqual([]);
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

export async function checkContrastAndFloor(page, label, testInfo) {
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
    const [lo, hi] = e.id === 'state-word' ? RANGE_MM.state : e.id === 'ask-question' ? RANGE_MM.ask : RANGE_MM.text;
    if (e.id !== 'state-word') smallest = Math.min(smallest, mm);
    expect(mm, `${label} #${e.id} cap height mm`).toBeGreaterThanOrEqual(lo);
    expect(mm, `${label} #${e.id} cap height mm`).toBeLessThanOrEqual(hi);
  }
  return smallest;
}
