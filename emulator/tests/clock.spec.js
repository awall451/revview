// The time marks: the clock (time in the current state), the QUIET mark, the task progress in row A, QUIET in the list, and the room they take.
import fs from 'node:fs';
import { test, expect } from './harness.js';
import { expectFits } from './checks.js';
import { textSizeMm } from '../mm.js';
import { RANGE_MM } from '../../src/view/type.js';
import { startLiveServer } from '../../src/server/index.js';
import { loadFixture } from '../fixtures.js';
import { loadWorstCase, asPermission } from '../worst-case.js';

const NOW = 1_800_000_000_000;
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const at = (ms) => ({ now: NOW, since: NOW - ms });
const clock = (page) => page.locator('#clock');

test.describe('clock', () => {
  for (const [ms, text, words] of [
    [7 * SEC, '0:07', 'In this state for 7 s'],
    [754 * SEC, '12:34', 'In this state for 12 min 34 s'],
    [59 * MIN + 59 * SEC, '59:59', 'In this state for 59 min 59 s'],
    [HOUR + 5 * MIN, '1h05', 'In this state for 1 h 5 min'],
    [23 * HOUR + 59 * MIN, '23h59', 'In this state for 23 h 59 min'],
    [99 * HOUR + 59 * MIN, '99h59', 'In this state for 99 h 59 min'],
    [100 * HOUR, '99h+', 'In this state for 100 h or more'],
    [-5 * SEC, '0:00', 'In this state for 0 s'],
  ]) {
    test(`WORKING shows ${text}`, async ({ openView, page }) => {
      await openView({ ...loadFixture('working'), ...at(ms) });
      await expect(clock(page)).toHaveText(text);
      await expect(clock(page)).toHaveAttribute('data-full', words);
      await expect(page.locator('#quiet-tag')).toBeHidden();
      await expectFits(page);
    });
  }

  test('the clock sits right after the state word, in the band text colour, bold', async ({ openView, page }) => {
    await openView({ ...loadFixture('permission'), ...at(754 * SEC), others: 1 });
    const order = await page.evaluate(() => {
      const left = (id) => document.getElementById(id).getBoundingClientRect().left;
      return [left('state-word'), left('clock'), left('others'), left('where')];
    });
    expect(order).toEqual([...order].sort((a, b) => a - b));
    const css = await clock(page).evaluate((e) => ({ w: getComputedStyle(e).fontWeight, c: getComputedStyle(e).color, band: getComputedStyle(document.getElementById('band')).color }));
    expect(css.w).toBe('700');
    expect(css.c).toBe(css.band);
  });

  test('the clock size is the detail size (3.3 to 3.7 mm cap height)', async ({ openView, page }) => {
    await openView({ ...loadFixture('working'), ...at(754 * SEC), quietSince: NOW - 7 * MIN });
    for (const id of ['#clock', '#quiet-tag']) {
      const mm = (await textSizeMm(page.locator(id))).capHeightMm;
      expect(mm, id).toBeGreaterThanOrEqual(RANGE_MM.text[0]);
      expect(mm, id).toBeLessThanOrEqual(RANGE_MM.text[1]);
    }
  });

  test('shown for working, permission and asking only', async ({ openView, page }) => {
    for (const [id, shown] of [['working', true], ['permission', true], ['asking', true], ['waiting', false], ['done', false], ['offline', false], ['unknown', false], ['ended', false]]) {
      await openView({ ...loadFixture(id), ...at(754 * SEC) });
      if (shown) await expect(clock(page), id).toHaveText('12:34');
      else await expect(clock(page), id).toBeHidden();
    }
  });

  test('no clock without since, without now, or with a non-number', async ({ openView, page }) => {
    await openView({ ...loadFixture('working'), now: NOW, since: null });
    await expect(clock(page)).toBeHidden();
    await openView({ ...loadFixture('working'), since: NOW - 754 * SEC });
    await expect(clock(page)).toBeHidden();
    await openView({ ...loadFixture('working'), now: 'x', since: NOW });
    await expect(clock(page)).toBeHidden();
    await openView({ ...loadFixture('working'), now: NOW, since: 'x' });
    await expect(clock(page)).toBeHidden();
  });

  test('the static page never ticks', async ({ openView, page }) => {
    await openView({ ...loadFixture('working'), ...at(754 * SEC) });
    await page.waitForTimeout(2300);
    await expect(clock(page)).toHaveText('12:34');
  });
});

test.describe('quiet mark', () => {
  const quiet = (n, extra = {}) => ({ ...loadFixture('working'), ...at(HOUR + 5 * MIN), quietSince: NOW - n, ...extra });

  for (const [ms, text, words] of [
    [7 * MIN + 10 * SEC, 'QUIET 7 MIN', 'No event from Claude for 7 min: a long command, or stuck'],
    [20 * SEC, 'QUIET 1 MIN', 'No event from Claude for 1 min: a long command, or stuck'],
    [99 * MIN, 'QUIET 99 MIN', 'No event from Claude for 99 min: a long command, or stuck'],
    [100 * MIN, 'QUIET 99+ MIN', 'No event from Claude for over 99 min: a long command, or stuck'],
  ]) {
    test(`reads ${text}`, async ({ openView, page }) => {
      await openView(quiet(ms));
      const tag = page.locator('#quiet-tag');
      await expect(tag).toHaveText(text);
      await expect(tag).toHaveAttribute('data-full', words);
      await expect(clock(page)).toHaveText('1h05');
    });
  }

  test('looks like the HOT tag, right after the clock', async ({ openView, page }) => {
    await openView(quiet(7 * MIN, { hot: true }));
    const look = (id) => page.locator(id).evaluate((e) => {
      const cs = getComputedStyle(e);
      return { size: cs.fontSize, weight: cs.fontWeight, border: cs.borderTopWidth, bg: cs.backgroundColor, h: e.getBoundingClientRect().height };
    });
    expect(await look('#quiet-tag')).toEqual(await look('#hot-tag'));
    const [c, q] = await page.evaluate(() => ['clock', 'quiet-tag'].map((id) => document.getElementById(id).getBoundingClientRect()));
    expect(q.left).toBeGreaterThanOrEqual(c.right);
    expect(q.left - c.right).toBeLessThan(30);
  });

  test('only while working, and only with a quiet time and a known now', async ({ openView, page }) => {
    await openView({ ...loadFixture('permission'), ...at(754 * SEC), quietSince: NOW - 7 * MIN });
    await expect(page.locator('#quiet-tag')).toBeHidden();
    await openView({ ...loadFixture('working'), ...at(754 * SEC), quietSince: null });
    await expect(page.locator('#quiet-tag')).toBeHidden();
    await openView({ ...loadFixture('working'), since: NOW - 754 * SEC, quietSince: NOW - 7 * MIN });
    await expect(page.locator('#quiet-tag')).toBeHidden();
  });
});

test.describe('task progress', () => {
  const withTasks = (id, tasks, extra = {}) => ({ ...loadFixture(id), tasks, ...extra });

  test('tasks 3/7 in row A, before the diff, grey word and white bold count', async ({ openView, page }) => {
    await openView(withTasks('working', { done: 3, total: 7 }));
    await expect(page.locator('#tasks-word')).toHaveText('tasks');
    await expect(page.locator('#tasks-count')).toHaveText('3/7');
    await expect(page.locator('#tasks')).toHaveAttribute('data-full', '3 of 7 tasks done');
    const css = await page.evaluate(() => {
      const cs = (id) => getComputedStyle(document.getElementById(id));
      return { w: [cs('tasks-word').color, cs('tasks-word').fontWeight], c: [cs('tasks-count').color, cs('tasks-count').fontWeight] };
    });
    expect(css.w).toEqual(['rgb(184, 184, 184)', '400']);
    expect(css.c).toEqual(['rgb(255, 255, 255)', '700']);
    const [t, d] = await page.evaluate(() => ['tasks', 'diff'].map((id) => document.getElementById(id).getBoundingClientRect()));
    expect(t.right).toBeLessThanOrEqual(d.left);
    await expectFits(page);
  });

  test('shown where row A shows the tool', async ({ openView, page }) => {
    for (const [id, shown] of [['working', true], ['waiting', true], ['done', true], ['permission', true], ['asking', true], ['offline', false], ['unknown', false], ['ended', false], ['starting', false]]) {
      await openView(withTasks(id, { done: 3, total: 7 }));
      if (shown) await expect(page.locator('#tasks-count'), id).toHaveText('3/7');
      else await expect(page.locator('#tasks'), id).toBeHidden();
      await expectFits(page);
    }
  });

  test('not shown without a list, or with nonsense', async ({ openView, page }) => {
    for (const tasks of [null, { done: 0, total: 0 }, { done: 5, total: 3 }, { done: -1, total: 3 }, { done: '1', total: 3 }, 'x']) {
      await openView(withTasks('working', tasks));
      await expect(page.locator('#tasks'), JSON.stringify(tasks)).toBeHidden();
    }
    await openView(withTasks('working', { done: 0, total: 1 }));
    await expect(page.locator('#tasks-count')).toHaveText('0/1');
  });

  test('not under the list', async ({ openView, page }) => {
    await openView(withTasks('working', { done: 3, total: 7 }, { nav: { kind: 'list', row: 0, rows: [{ label: 'a', state: 'working', word: 'WORKING' }] } }));
    await expect(page.locator('#tasks-count')).toBeHidden();
    await expect(page.locator('#nav')).toBeVisible();
  });

  test('tasks 200/200 with the biggest diff and a long file: the file gives way', async ({ openView, page }) => {
    const file = 'src/components/checkout/refund/RefundFlowSummaryPanel.component.spec.tsx';
    await openView({ ...withTasks('working', { done: 200, total: 200 }), tool: 'Edit', file, diff: { added: 999999999, removed: 999999999 } });
    await expect(page.locator('#tasks-count')).toHaveText('200/200');
    await expect(page.locator('#diff-added')).toHaveText('+999M');
    await expect(page.locator('#file')).toHaveAttribute('data-full', file);
    const [t, d, f] = await page.evaluate(() => ['tasks', 'diff', 'file'].map((id) => document.getElementById(id).getBoundingClientRect()));
    expect(t.right).toBeLessThanOrEqual(d.left);
    expect(f.right).toBeLessThanOrEqual(t.left);
    expect(t.width).toBeGreaterThan(150);
    await expectFits(page);
    await openView({ ...withTasks('permission', { done: 200, total: 200 }), tool: 'Edit', file });
    await expectFits(page);
  });

  test('asking: tasks beside the counts', async ({ openView, page }) => {
    await openView({ ...loadFixture('asking-choice'), tasks: { done: 3, total: 7 }, ...at(754 * SEC) });
    await expect(page.locator('#tasks-count')).toHaveText('3/7');
    await expectFits(page);
  });
});

test.describe('the list', () => {
  test('a quiet session row reads QUIET instead of the state word', async ({ openView, page }) => {
    const rows = [
      { label: 'revview', state: 'working', word: 'WORKING', quiet: true },
      { label: 'garden', state: 'working', word: 'WORKING', quiet: false },
      { label: 'notes', state: 'waiting', word: 'WAITING' },
    ];
    await openView({ ...loadFixture('working'), nav: { kind: 'list', row: 0, rows } });
    await expect(page.locator('#row0-word')).toHaveText('QUIET');
    await expect(page.locator('#row1-word')).toHaveText('WORKING');
    await expect(page.locator('#row2-word')).toHaveText('WAITING');
    await expect(page.locator('#row0-label')).toHaveText('revview');
    expect(await page.locator('#nav .chip').first().evaluate((e) => e.style.background)).toBe(await page.locator('#nav .chip').nth(1).evaluate((e) => e.style.background));
    await expectFits(page);
  });
});

test.describe('room', () => {
  const widest = { ...at(400 * HOUR), quietSince: NOW - 200 * MIN };
  const marks = { hot: true, lowPower: true, buttons: 'missing' };

  async function snapshot(page) {
    return page.evaluate(() => {
      const box = (id) => { const e = document.getElementById(id); return e.getClientRects().length ? e.getBoundingClientRect() : null; };
      const cl = document.getElementById('clock');
      return {
        tight: document.getElementById('band').classList.contains('tight'),
        clockHidden: cl.hidden, clockRoom: cl.dataset.room ?? '', clockFull: cl.dataset.full,
        quiet: box('quiet-tag') !== null, hint: box('others') !== null, voice: box('voice') !== null, hot: box('hot-tag') !== null, nb: box('buttons-tag') !== null,
        tagsRight: box('tags')?.right ?? 0, barRight: document.getElementById('band').clientWidth,
      };
    });
  }

  test('the widest clock fits beside NEEDS PERMISSION and +9 without hiding', async ({ openView, page }) => {
    await openView({ ...loadFixture('permission'), others: 9, ...at(59 * MIN + 59 * SEC) });
    const s = await snapshot(page);
    expect(s.clockHidden).toBe(false);
    expect(s.hint).toBe(true);
    await expectFits(page);
  });

  test('worst: WORKING, clock 99h+, QUIET 99+ MIN, 9+, HOT, LOW POWER, NO BUTTONS: fits, the quiet mark, the hint and NO BUTTONS stay', async ({ openView, page }) => {
    await openView({ ...loadFixture('working'), repo: 'revview', branch: 'main', others: 12, ...marks, ...widest });
    const s = await snapshot(page);
    console.log('worst working', JSON.stringify(s));
    expect(s.clockHidden).toBe(true);
    expect(s.clockRoom).toBe('hidden');
    expect(s.clockFull).toBe('In this state for 100 h or more');
    expect([s.quiet, s.hint, s.nb]).toEqual([true, true, true]);
    await expectFits(page);
  });

  test('worst: WORKING with the mic and position 12/13 and the same marks: fits, the mic, the position, the quiet mark and NO BUTTONS stay', async ({ openView, page }) => {
    await openView({ ...loadFixture('working'), repo: 'revview', branch: 'main', others: 12, elsewhere: 2, voice: 'here', position: { index: 12, count: 13 }, ...marks, ...widest });
    const s = await snapshot(page);
    console.log('worst working mic', JSON.stringify(s));
    expect(s.clockHidden).toBe(true);
    expect([s.quiet, s.voice, s.nb]).toEqual([true, true, true]);
    expect(await page.locator('#position').textContent()).toBe('12/13');
    await expectFits(page);
  });

  test('worst: NEEDS PERMISSION, clock, 9+ and the marks: fits, offline too', async ({ openView, page }) => {
    for (const extra of [{}, { offline: true }, { voice: 'here', position: { index: 12, count: 13 }, elsewhere: 2 }]) {
      await openView({ ...loadFixture('permission'), repo: 'revview', branch: 'main', others: 12, ...marks, ...widest, ...extra });
      const s = await snapshot(page);
      console.log('worst permission', JSON.stringify(extra), JSON.stringify(s));
      expect(s.clockHidden).toBe(true);
      expect(s.hint).toBe(true);
      expect(s.nb).toBe(true);
      await expectFits(page);
    }
  });

  test('the clock shows when only the quiet tag and a short hint are beside it, and goes when they do not fit', async ({ openView, page }) => {
    await openView({ ...loadFixture('working'), others: 1, ...at(754 * SEC), quietSince: NOW - 7 * MIN });
    expect((await snapshot(page)).clockHidden).toBe(false);
    await expectFits(page);
    await openView({ ...loadFixture('working'), others: 12, ...marks, ...at(754 * SEC), quietSince: NOW - 7 * MIN });
    const s = await snapshot(page);
    expect(s.clockHidden).toBe(true);
    expect(s.quiet).toBe(true);
    await expectFits(page);
  });

  for (const wc of ['time-marks', 'time-mic']) {
    for (const view of ['working', 'permission']) {
      test(`worst case ${wc} (${view}) fits and keeps the hint and NO BUTTONS`, async ({ openView, page }) => {
        const content = loadWorstCase(wc);
        await openView({ ...loadFixture(view), ...(view === 'permission' ? asPermission(content) : content) });
        const s = await snapshot(page);
        expect(s.hint).toBe(true);
        expect(s.nb).toBe(true);
        if (view === 'working') expect(s.quiet).toBe(true);
        await expectFits(page);
      });
    }
  }

  test('asking with a clock and counts fits', async ({ openView, page }) => {
    await openView({ ...loadFixture('asking-choice'), ...at(59 * MIN + 59 * SEC), others: 9, ...marks });
    await expectFits(page);
    await openView({ ...loadFixture('asking-plan'), ...at(754 * SEC), others: 2, tasks: { done: 200, total: 200 } });
    await expect(clock(page)).toHaveText('12:34');
    await expectFits(page);
  });
});

// ---- live: the page's own clock is wrong; the server's `now` in each message sets the time ----
test.describe('live', () => {
  const ID = 'cccccccc-3333-4333-8333-333333333333';
  const T0 = 1_000_000_000_000;

  async function boot(opts = {}) {
    const c = { t: T0 };
    const server = await startLiveServer({ port: 0, clock: () => c.t, ...opts });
    const post = async (e) => expect((await fetch(`${server.url}/event`, { method: 'POST', body: JSON.stringify(e) })).status).toBe(204);
    return { c, server, post };
  }
  const start = [
    { hook_event_name: 'SessionStart', session_id: ID, cwd: '/w/revview', source: 'startup' },
    { hook_event_name: 'UserPromptSubmit', session_id: ID, cwd: '/w/revview', prompt: 'go' },
  ];

  test('the elapsed time comes from the server clock, however wrong the page clock is, and ticks every second', async ({ page }) => {
    const { c, server, post } = await boot();
    try {
      // the page thinks it is 2035
      await page.clock.install({ time: new Date('2035-03-04T05:06:07Z') });
      await page.goto(`${server.url}/`);
      await page.clock.pauseAt(new Date('2035-03-04T05:07:00Z')); // from here the page's time moves only when the test moves it
      for (const e of start) await post(e);
      await expect(page.locator('body')).toHaveAttribute('data-view', 'working');
      await expect(clock(page)).toHaveText('0:00');
      // 12 min 34 s later (server time) a new event makes a new message
      c.t = T0 + 754 * SEC;
      await post({ hook_event_name: 'PreToolUse', session_id: ID, cwd: '/w/revview', tool_name: 'Bash', tool_input: { command: 'ls' } });
      await expect(clock(page)).toHaveText('12:34');
      await expect(clock(page)).toHaveAttribute('data-full', 'In this state for 12 min 34 s');
      // the page's seconds go by: the clock moves, from the offset, without a new message
      const seq = await page.locator('html').getAttribute('data-seq');
      await page.clock.fastForward(5 * SEC);
      await expect(clock(page)).toHaveText('12:39');
      await page.clock.fastForward(61 * SEC);
      await expect(clock(page)).toHaveText('13:40');
      expect(await page.locator('html').getAttribute('data-seq')).toBe(seq);
    } finally {
      await server.close();
    }
  });

  test('a page clock far in the past gives the same time', async ({ page }) => {
    const { c, server, post } = await boot();
    try {
      await page.clock.install({ time: new Date('2001-01-01T00:00:00Z') });
      await page.goto(`${server.url}/`);
      await page.clock.pauseAt(new Date('2001-01-01T00:01:00Z'));
      for (const e of start) await post(e);
      c.t = T0 + 65 * MIN;
      await post({ hook_event_name: 'PreToolUse', session_id: ID, cwd: '/w/revview', tool_name: 'Bash', tool_input: { command: 'ls' } });
      await expect(clock(page)).toHaveText('1h05');
    } finally {
      await server.close();
    }
  });

  test('QUIET shows from the server timer, ticks, and any event clears it', async ({ page }) => {
    const { c, server, post } = await boot({ quietMs: 200 });
    try {
      await page.clock.install({ time: new Date('2035-03-04T05:06:07Z') });
      await page.goto(`${server.url}/`);
      await page.clock.pauseAt(new Date('2035-03-04T05:07:00Z'));
      for (const e of start) await post(e);
      await expect(page.locator('body')).toHaveAttribute('data-view', 'working');
      await expect(page.locator('#quiet-tag')).toBeHidden();
      // the silence has lasted 7 min of server time when the timer fires
      c.t = T0 + 7 * MIN + 5 * SEC;
      await expect(page.locator('#quiet-tag')).toHaveText('QUIET 7 MIN', { timeout: 5000 });
      await expect(clock(page)).toHaveText('7:05');
      await page.clock.fastForward(60 * SEC);
      await expect(page.locator('#quiet-tag')).toHaveText('QUIET 8 MIN');
      await expect(clock(page)).toHaveText('8:05');
      await post({ hook_event_name: 'PreToolUse', session_id: ID, cwd: '/w/revview', tool_name: 'Bash', tool_input: { command: 'ls' } });
      await expect(page.locator('#quiet-tag')).toBeHidden();
    } finally {
      await server.close();
    }
  });

  test('without now in a message the page uses its own clock (offset 0)', async ({ page }) => {
    // the page drops `now` from every message, like an older server
    await page.addInitScript(() => {
      const Orig = window.EventSource;
      window.EventSource = class extends Orig {
        set onmessage(fn) {
          super.onmessage = (ev) => {
            const m = JSON.parse(ev.data);
            delete m.now;
            fn({ data: JSON.stringify(m) });
          };
        }
      };
    });
    const c = { t: Date.now() - 754 * SEC };
    const server = await startLiveServer({ port: 0, clock: () => c.t });
    try {
      await page.goto(`${server.url}/`);
      for (const e of start) await fetch(`${server.url}/event`, { method: 'POST', body: JSON.stringify(e) });
      await expect(page.locator('body')).toHaveAttribute('data-view', 'working');
      await expect(clock(page)).toHaveText(/^12:3\d$/);
    } finally {
      await server.close();
    }
  });

  test('the task list of the real recording shows as tasks N/M', async ({ page }) => {
    const lines = fs.readFileSync(new URL('../../fixtures/sessions/task-list.jsonl', import.meta.url), 'utf8').split('\n').filter((l) => l.trim() !== '');
    const expected = JSON.parse(fs.readFileSync(new URL('../../fixtures/sessions/task-list.expected.json', import.meta.url), 'utf8'));
    const events = lines.map((l) => JSON.parse(l));
    const stop = events.findIndex((e) => e.hook_event_name === 'Stop');
    const { server } = await boot();
    try {
      await page.goto(`${server.url}/`);
      let last = null;
      for (let i = 0; i < stop; i += 1) {
        const r = await fetch(`${server.url}/event`, { method: 'POST', body: lines[i] });
        expect(r.status).toBe(204);
        if (expected[i].state.tasks) last = expected[i].state.tasks;
      }
      expect(last).not.toBeNull();
      await expect(page.locator('#tasks-count')).toHaveText(`${last.done}/${last.total}`);
      await expect(page.locator('#tasks')).toHaveAttribute('data-full', `${last.done} of ${last.total} tasks done`);
    } finally {
      await server.close();
    }
  });
});
