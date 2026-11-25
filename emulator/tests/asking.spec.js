// CLAUDE ASKS (view 'asking'): Claude Code's AskUserQuestion (a multiple-choice question) or ExitPlanMode (a plan
// to approve) waits for the driver. The question in big type (at most 2 lines), the options numbered 1..4 in a
// 2x2 grid, or the plan title with its step count. Everything must fit 1280x400 with the type sizes in range.
import { test, expect } from './harness.js';
import { loadFixture } from '../fixtures.js';
import { textSizeMm } from '../mm.js';
import { RANGE_MM } from '../../src/view/type.js';
import { expectFits } from './checks.js';

const perm = loadFixture('permission');
const base = {
  ...perm, view: 'asking', activity: 'asking', tool: 'AskUserQuestion', file: null, command: null, output: null, outputLines: [],
};
const question = (ask = {}, extra = {}) => ({
  ...base,
  ask: { kind: 'question', question: 'Which colour should the new file use?', options: ['Red', 'Green', 'Blue'], more: 0, multiSelect: false, questions: 1, ...ask },
  ...extra,
});
const plan = (ask = {}, extra = {}) => ({
  ...base, tool: 'ExitPlanMode', ask: { kind: 'plan', title: 'add hello.sh and README line', steps: 3, ...ask }, ...extra,
});
const OFFLINE_TEXT = 'No network: voice input will not work';
const NOTE = 'Claude asks: look at the terminal when parked';
const ASK_BIG = RANGE_MM.ask; // the question is larger than the 3.55 mm text

const text = (page, sel) => page.locator(sel).evaluate((e) => e.textContent);
const full = (page, sel) => page.locator(sel).getAttribute('data-full');
const cps = (s) => Array.from(s).length;

// every visible text: the question in the big range, the state word as always, everything else in the text range
async function sizesInRange(page) {
  const ids = await page.evaluate(() => [...document.querySelectorAll('body *')]
    .filter((e) => e.getClientRects().length > 0 && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== ''))
    .map((e) => e.id));
  const sizes = {};
  for (const id of ids) {
    expect(id, 'text element without id').not.toBe('');
    const mm = (await textSizeMm(page.locator(`#${id}`))).capHeightMm;
    const [lo, hi] = id === 'state-word' ? RANGE_MM.state : id === 'ask-question' ? ASK_BIG : RANGE_MM.text;
    expect(mm, `#${id} cap height mm`).toBeGreaterThanOrEqual(lo);
    expect(mm, `#${id} cap height mm`).toBeLessThanOrEqual(hi);
    sizes[id] = mm;
  }
  return sizes;
}
const common = async (page) => {
  await expectFits(page);
  return sizesInRange(page);
};
const lines = (page) => page.locator('#ask-question').evaluate((e) => {
  const r = document.createRange();
  r.selectNodeContents(e);
  return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
});

test.describe('question', () => {
  test('with almost no room the question stays at the 4.0 mm size (cut with an ellipsis), never smaller', async ({ openView, page }) => {
    const long = 'Which of these many colours, shapes, sizes and materials should the new file use, and why? '.repeat(3).trim();
    const state = question({ question: long, options: ['One', 'Two', 'Three', 'Four'] }, { offline: true, voice: 'none' });
    await openView(state);
    await page.addStyleTag({ content: '#lower { height: 200px !important; }' }); // less room than the rows below need
    await page.evaluate((s) => window.revviewRender(s), state);
    const mm = (await textSizeMm(page.locator('#ask-question'))).capHeightMm;
    expect(mm).toBeGreaterThanOrEqual(RANGE_MM.ask[0]);
    expect(mm).toBeLessThan(RANGE_MM.ask[0] + 0.3); // the floor, not the roomy size
    expect(await full(page, '#ask-question')).toBe(long);
    expect(await text(page, '#ask-question')).toMatch(/…$/);
  });

  test('the question in big type, the options numbered in a grid', async ({ openView, page }) => {
    await openView(question());
    await expect(page.locator('body')).toHaveAttribute('data-view', 'asking');
    await expect(page.locator('#state-word')).toHaveText('CLAUDE ASKS');
    await expect(page.locator('#shape')).toHaveAttribute('data-shape', 'asking');
    await expect(page.locator('#tool')).toHaveText('AskUserQuestion');
    await expect(page.locator('#ask-question')).toHaveText('Which colour should the new file use?');
    expect(await full(page, '#ask-question')).toBe('Which colour should the new file use?');
    for (const [i, label] of ['Red', 'Green', 'Blue'].entries()) {
      await expect(page.locator(`#ask-n${i + 1}`)).toHaveText(`${i + 1}`);
      await expect(page.locator(`#ask-t${i + 1}`)).toHaveText(label);
      expect(await full(page, `#ask-t${i + 1}`)).toBe(label);
    }
    await expect(page.locator('#ask-o4')).toBeHidden();
    for (const id of ['ask-more', 'ask-count', 'ask-multi', 'ask-steps', 'ask-hint', 'diff', 'cmdbox', 'out1', 'offline-note']) await expect(page.locator(`#${id}`)).toBeHidden();
    const sizes = await common(page);
    // roomy case: the question is in the state word's size
    expect(sizes['ask-question']).toBeGreaterThanOrEqual(RANGE_MM.state[0]);
    expect(sizes['ask-n1']).toBeGreaterThanOrEqual(RANGE_MM.text[0]);
    // the numbers are bold, the labels are not
    expect(await page.locator('#ask-n1').evaluate((e) => getComputedStyle(e).fontWeight)).toBe('700');
    expect(await page.locator('#ask-t1').evaluate((e) => getComputedStyle(e).fontWeight)).toBe('400');
  });

  test('a 2x2 grid: 1 2 above 3 4, the number before its label', async ({ openView, page }) => {
    await openView(question({ options: ['A', 'B', 'C', 'D'] }));
    const r = (id) => page.locator(id).evaluate((e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; });
    const [o1, o2, o3, o4] = await Promise.all([1, 2, 3, 4].map((i) => r(`#ask-o${i}`)));
    expect(o2.l).toBeGreaterThan(o1.r - 0.5);
    expect(Math.abs(o1.t - o2.t)).toBeLessThan(1);
    expect(o3.t).toBeGreaterThan(o1.b - 0.5);
    expect(Math.abs(o3.l - o1.l)).toBeLessThan(1);
    expect(Math.abs(o4.l - o2.l)).toBeLessThan(1);
    const [n1, t1] = await Promise.all([r('#ask-n1'), r('#ask-t1')]);
    expect(t1.l).toBeGreaterThan(n1.r - 0.5);
    await common(page);
  });

  test('colour: not the permission amber, its own shape, black text on it keeps the contrast floor', async ({ openView, page }) => {
    await openView(question());
    const look = () => page.evaluate(() => ({ bg: getComputedStyle(document.getElementById('band')).backgroundColor, shape: document.getElementById('shape').innerHTML }));
    const asks = await look();
    await openView(perm);
    const p = await look();
    expect(asks.shape).not.toBe(p.shape);
    expect(asks.bg).not.toBe(p.bg);
    const [r, g, b] = asks.bg.match(/\d+/g).map(Number);
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    expect((0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) + 0.05) / 0.05).toBeGreaterThanOrEqual(7);
  });

  test('no diff, even with a turn total', async ({ openView, page }) => {
    await openView(question({}, { diff: { added: 5, removed: 3 }, diffIncomplete: true }));
    await expect(page.locator('#diff')).toBeHidden();
    await expect(page.locator('#diff')).toHaveAttribute('data-full', '');
    await expectFits(page);
  });

  test('question null: the fixed note', async ({ openView, page }) => {
    await openView(question({ question: null, options: [] }));
    await expect(page.locator('#ask-question')).toHaveText(NOTE);
    expect(await full(page, '#ask-question')).toBe(NOTE);
    await expect(page.locator('#ask-o1')).toBeHidden();
    await common(page);
  });

  test('4 options, more, 2 questions, multiSelect', async ({ openView, page }) => {
    await openView(question({ options: ['One', 'Two', 'Three', 'Four'], more: 3, questions: 2, multiSelect: true }));
    await expect(page.locator('#ask-more')).toHaveText('+3 more');
    await expect(page.locator('#ask-count')).toHaveText('1 of 2');
    await expect(page.locator('#ask-multi')).toHaveText('pick any');
    for (const id of ['ask-more', 'ask-count', 'ask-multi']) expect(await full(page, `#${id}`)).not.toBe('');
    await expect(page.locator('#ask-t4')).toHaveText('Four');
    await common(page);
    // not shown for one question, none left over, a single choice
    await openView(question({ options: ['One', 'Two', 'Three', 'Four'], more: 0, questions: 1, multiSelect: false }));
    for (const id of ['ask-more', 'ask-count', 'ask-multi']) {
      await expect(page.locator(`#${id}`)).toBeHidden();
      expect(await full(page, `#${id}`)).toBe('');
    }
  });

  test('no options at all (a free-text question)', async ({ openView, page }) => {
    await openView(question({ options: [] }));
    await expect(page.locator('#ask-question')).toHaveText('Which colour should the new file use?');
    await expect(page.locator('#ask-o1')).toBeHidden();
    await common(page);
  });

  test('offline: the permission look, plus the offline-note row', async ({ openView, page }) => {
    await openView(question({ options: ['One', 'Two', 'Three', 'Four'], more: 2, questions: 3, multiSelect: true }, { offline: true, others: 9, voice: 'none' }));
    await expect(page.locator('#state-word')).toHaveText('CLAUDE ASKS');
    await expect(page.locator('#offline-note')).toHaveText(OFFLINE_TEXT);
    expect(await full(page, '#offline-note')).toBe(OFFLINE_TEXT);
    await expect(page.locator('#voice-note')).toBeVisible();
    const [q, n] = await page.evaluate(() => ['ask-t4', 'offline-note'].map((i) => document.getElementById(i).getBoundingClientRect().bottom));
    expect(n).toBeGreaterThan(q);
    const sizes = await common(page);
    // with both bottom rows the question gives up some size (the largest that fits), still bigger than the text
    expect(sizes['ask-question']).toBeGreaterThan(RANGE_MM.text[1]);
    await openView(question({}, { offline: false }));
    await expect(page.locator('#offline-note')).toBeHidden();
    expect(await full(page, '#offline-note')).toBe('');
  });
});

test.describe('plan', () => {
  test('Plan: title, steps and the terminal line', async ({ openView, page }) => {
    await openView(plan());
    await expect(page.locator('#state-word')).toHaveText('CLAUDE ASKS');
    await expect(page.locator('#tool')).toHaveText('ExitPlanMode');
    await expect(page.locator('#ask-question')).toHaveText('Plan: add hello.sh and README line');
    expect(await full(page, '#ask-question')).toBe('Plan: add hello.sh and README line');
    await expect(page.locator('#ask-steps')).toHaveText('3 steps');
    await expect(page.locator('#ask-hint')).toHaveText('Approve in the terminal when parked');
    await expect(page.locator('#ask-o1')).toBeHidden();
    const sizes = await common(page);
    expect(sizes['ask-question']).toBeGreaterThanOrEqual(RANGE_MM.state[0]);
    const [a, b] = await page.evaluate(() => ['ask-question', 'ask-steps'].map((i) => document.getElementById(i).getBoundingClientRect().top));
    expect(a).toBeLessThan(b);
  });

  test('1 step; null steps left out; null title', async ({ openView, page }) => {
    await openView(plan({ steps: 1 }));
    await expect(page.locator('#ask-steps')).toHaveText('1 step');
    await openView(plan({ steps: null }));
    await expect(page.locator('#ask-steps')).toBeHidden();
    await expect(page.locator('#ask-hint')).toBeVisible();
    await expectFits(page);
    await openView(plan({ title: null }));
    await expect(page.locator('#ask-question')).toHaveText('Claude has a plan');
    expect(await full(page, '#ask-question')).toBe('Claude has a plan');
    await common(page);
    await openView(plan({ title: null, steps: null }));
    await common(page);
  });

  test('offline and a long title', async ({ openView, page }) => {
    const title = 'rewrite the whole configuration loader so that every setting can be overridden from the environment '.repeat(2).slice(0, 120);
    await openView(plan({ title, steps: 12 }, { offline: true, voice: 'not-owned' }));
    await expect(page.locator('#offline-note')).toHaveText(OFFLINE_TEXT);
    expect(await full(page, '#ask-question')).toBe(`Plan: ${title}`);
    expect(await lines(page)).toBeLessThanOrEqual(2);
    await common(page);
  });
});

test.describe('worst case: everything at its limit', () => {
  const words = Array.from({ length: 40 }, (_, i) => ['configuration', 'extraordinarily', 'internationalization', 'WWWWWWWW'][i % 4]).join(' ');
  const cases = {
    'long words': { question: Array.from(words).slice(0, 200).join('') },
    'one unbroken token': { question: 'W'.repeat(199) + '…' },
    'one unbroken token of narrow letters': { question: 'i'.repeat(200) },
    'wide CJK': { question: '这是一个非常长的问题用来测试全角文字的宽度'.repeat(10).slice(0, 200) },
  };
  const wide = ['W'.repeat(60), '这个选项的标签非常长用来测试全角文字的宽度'.repeat(3).slice(0, 60), 'ｗｉｄｅ'.repeat(15), 'mmmmmmmmmm mmmmmmmmmm mmmmmmmmmm mmmmmmmmmm mmmmmmmmmm mmmmmmmmmm'.slice(0, 60)];
  for (const [name, q] of Object.entries(cases)) {
    for (const flags of [{}, { offline: true, voice: 'not-owned', others: 12, hot: true, lowPower: true, buttons: 'missing' }]) {
      test(`${name}, four 60-cp labels${Object.keys(flags).length ? ', all extras' : ''}`, async ({ openView, page }) => {
        expect(cps(q.question)).toBeLessThanOrEqual(200);
        await openView(question({ ...q, options: wide, more: 7, questions: 4, multiSelect: true }, flags));
        await expect(page.locator('#ask-question')).toHaveAttribute('data-full', q.question);
        expect(await lines(page)).toBeLessThanOrEqual(2);
        for (const [i, label] of wide.entries()) {
          expect(cps(label)).toBeLessThanOrEqual(60);
          expect(await full(page, `#ask-t${i + 1}`)).toBe(label);
          // one line
          expect(await page.locator(`#ask-t${i + 1}`).evaluate((e) => e.getBoundingClientRect().height)).toBeLessThanOrEqual(40);
        }
        // a cut question ends with an ellipsis, and never shows more than it was given
        const shown = await text(page, '#ask-question');
        expect(shown === q.question || shown.endsWith('…')).toBe(true);
        expect(cps(shown)).toBeLessThanOrEqual(cps(q.question));
        await common(page);
      });
    }
  }
  test('the plan title at its limit (120 code points), one unbroken token', async ({ openView, page }) => {
    for (const title of ['W'.repeat(120), '这是一个非常长的计划标题'.repeat(12).slice(0, 120)]) {
      await openView(plan({ title, steps: 999 }, { offline: true, voice: 'none' }));
      expect(await full(page, '#ask-question')).toBe(`Plan: ${title}`);
      expect(await lines(page)).toBeLessThanOrEqual(2);
      await common(page);
    }
  });
});

test('bad ask data shows the fixed note; other views draw none of it', async ({ openView, page }) => {
  for (const ask of [null, undefined, {}, { kind: 'x' }, 'text', []]) {
    await openView({ ...base, ask });
    await expect(page.locator('#ask-question')).toHaveText(NOTE);
    await expectFits(page);
  }
  await openView(question({ options: ['ok', 7, null, 'fine'], more: -2, questions: 'x', multiSelect: 'yes' }));
  await expect(page.locator('#ask-t2')).toHaveText('fine');
  for (const id of ['ask-more', 'ask-count', 'ask-multi']) await expect(page.locator(`#${id}`)).toBeHidden();
  for (const view of ['working', 'permission', 'done']) {
    await openView({ ...loadFixture(view), ask: { kind: 'question', question: 'x?', options: ['a'], more: 0, multiSelect: false, questions: 1 } });
    for (const id of ['ask-question', 'ask-o1', 'ask-steps', 'ask-hint', 'ask-meta']) await expect(page.locator(`#${id}`)).toBeHidden();
  }
});

test('asking in a session list row: ASKS chip and word', async ({ openView, page }) => {
  const nav = { kind: 'list', row: 0, rows: [{ label: 'revview', state: 'asking', word: 'ASKS', target: true }, { label: 'garden', state: 'permission', word: 'PERM' }] };
  await openView({ ...question(), voice: 'here', position: { index: 1, count: 2 }, nav });
  await expect(page.locator('#row0-word')).toHaveText('ASKS');
  const chip = (i) => page.locator('.chip').nth(i).evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(await chip(0)).not.toBe(await chip(1));
  await expectFits(page);
});
