// End to end: recorded hook events -> live server (POST /event) -> SSE -> the page.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './harness.js';
import { startLiveServer } from '../../src/server/index.js';

const sessionsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/sessions');

// The spec: the state word shown for each view.
const LABELS = {
  working: 'WORKING', waiting: 'WAITING FOR ME', permission: 'NEEDS PERMISSION', done: 'DONE',
  starting: 'STARTING', offline: 'OFFLINE', 'insert-key': 'INSERT KEY',
  unknown: 'UNKNOWN', ended: 'CLAUDE EXITED', 'no-link': 'NO LINK',
};
const MINUS = '−';

const sessions = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl')).sort().map((f) => {
  const id = f.replace(/\.jsonl$/, '');
  const lines = fs.readFileSync(path.join(sessionsDir, f), 'utf8').split('\n').filter((l) => l.trim());
  const expected = JSON.parse(fs.readFileSync(path.join(sessionsDir, `${id}.expected.json`), 'utf8'));
  return { id, lines, expected };
});

async function post(server, body) {
  return fetch(`${server.url}/event`, { method: 'POST', body });
}

async function postOk(server, body) {
  const r = await post(server, body);
  expect(r.status).toBe(204);
}

// Listen again on a port that was just closed; EADDRINUSE is retried (a retry, not an assertion).
async function restartOn(port) {
  let last;
  for (let i = 0; i < 50; i++) {
    try {
      return await startLiveServer({ port });
    } catch (e) {
      last = e;
      if (e.code !== 'EADDRINUSE') throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw last;
}

const html = (page) => page.locator('html');

async function expectSeq(page, n, timeout = 10000) {
  await expect(html(page)).toHaveAttribute('data-seq', String(n), { timeout });
}

// What the page VISIBLY shows for a reducer state.
async function expectShows(page, state) {
  await expect(page.locator('body')).toHaveAttribute('data-view', state.view);
  await expect(html(page)).toHaveAttribute('data-rendered', state.view);
  await expect(page.locator('#state-word')).toHaveText(LABELS[state.view]);
  if (!['working', 'waiting', 'permission', 'done'].includes(state.view)) return;

  const bash = state.tool === 'Bash';
  await expect(page.locator('#tool')).toHaveText(bash ? '' : state.tool || '');
  await expect(page.locator('#file')).toHaveText(bash ? '' : state.file || '');
  await expect(page.locator('#command')).toHaveText(state.command || '');
  await expect(page.locator('#output')).toHaveText(state.output || '');

  const where = [state.repo, state.branch].filter(Boolean).join(' · ');
  if (where) await expect(page.locator('#where')).toHaveText(where);
  else await expect(page.locator('#where')).toBeHidden();

  const { added, removed } = state.diff || { added: 0, removed: 0 };
  if (added > 0 || removed > 0) {
    await expect(page.locator('#diff')).toBeVisible();
    await expect(page.locator('#diff-added')).toHaveText(`+${added}`);
    await expect(page.locator('#diff-removed')).toHaveText(`${MINUS}${removed}`);
  } else {
    await expect(page.locator('#diff')).toBeHidden();
  }
}

async function withServer(fn) {
  const server = await startLiveServer({ port: 0 });
  try {
    await fn(server);
  } finally {
    await server.close();
  }
}

test.describe('live', () => {
  test.setTimeout(60000);

  test('discovers recorded sessions', () => {
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) expect(s.lines.length).toBe(s.expected.length);
  });

  for (const s of sessions) {
    test(`replay ${s.id}`, async ({ page }) => {
      test.setTimeout(120000);
      await withServer(async (server) => {
        await page.goto(`${server.url}/`);
        await expect(html(page)).toHaveAttribute('data-link', 'up');
        await expectSeq(page, 0);
        for (let k = 0; k < s.lines.length; k++) {
          await postOk(server, s.lines[k]);
          await expectSeq(page, k + 1);
          await expectShows(page, s.expected[k].state);
        }
      });
    });
  }

  test('shows NO LINK (never "starting") until the first state arrives', async ({ page }) => {
    await withServer(async (server) => {
      let release;
      const gate = new Promise((r) => { release = r; });
      await page.route('**/events', async (route) => {
        await gate;
        await route.continue();
      });
      await page.goto(`${server.url}/`);
      await expect(html(page)).toHaveAttribute('data-link', 'connecting');
      await expect(page.locator('body')).toHaveAttribute('data-view', 'no-link');
      await expect(page.locator('#state-word')).toHaveText('NO LINK');
      await expect(html(page)).not.toHaveAttribute('data-seq', /.*/);
      release();
      await expect(html(page)).toHaveAttribute('data-link', 'up');
      await expectSeq(page, 0);
    });
  });

  test('a late joiner sees the current state at once', async ({ page }) => {
    const s = sessions.find((x) => x.id === 'working-turn') || sessions[0];
    const n = Math.min(4, s.lines.length);
    await withServer(async (server) => {
      for (let k = 0; k < n; k++) await postOk(server, s.lines[k]);
      await page.goto(`${server.url}/`);
      await expectSeq(page, n);
      await expectShows(page, s.expected[n - 1].state);
    });
  });

  test('reconnects by itself after the server restarts', async ({ page }) => {
    test.setTimeout(90000);
    const s = sessions.find((x) => x.id === 'working-turn') || sessions[0];
    let server = await startLiveServer({ port: 0 });
    const port = server.port;
    try {
      await page.goto(`${server.url}/`);
      await expectSeq(page, 0);
      let k = 0;
      while (s.expected[k].state.view !== 'working') {
        await postOk(server, s.lines[k]);
        k++;
      }
      await postOk(server, s.lines[k]);
      await expectSeq(page, k + 1);
      await expectShows(page, s.expected[k].state);

      await server.close();
      await expect(html(page)).toHaveAttribute('data-link', 'down', { timeout: 10000 });
      // changed on purpose: a dead link now shows the no-link look, not "starting" (QA issue 02)
      await expect(page.locator('body')).toHaveAttribute('data-view', 'no-link');
      await expect(page.locator('#state-word')).toHaveText('NO LINK');
      await expect(html(page)).not.toHaveAttribute('data-seq', /.*/);

      server = await restartOn(port);
      await expect(html(page)).toHaveAttribute('data-link', 'up', { timeout: 15000 });
      await expectSeq(page, 0, 15000);
      // changed on purpose: a restarted server knows nothing, so it shows "unknown", not "starting" (QA issue 01)
      await expect(page.locator('body')).toHaveAttribute('data-view', 'unknown');
      await expect(page.locator('#state-word')).toHaveText('UNKNOWN');

      await postOk(server, s.lines[k]);
      await expectSeq(page, 1);
      await expectShows(page, s.expected[k].state);
    } finally {
      await server.close();
    }
  });

  test('while the server is gone the page shows "no link" (not starting) and recovers', async ({ page }) => {
    test.setTimeout(60000);
    const s = sessions.find((x) => x.id === 'working-turn') || sessions[0];
    let server = await startLiveServer({ port: 0 });
    const port = server.port;
    try {
      await page.goto(`${server.url}/`);
      await expectSeq(page, 0);
      await server.close();
      await expect(page.locator('body')).toHaveAttribute('data-view', 'no-link', { timeout: 10000 });
      await expect(page.locator('#state-word')).toHaveText('NO LINK');
      await page.waitForTimeout(2500);
      await expect(page.locator('body')).toHaveAttribute('data-view', 'no-link');
      await expect(html(page)).not.toHaveAttribute('data-seq', /.*/);
      server = await restartOn(port);
      await expect(html(page)).toHaveAttribute('data-link', 'up', { timeout: 15000 });
      await expectSeq(page, 0, 15000);
      for (let k = 0; k < s.lines.length; k++) {
        await postOk(server, s.lines[k]);
        await expectSeq(page, k + 1);
        if (s.expected[k].state.view === 'working') {
          await expectShows(page, s.expected[k].state);
          break;
        }
      }
    } finally {
      await server.close();
    }
  });

  test('a malformed POST does not break the page', async ({ page }) => {
    const s = sessions[0];
    await withServer(async (server) => {
      await page.goto(`${server.url}/`);
      await expectSeq(page, 0);
      for (const bad of ['{not json', '', '[1,2]', '"x"']) {
        expect((await post(server, bad)).status).toBe(400);
      }
      await expect(html(page)).toHaveAttribute('data-link', 'up');
      await expectSeq(page, 0);
      await postOk(server, s.lines[0]);
      await expectSeq(page, 1);
      await expectShows(page, s.expected[0].state);
      await expect(html(page)).toHaveAttribute('data-link', 'up');
    });
  });

  test('QA 01: after a restart the page does not claim a state it cannot know', async ({ page }) => {
    test.setTimeout(90000);
    const s = sessions.find((x) => x.id === 'idle-prompt') || sessions[0];
    let server = await startLiveServer({ port: 0 });
    const port = server.port;
    try {
      await page.goto(`${server.url}/`);
      let k = 0;
      do {
        await postOk(server, s.lines[k]);
        k++;
      } while (s.expected[k - 1].state.view !== 'waiting');
      await expectSeq(page, k);
      await expect(page.locator('#state-word')).toHaveText('WAITING FOR ME');

      await server.close();
      await expect(page.locator('#state-word')).toHaveText('NO LINK', { timeout: 10000 });
      server = await restartOn(port);
      await expect(html(page)).toHaveAttribute('data-link', 'up', { timeout: 15000 });
      await expectSeq(page, 0, 15000);
      await expect(page.locator('#state-word')).toHaveText('UNKNOWN');
      await expect(page.locator('#state-word')).not.toHaveText('STARTING');

      const next = s.lines.findIndex((l, i) => i > 0 && JSON.parse(l).hook_event_name === 'UserPromptSubmit');
      await postOk(server, s.lines[next]);
      await expectSeq(page, 1);
      await expect(page.locator('#state-word')).toHaveText('WORKING');
    } finally {
      await server.close();
    }
  });

  test('QA 03: a permission stays shown when another session goes idle; +1 in the band', async ({ page }) => {
    const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
    const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
    const ev = (id, name, extra = {}) => JSON.stringify({ session_id: id, hook_event_name: name, ...extra });
    await withServer(async (server) => {
      await page.goto(`${server.url}/`);
      await expectSeq(page, 0);
      await postOk(server, ev(A, 'UserPromptSubmit', { prompt: 'go' }));
      await postOk(server, ev(A, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }));
      await expectSeq(page, 2);
      await expect(page.locator('#state-word')).toHaveText('NEEDS PERMISSION');
      await expect(page.locator('#others')).toHaveText('');
      await postOk(server, ev(B, 'UserPromptSubmit', { prompt: 'go' }));
      await postOk(server, ev(B, 'Notification', { notification_type: 'idle_prompt' }));
      await expectSeq(page, 4);
      await expect(page.locator('#state-word')).toHaveText('NEEDS PERMISSION');
      await expect(page.locator('#command')).toHaveText('rm -rf build');
      await expect(page.locator('#others')).toHaveText('+1');
    });
  });

  test('QA 04: a recording that reaches SessionEnd shows CLAUDE EXITED', async ({ page }) => {
    const s = sessions.find((x) => x.id === 'working-turn') || sessions[0];
    const last = s.lines.length - 1;
    expect(JSON.parse(s.lines[last]).hook_event_name).toBe('SessionEnd');
    await withServer(async (server) => {
      await page.goto(`${server.url}/`);
      for (const l of s.lines) await postOk(server, l);
      await expectSeq(page, s.lines.length);
      await expect(page.locator('#state-word')).toHaveText('CLAUDE EXITED');
      await expect(page.locator('body')).toHaveAttribute('data-view', 'ended');
    });
  });

  test('QA 11: an oversize event marks the diff as incomplete (the page shows the lower bound)', async ({ page }) => {
    const s = sessions.find((x) => x.id === 'working-turn') || sessions[0];
    await withServer(async (server) => {
      await page.goto(`${server.url}/`);
      let k = 0;
      while (s.expected[k].state.view !== 'working') {
        await postOk(server, s.lines[k]);
        k++;
      }
      await postOk(server, s.lines[k]);
      await expectSeq(page, k + 1);
      await expect(page.locator('#diff-approx')).toHaveText('');
      const id = JSON.parse(s.lines[0]).session_id;
      const big = `{"session_id":"${id}","hook_event_name":"PostToolUse","tool_name":"Edit","tool_response":{"x":"${'a'.repeat(1100000)}"}}`;
      expect((await post(server, big)).status).toBe(413);
      await expectSeq(page, k + 2);
      // nothing was counted before the lost event, so the lower bound is zero: shown as unknown (QA 11)
      await expect(page.locator('#diff-approx')).toHaveText('');
      await expect(page.locator('#diff')).toHaveAttribute('data-full', 'diff unknown (an event was too large to read)');
    });
  });
});
