// Round 6 on the server: missing project folders are marked, and re-checked on the owned poll (QA r5-07).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startLiveServer } from '../../src/server/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const runner = { list: async () => [], target: async () => null, send: async () => ({ sent: false }), start: async () => { throw new Error('no'); } };

test('r5-07: the server marks missing folders at start and re-checks on the owned poll', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revview-proj-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ok = path.join(dir, 'ok');
  const gone = path.join(dir, 'gone');
  const file = path.join(dir, 'afile');
  fs.mkdirSync(ok);
  fs.writeFileSync(file, 'x');
  const s = await startLiveServer({ port: 0, devBridge: true, sessions: runner, projects: [ok, gone, file] });
  t.after(() => s.close());
  const key = async (code) => {
    const n = s.gestures().length;
    await fetch(`${s.url}/dev/key`, { method: 'POST', body: JSON.stringify({ code, type: 'down' }) });
    await fetch(`${s.url}/dev/key`, { method: 'POST', body: JSON.stringify({ code, type: 'up' }) });
    for (let i = 0; i < 100 && s.gestures().length === n; i++) await sleep(10);
    await sleep(60);
  };
  await key('F23'); // menu
  await key('F21'); // New session
  const marks = () => s.state().nav.rows.map((r) => r.missing === true);
  assert.deepEqual(marks(), [false, true, true]);
  fs.mkdirSync(gone);
  await s.refreshOwned();
  assert.deepEqual(marks(), [false, false, true]);
  assert.equal(s.state().nav.kind, 'new', 'the open view stays open');
  fs.rmSync(gone, { recursive: true });
  await s.refreshOwned();
  assert.deepEqual(marks(), [false, true, true]);
});
