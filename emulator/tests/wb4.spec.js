// WB4: the bar's new looks (mic mark and position, shown-is-not-target notes, prompt elsewhere, list and menu).
// Every state comes from the real board (emulator/wb4/recipes.js); one 1280x400 screenshot per look.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, shotsDir } from './harness.js';
import { expectFits, checkContrastAndFloor } from './checks.js';
import { textSizeMm } from '../mm.js';
import { RANGE_MM } from '../../src/view/type.js';
import { loadFixture, FIXTURE_IDS } from '../fixtures.js';
import { initialBoard, replayView } from '../../src/state/index.js';
import { RECIPES, wb4State } from '../wb4/recipes.js';

test.beforeAll(() => {
  fs.mkdirSync(shotsDir(), { recursive: true });
});

async function shot(page, name) {
  const file = path.join(shotsDir(), `${name}.png`);
  await page.screenshot({ path: file });
  const b = fs.readFileSync(file);
  expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([1280, 400]);
}

const rect = (page, sel) => page.locator(sel).evaluate((e) => {
  const r = e.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
});

const NOTE = {
  none: 'No session chosen: press up to open the list',
  'not-owned': 'Buttons do nothing here: not a revview session',
  'no-session': 'Push-to-talk does nothing: no revview session',
};

async function allTextInRange(page) {
  const ids = await page.evaluate(() => [...document.querySelectorAll('body *')]
    .filter((e) => e.id && e.getClientRects().length > 0 && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== ''))
    .map((e) => e.id));
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) {
    const mm = (await textSizeMm(page.locator(`#${id}`))).capHeightMm;
    const [lo, hi] = id === 'state-word' ? RANGE_MM.state : RANGE_MM.text;
    expect(mm, `#${id} cap height`).toBeGreaterThanOrEqual(lo);
    expect(mm, `#${id} cap height`).toBeLessThanOrEqual(hi);
  }
}

async function common(page, id, testInfo) {
  await expectFits(page);
  await checkContrastAndFloor(page, `wb4/${id}`, testInfo);
  await allTextInRange(page);
}

// ---- the old look: a server without sessions draws nothing new ----
for (const id of FIXTURE_IDS) {
  test(`voice null (${id}): no mic, no position, no voice note, no list`, async ({ openView, page }) => {
    await openView(id);
    await expect(page.locator('#voice')).toBeHidden();
    await expect(page.locator('#voice-note')).toHaveText('');
    await expect(page.locator('#nav')).toBeHidden();
    await expect(page.locator('#others svg')).toHaveCount(0);
    expect(await page.locator('[data-mark]:visible').count()).toBe(0);
  });
}

// ---- band: mic mark and position ----
test('mic and position: the mic mark, 2/3, the repo gives way first', async ({ openView, page }, testInfo) => {
  await openView(wb4State('mic-position'));
  await expect(page.locator('#voice')).toBeVisible();
  await expect(page.locator('#voice-mark')).toHaveAttribute('data-mark', 'mic');
  await expect(page.locator('#position')).toHaveText('2/3');
  await expect(page.locator('#voice')).toHaveAttribute('data-full', 'Push-to-talk goes to this session (2 of 3)');
  await expect(page.locator('#voice-note')).toHaveText('');
  const mark = await rect(page, '#voice-mark');
  const pos = await rect(page, '#position');
  expect(mark.right).toBeLessThanOrEqual(pos.left + 0.5);
  // the mark is about the height of the detail text
  expect(mark.height).toBeGreaterThan(25);
  expect(mark.height).toBeLessThan(45);
  await common(page, 'mic-position', testInfo);
  await shot(page, 'wb4-mic-position');
});

for (const [id, voice, file] of [['not-target', 'not-owned', 'wb4-not-target'], ['no-session', 'no-session', 'wb4-no-session'], ['none', 'none', 'wb4-none']]) {
  test(`${id}: crossed-out mic and the note row (${voice})`, async ({ openView, page }, testInfo) => {
    const state = wb4State(id);
    await openView(state);
    await expect(page.locator('#voice-mark')).toHaveAttribute('data-mark', 'mic-off');
    const off = await page.locator('#voice-mark').innerHTML();
    await openView(wb4State('mic-position'));
    expect(await page.locator('#voice-mark').innerHTML()).not.toBe(off); // a different shape
    await openView(state);
    if (state.position) await expect(page.locator('#position')).toHaveText(`${state.position.index}/${state.position.count}`);
    await expect(page.locator('#voice-note')).toHaveText(NOTE[voice]);
    await expect(page.locator('#voice-note')).toHaveAttribute('data-full', NOTE[voice]);
    const note = await rect(page, '#voice-note');
    expect(note.height).toBe(40);
    expect(note.bottom).toBeLessThanOrEqual(400);
    await common(page, id, testInfo);
    await shot(page, file);
  });
}

test('voice note with an Offline permission prompt: both bottom rows show', async ({ openView, page }, testInfo) => {
  await openView({ ...wb4State('worst-band-permission'), offline: true, others: 1, position: { index: 2, count: 3 } });
  await expect(page.locator('#offline-note')).toBeVisible();
  await expect(page.locator('#voice-note')).toBeVisible();
  const a = await rect(page, '#offline-note');
  const b = await rect(page, '#voice-note');
  expect(a.bottom).toBeLessThanOrEqual(b.top + 0.5);
  await common(page, 'permission-offline-voice', testInfo);
});

test('notes views: the voice note replaces note2', async ({ openView, page }, testInfo) => {
  await openView({ ...loadFixture('unknown'), voice: 'not-owned', position: null });
  await expect(page.locator('#note2')).toHaveText(NOTE['not-owned']);
  await expect(page.locator('#voice-note')).toHaveText('');
  await common(page, 'unknown-voice', testInfo);
  await openView({ ...loadFixture('unknown'), voice: 'here' });
  await expect(page.locator('#note2')).toHaveText('Push-to-talk may still work');
  await openView({ ...loadFixture('offline'), voice: 'no-session', position: null });
  await expect(page.locator('#note2')).toHaveText('No network: voice input will not work');
  await expect(page.locator('#voice-note')).toHaveText(NOTE['no-session']);
  await common(page, 'offline-voice', testInfo);
});

test('quiet: owned session after a restart, UNKNOWN with its note', async ({ openView, page }, testInfo) => {
  await openView(wb4State('quiet'));
  await expect(page.locator('#state-word')).toHaveText('UNKNOWN');
  await expect(page.locator('#note2')).toHaveText('No events from this session yet');
  await expect(page.locator('#voice-mark')).toHaveAttribute('data-mark', 'mic');
  await common(page, 'quiet', testInfo);
  await shot(page, 'wb4-quiet');
});

test('note-start-failed: the refused start note on a normal view', async ({ openView, page }, testInfo) => {
  await openView(wb4State('note-start-failed'));
  await expect(page.locator('#voice-note')).toHaveText('New session not started: project folder missing');
  await common(page, 'note-start-failed', testInfo);
  await shot(page, 'wb4-note-start-failed');
});

test('offline-mic: no network crosses the band mic and says why', async ({ openView, page }, testInfo) => {
  await openView(wb4State('offline-mic'));
  await expect(page.locator('#voice-mark')).toHaveAttribute('data-mark', 'mic-off');
  await expect(page.locator('#voice')).toHaveAttribute('data-full', 'No network: push-to-talk will not work');
  await openView({ ...wb4State('mic-position'), buttons: 'missing' });
  await expect(page.locator('#voice-mark')).toHaveAttribute('data-mark', 'mic-off');
  await expect(page.locator('#voice')).toHaveAttribute('data-full', 'No wheel buttons found');
  await openView(wb4State('offline-mic'));
  await common(page, 'offline-mic', testInfo);
  await shot(page, 'wb4-offline-mic');
});

test('starting shows one note row only', async ({ openView, page }) => {
  await openView({ ...loadFixture('starting'), voice: 'none', position: null });
  await expect(page.locator('#note1')).toHaveText('Not ready for voice yet');
  await expect(page.locator('#note2')).toHaveText('');
});

// ---- band: a prompt in another session ----
test('elsewhere: the hint gets the permission triangle and a longer data-full', async ({ openView, page }, testInfo) => {
  await openView(wb4State('elsewhere'));
  await expect(page.locator('#others')).toHaveText('1'); // the position is shown: the number of others that need permission (QA r4-05)
  await expect(page.locator('#others svg')).toHaveCount(1);
  await expect(page.locator('#others')).toHaveAttribute('data-full', '1 other Claude session needs permission');
  const tri = await rect(page, '#others svg');
  const others = await rect(page, '#others');
  expect(tri.left).toBeGreaterThanOrEqual(others.left - 0.5);
  expect(tri.right).toBeLessThanOrEqual(others.right);
  await common(page, 'elsewhere', testInfo);
  await shot(page, 'wb4-elsewhere');
  // no prompt elsewhere: no triangle
  await openView(wb4State('mic-position'));
  await expect(page.locator('#others svg')).toHaveCount(0);
});

test('r4-05: with the position shown the hint is the number of others that need permission, else +N', async ({ openView, page }) => {
  const base = wb4State('elsewhere');
  await openView({ ...base, others: 4, elsewhere: 3 });
  await expect(page.locator('#others')).toHaveText('3');
  await expect(page.locator('#others')).toHaveAttribute('data-full', '3 other Claude sessions need permission');
  await expect(page.locator('#others svg')).toHaveCount(1);
  await expect(page.locator('#position')).toBeVisible();
  await openView({ ...base, others: 4, elsewhere: 0 }); // nobody else asks: no hint at all, the position says the count
  await expect(page.locator('#others')).toHaveText('');
  await expect(page.locator('#others svg')).toHaveCount(0);
  await openView({ ...base, others: 4, elsewhere: 3, position: null }); // no position: +N with the triangle as before
  await expect(page.locator('#others')).toHaveText('+4');
  await expect(page.locator('#others svg')).toHaveCount(1);
  await expect(page.locator('#others')).toHaveAttribute('data-full', '4 more Claude sessions, 3 need permission');
});

test('r4-05: more than 9 other sessions needing permission read "9+" with the position shown, the real number in data-full', async ({ openView, page }) => {
  const base = wb4State('elsewhere');
  await openView({ ...base, others: 11, elsewhere: 10 });
  await expect(page.locator('#others')).toHaveText('9+');
  await expect(page.locator('#others')).toHaveAttribute('data-full', '10 other Claude sessions need permission');
  await expect(page.locator('#position')).toBeVisible();
  await openView({ ...base, others: 9, elsewhere: 9 });
  await expect(page.locator('#others')).toHaveText('9');
});

// ---- the answer revview gave: said in words on the tool row (QA r4-04) ----
for (const [id, word, file] of [['denied-done', 'Denied: Bash', 'wb4-denied-done'], ['allowed', 'Allowed: Bash', 'wb4-allowed']]) {
  test(`${id}: the tool row reads "${word}"`, async ({ openView, page }, testInfo) => {
    const state = wb4State(id);
    await openView(state);
    await expect(page.locator('#tool')).toHaveText(word);
    await expect(page.locator('#tool')).toHaveAttribute('data-full', word);
    await expect(page.locator('#command')).not.toHaveText('');
    await common(page, id, testInfo);
    await shot(page, file);
  });
}

test('denied-edit-after-bash: "Denied: Edit", no old command or output (QA r5-01)', async ({ openView, page }, testInfo) => {
  await openView(wb4State('denied-edit-after-bash'));
  await expect(page.locator('#tool')).toHaveText('Denied: Edit');
  await expect(page.locator('#file')).toHaveText(/app\.py/);
  await expect(page.locator('#cmdbox')).toBeHidden();
  await expect(page.locator('#out1')).toHaveText('');
  await common(page, 'denied-edit-after-bash', testInfo);
  await shot(page, 'wb4-denied-edit-after-bash');
});

for (const [id, tool, file] of [['permission-webfetch', 'WebFetch', 'example.com/api/docs'], ['permission-mcp', 'github: create_issue', '']]) {
  test(`${id}: the prompt shows "${tool}" and its target (QA r5-05)`, async ({ openView, page }, testInfo) => {
    await openView(wb4State(id));
    await expect(page.locator('#state-word')).toHaveText('NEEDS PERMISSION');
    await expect(page.locator('#tool')).toHaveText(tool);
    await expect(page.locator('#file')).toHaveText(file);
    await expect(page.locator('#cmdbox')).toBeHidden();
    await common(page, id, testInfo);
    await shot(page, `wb4-${id}`);
  });
}

test('offline-denied: OFFLINE keeps "Denied: Edit" next to Claude: ... and the no-network note (QA r5-02)', async ({ openView, page }, testInfo) => {
  await openView(wb4State('offline-denied'));
  await expect(page.locator('#state-word')).toHaveText('OFFLINE');
  await expect(page.locator('#tool')).toHaveText('Denied: Edit');
  await expect(page.locator('#tool')).toHaveAttribute('data-answer', 'deny');
  await expect(page.locator('#note1')).toContainText('Claude');
  await expect(page.locator('#note2')).toHaveText('No network: voice input will not work');
  await common(page, 'offline-denied', testInfo);
  await shot(page, 'wb4-offline-denied');
});

test('failed-turn: WAITING FOR ME says "Turn failed: server error" and shows the error message (QA r3-05)', async ({ openView, page }, testInfo) => {
  await openView(wb4State('failed-turn'));
  await expect(page.locator('#state-word')).toHaveText('WAITING FOR ME');
  await expect(page.locator('#tool')).toHaveText('Turn failed: server error');
  await expect(page.locator('#tool')).toHaveAttribute('data-failed', '1');
  await expect(page.locator('#cmdbox')).toBeHidden();
  await expect(page.locator('#out3')).toContainText('API Error: Connection refused');
  await common(page, 'failed-turn', testInfo);
  await shot(page, 'wb4-failed-turn');
});

test('failed-turn with a long message: it wraps over the free rows and its end is readable (QA r5b-02)', async ({ openView, page }) => {
  const message = 'API Error: Connection refused - a firewall or proxy may be blocking it, check your network and try again later (ECONNREFUSED)';
  const base = wb4State('failed-turn');
  await openView({ ...base, failed: { ...base.failed, message }, output: message, outputLines: [message] });
  const out = page.locator('#out3');
  expect((await out.textContent()).replaceAll('\u2060', '').replaceAll('\u200B', '')).toBe(message);
  expect(await out.evaluate((e) => e.getBoundingClientRect().height)).toBeGreaterThan(40);
  await expectFits(page);
  // beyond the free rows (5 with the note, 6 without) it is cut with an ellipsis at the end
  const huge = `${'word '.repeat(200)}(ECONNREFUSED)`;
  await openView({ ...base, failed: { ...base.failed, message: huge }, output: huge, outputLines: [huge] });
  expect((await out.textContent()).endsWith('…')).toBe(true);
  expect(await out.evaluate((e) => e.getBoundingClientRect().bottom)).toBeLessThanOrEqual(400);
  await expectFits(page);
});

test('offline-failed: OFFLINE keeps "Turn failed: server error" on the tool row (QA r3-05)', async ({ openView, page }, testInfo) => {
  await openView(wb4State('offline-failed'));
  await expect(page.locator('#state-word')).toHaveText('OFFLINE');
  await expect(page.locator('#tool')).toHaveText('Turn failed: server error');
  await expect(page.locator('#tool')).toHaveAttribute('data-failed', '1');
  await expect(page.locator('#note2')).toHaveText('No network: voice input will not work');
  await common(page, 'offline-failed', testInfo);
  await shot(page, 'wb4-offline-failed');
});

// ---- worst band ----
for (const [id, file] of [['worst-band', 'wb4-worst-band'], ['worst-band-permission', 'wb4-worst-band-permission']]) {
  test(`${id}: hint, mic, position and NO BUTTONS tag do not overlap or leave the band`, async ({ openView, page }, testInfo) => {
    await openView(wb4State(id));
    await expect(page.locator('#buttons-tag')).toBeVisible();
    await expect(page.locator('#others')).toHaveText('1'); // the position is shown: only the number of others that need permission
    await expect(page.locator('#position')).toHaveText('12/13');
    const word = await rect(page, '#state-word');
    const others = await rect(page, '#others');
    const voice = await rect(page, '#voice');
    const tag = await rect(page, '#buttons-tag');
    expect(others.left - word.right).toBeGreaterThanOrEqual(24); // a clear gap between the state word and the hint (QA r4-10)
    expect(others.right).toBeLessThanOrEqual(voice.left + 0.5);
    expect(voice.right).toBeLessThanOrEqual(tag.left + 0.5);
    expect(tag.right).toBeLessThanOrEqual(1280);
    if (await page.locator('#where').isVisible()) {
      const w = await rect(page, '#where');
      expect(voice.right).toBeLessThanOrEqual(w.left + 0.5);
      expect(w.right).toBeLessThanOrEqual(tag.left + 0.5);
    }
    await expect(page.locator('#voice-note')).toHaveText(NOTE['not-owned']);
    await common(page, id, testInfo);
    await shot(page, file);
  });
}

// ---- list and menu ----
async function expectInverted(page, rowSel) {
  const look = (sel) => page.locator(sel).evaluate((e) => {
    const c = getComputedStyle(e);
    return { color: c.color, bg: c.backgroundColor };
  });
  const body = await look(`${rowSel} .body`);
  expect(body).toEqual({ color: 'rgb(0, 0, 0)', bg: 'rgb(255, 255, 255)' });
  const bar = await rect(page, `${rowSel} .bar`);
  expect(bar.left).toBe(0);
  expect(bar.width).toBeGreaterThanOrEqual(10);
  expect(await look(`${rowSel} .bar`)).toEqual({ color: expect.any(String), bg: 'rgb(255, 255, 255)' });
}

async function navShape(page) {
  const band = await rect(page, '#band');
  const nav = await rect(page, '#nav');
  expect(band.height).toBe(84);
  expect(nav.top).toBe(84);
  expect(nav.bottom).toBeLessThanOrEqual(400);
  await expect(page.locator('#lower')).toBeHidden();
  const rows = await page.locator('#nav .row').count();
  expect(rows).toBeLessThanOrEqual(6);
  // exactly one inverted row with the bar
  await expect(page.locator('#nav .row[data-selected="true"]')).toHaveCount(1);
  return rows;
}

test('list: band as on the home view, inverted row 2 with a bar, chips, words and the mic on the target', async ({ openView, page }, testInfo) => {
  const state = wb4State('list');
  await openView(state);
  await expect(page.locator('#state-word')).toHaveText('WAITING FOR ME');
  await expect(page.locator('#nav-title')).toHaveText('SESSIONS');
  expect(await navShape(page)).toBe(3);
  await expect(page.locator('#nav .row').nth(1)).toHaveAttribute('data-selected', 'true');
  await expectInverted(page, '#nav .row[data-selected="true"]');
  await expect(page.locator('#row0-label')).toHaveText('revview');
  await expect(page.locator('#row1-word')).toHaveText('WORKING');
  await expect(page.locator('#row0-word')).toHaveText('WAITING');
  await expect(page.locator('#row2-word')).toHaveText('DONE');
  expect(await page.locator('#nav .chip').count()).toBe(3);
  const chips = await page.locator('#nav .chip').evaluateAll((l) => l.map((e) => getComputedStyle(e).backgroundColor));
  expect(new Set(chips).size).toBe(3);
  // the mic only on the target row (the first)
  await expect(page.locator('#nav .row-mic')).toHaveCount(1);
  await expect(page.locator('#nav .row').nth(0).locator('.row-mic')).toBeVisible();
  await expect(page.locator('#more-above')).toBeHidden();
  await expect(page.locator('#more-below')).toBeHidden();
  // the band is the home band (same words and colours as without the list)
  const home = { ...state, nav: null };
  const bandOf = () => page.evaluate(() => ({ word: document.getElementById('state-word').textContent, bg: getComputedStyle(document.getElementById('band')).backgroundColor, pos: document.getElementById('position').textContent }));
  const withList = await bandOf();
  await openView(home);
  expect(await bandOf()).toEqual(withList);
  await openView(state);
  await common(page, 'list', testInfo);
  await shot(page, 'wb4-list');
});

test('list-not-owned: the not-owned row has the crossed mic, the target the plain one', async ({ openView, page }, testInfo) => {
  await openView(wb4State('list-not-owned'));
  await expect(page.locator('#nav .row-mic')).toHaveCount(2);
  await expect(page.locator('#nav .row').nth(0).locator('.row-mic')).toHaveAttribute('data-mark', 'mic');
  await expect(page.locator('#nav .row').nth(1).locator('.row-mic')).toHaveAttribute('data-mark', 'mic-off');
  await expect(page.locator('#nav .row').nth(2).locator('.row-mic')).toHaveCount(0);
  await common(page, 'list-not-owned', testInfo);
  await shot(page, 'wb4-list-not-owned');
});

test('list-long: 8 sessions, 6 rows, long labels cut in the middle, scroll marks', async ({ openView, page }, testInfo) => {
  const state = wb4State('list-long');
  await openView(state);
  expect(await navShape(page)).toBe(6);
  await expect(page.locator('#more-above')).toBeVisible();
  await expect(page.locator('#more-below')).toBeHidden();
  await expect(page.locator('#more-above')).toHaveAttribute('data-full', '2 more above');
  // the highlighted row (index 5) is in the window
  await expect(page.locator('#row5-label')).toBeVisible();
  await expectInverted(page, '#nav .row[data-selected="true"]');
  // the first row of the window is index 2; long labels keep their full text in data-full and fit their box
  const labels = await page.locator('#nav .label').evaluateAll((l) => l.map((e) => ({ t: e.textContent, full: e.dataset.full, fits: e.scrollWidth <= e.clientWidth })));
  expect(labels.every((l) => l.fits)).toBe(true);
  const cut = labels.filter((l) => l.t !== l.full);
  expect(cut.length).toBeGreaterThan(0);
  for (const l of cut) expect(l.t).toContain('…');
  await expect(page.locator('#row5-label')).toHaveText('(no repo)');
  await common(page, 'list-long', testInfo);
  await shot(page, 'wb4-list-long');
  // moving the highlight: the window follows and the marks follow
  const at = async (ups) => {
    const ev = Array.from({ length: ups }, () => ({ hook_event_name: 'RevviewNav', button: 'up', gesture: 'tap' }));
    return replayView([...RECIPES['list-long'], ...ev], initialBoard()).at(-1);
  };
  await openView(await at(5)); // row 0
  await expect(page.locator('#more-above')).toBeHidden();
  await expect(page.locator('#more-below')).toBeVisible();
  await expect(page.locator('#row0-label')).toBeVisible();
  await openView(await at(2)); // row 3: window 1..6, both marks
  await expect(page.locator('#more-above')).toBeVisible();
  await expect(page.locator('#more-below')).toBeVisible();
  await expect(page.locator('#row3-label')).toBeVisible();
  await expectInverted(page, '#nav .row[data-selected="true"]');
});

test('menu: the same widget with three items', async ({ openView, page }, testInfo) => {
  await openView(wb4State('menu'));
  await expect(page.locator('#nav-title')).toHaveText('MENU');
  expect(await navShape(page)).toBe(3);
  await expect(page.locator('#nav .label')).toHaveText(['New session', 'Projects', 'Settings']);
  await expect(page.locator('#nav .row').nth(1)).toHaveAttribute('data-selected', 'true');
  await expect(page.locator('#nav .chip')).toHaveCount(0);
  await expectInverted(page, '#nav .row[data-selected="true"]');
  await expect(page.locator('#state-word')).toHaveText('WORKING');
  await common(page, 'menu', testInfo);
  await shot(page, 'wb4-menu');
});

for (const [id, title, file] of [
  ['projects', 'PROJECTS', 'wb4-projects'],
  ['new-session', 'NEW SESSION: CHOOSE A PROJECT', 'wb4-new-session'],
  ['settings', 'SETTINGS (READ ONLY)', 'wb4-settings'],
]) {
  test(`${id}: title and rows`, async ({ openView, page }, testInfo) => {
    const state = wb4State(id);
    await openView(state);
    await expect(page.locator('#nav-title')).toHaveText(title);
    expect(await navShape(page)).toBe(state.nav.rows.length);
    await expectInverted(page, '#nav .row[data-selected="true"]');
    const labels = await page.locator('#nav .label').evaluateAll((l) => l.map((e) => ({ t: e.textContent, full: e.dataset.full, fits: e.scrollWidth <= e.clientWidth })));
    expect(labels.map((l) => l.full)).toEqual(state.nav.rows.map((r) => r.label));
    expect(labels.every((l) => l.fits)).toBe(true);
    if (id !== 'settings') expect(labels.some((l) => l.t !== l.full && l.t.includes('…'))).toBe(true);
    await common(page, id, testInfo);
    await shot(page, file);
  });
}

test('empty list and empty project lists say so', async ({ openView, page }, testInfo) => {
  const base = wb4State('list');
  await openView({ ...base, nav: { kind: 'list', row: 0, rows: [] } });
  await expect(page.locator('#nav .label')).toHaveText(['No sessions']);
  await expect(page.locator('#nav .row[data-selected="true"]')).toHaveCount(0);
  await common(page, 'list-empty', testInfo);
  for (const kind of ['new', 'projects']) {
    await openView({ ...base, nav: { kind, row: 0, rows: [] } });
    await expect(page.locator('#nav .label')).toHaveText(['No projects: add paths to the projects file']);
    await common(page, `${kind}-empty`, testInfo);
  }
});

test('a broken nav is ignored: the normal lower area stays', async ({ openView, page }) => {
  const base = wb4State('mic-position');
  for (const nav of [{ kind: 'nope', row: 0, rows: [] }, { kind: 'list', row: 0, rows: 5 }, { kind: 'list', row: 0, rows: [null] }, 'x']) {
    await openView({ ...base, nav });
    await expect(page.locator('#nav')).toBeHidden();
    await expect(page.locator('#lower')).toBeVisible();
  }
});

test('r4-07: "Too early: press again" shows in the grey note row on NEEDS PERMISSION', async ({ openView, page }, testInfo) => {
  await openView({ ...wb4State('worst-band-permission'), note: 'Too early: press again' });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'permission');
  await expect(page.locator('#voice-note')).toBeVisible();
  await expect(page.locator('#voice-note')).toHaveText('Too early: press again');
  await common(page, 'permission-too-early', testInfo);
});

test('r5-03: the no-session-chosen note says how to choose and fits one row', async ({ openView, page }) => {
  await openView(wb4State('none'));
  const note = page.locator('#voice-note');
  await expect(note).toHaveText('No session chosen: press up to open the list');
  expect((await rect(page, '#voice-note')).height).toBeLessThanOrEqual(40);
  expect(await note.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
});

// ---- QA r5-07 / r4-10: project rows lead with the folder name; a missing folder says so ----
test('project rows: base name first (bold), path dimmer, MISSING word, one row, base never cut first', async ({ openView, page }, testInfo) => {
  const base = wb4State('new-session');
  const rows = base.nav.rows.map((r, i) => (i === 1 ? { ...r, missing: true } : r));
  rows.push({ label: `/home/user/${'x'.repeat(40)}/${'long-folder-name-'.repeat(6)}end` });
  await openView({ ...base, nav: { ...base.nav, rows, row: 0 } });
  const info = await page.locator('#nav .label.proj').evaluateAll((ls) => ls.map((l) => ({
    base: l.querySelector('.base').textContent,
    baseFull: l.querySelector('.base').scrollWidth <= l.querySelector('.base').clientWidth,
    weight: getComputedStyle(l.querySelector('.base')).fontWeight,
    dirColor: getComputedStyle(l.querySelector(".dir")).color,
    baseColor: getComputedStyle(l.querySelector(".base")).color,
    fits: l.scrollWidth <= l.clientWidth,
    h: l.getBoundingClientRect().height,
  })));
  expect(info[0].base).toBe('checkout-flow');
  expect(info[1].base).toBe('revview');
  expect(info.every((i) => i.fits && i.baseFull && Number(i.weight) >= 700 && i.dirColor !== i.baseColor && i.h <= 40)).toBe(true);
  expect(info[4].base).toMatch(/^long-folder-name-.*end$/);
  await expect(page.locator('.row .word')).toHaveText(['MISSING']);
  await expect(page.locator('#row1-word')).toHaveText('MISSING');
  await common(page, 'new-session-missing', testInfo);
  await shot(page, 'wb4-new-session-missing');
});
