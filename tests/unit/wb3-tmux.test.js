// End to end with a REAL tmux server (private temp socket) and a stand-in claude: wheel gestures -> keys in the
// chosen session only, and the real PermissionRequest hook script answered by a button.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createSessionRunner } from '../../src/sessions/index.js';
import { startLiveServer } from '../../src/server/index.js';

const fake = path.resolve(import.meta.dirname, 'fixtures/sessions/fake-claude-perid.js');
const hook = path.resolve(import.meta.dirname, '../../hooks/permission-request.mjs');
const C2 = fs.readFileSync(path.resolve(import.meta.dirname, '../../fixtures/buttons/events-c2-d-d2-allow-deny-terminal.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('tmux is installed', () => {
  assert.doesNotThrow(() => execFileSync('tmux', ['-V']), 'tmux not found: install tmux');
});

async function setup(t, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-wb3-'));
  const sock = path.join(dir, 'sock');
  const runner = createSessionRunner({ socket: { path: sock }, claude: [process.execPath, fake, dir] });
  const ctx = { now: 0 };
  const server = await startLiveServer({ port: 0, devBridge: true, sessions: runner, clock: () => ctx.now, ...opts });
  t.after(async () => {
    await server.close();
    await runner.killServer().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const log = (id) => {
    try { return fs.readFileSync(path.join(dir, `${id}.log`), 'utf8').trim().split('\n').filter(Boolean); } catch { return []; }
  };
  const waitFor = async (fn, ms = 5000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(40)) if (await fn()) return true;
    return false;
  };
  const a = await runner.start({ cwd: os.tmpdir(), name: 'a' });
  const b = await runner.start({ cwd: os.tmpdir(), name: 'b' });
  assert.ok(await waitFor(() => log(a.id).length >= 1 && log(b.id).length >= 1), 'stand-ins started');
  const post = (p, body) => fetch(`${server.url}${p}`, { method: 'POST', body: JSON.stringify(body) });
  const key = (code, type) => post('/dev/key', { code, type });
  const state = async () => (await (await fetch(`${server.url}/state`)).json()).state;
  const working = async (id) => {
    for (const e of [C2[1], C2[2]]) await post('/event', { ...e, session_id: id });
  };
  return { server, runner, ctx, a, b, log, waitFor, post, key, state, working };
}

test('gestures act on the chosen session only', { timeout: 30000 }, async (t) => {
  const c = await setup(t);
  const { a, b, log, key } = c;
  assert.equal(await c.runner.choose(a.id), true);
  await c.working(a.id);
  assert.equal((await c.state()).view, 'working');

  await key('F15', 'down');
  await key('F15', 'up'); // tap
  assert.ok(await c.waitFor(() => log(a.id).includes('1b')), 'A got Escape');
  assert.ok(await c.waitFor(async () => (await c.state()).view === 'waiting'), 'board left working');
  await sleep(200);
  assert.deepEqual(log(b.id), ['started']);

  // two long-holds within 5 s: exactly one Ctrl+C
  for (let i = 0; i < 2; i++) {
    await key('F15', 'down');
    await sleep(1100);
    await key('F15', 'up');
    await sleep(150);
  }
  await sleep(300);
  assert.equal(log(a.id).filter((l) => l === '03').length, 1);
  assert.deepEqual(log(b.id), ['started']);

  // push-to-talk goes to B once chosen
  assert.equal(await c.runner.choose(b.id), true);
  const aBefore = log(a.id).length;
  await key('F13', 'down');
  await key('F13', 'up');
  assert.ok(await c.waitFor(() => log(b.id).includes('20')), 'B got Space');
  await sleep(200);
  assert.equal(log(b.id).filter((l) => l === '20').length, 1);
  assert.equal(log(a.id).length, aBefore);

  // stop the chosen session: a press sends nothing anywhere
  assert.equal(await c.runner.stop(b.id), true);
  const aLen = log(a.id).length;
  for (const code of ['F13', 'F15']) {
    await key(code, 'down');
    await key(code, 'up');
  }
  await sleep(500);
  assert.equal(log(a.id).length, aLen);
});

function runHook(port, payload) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [hook], { env: { ...process.env, REVVIEW_PORT: String(port) } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stdin.end(JSON.stringify(payload));
    p.on('close', (code) => resolve({ code, out }));
  });
}

test('the real hook script is answered by the allow button for the chosen session', { timeout: 20000 }, async (t) => {
  const c = await setup(t);
  assert.equal(await c.runner.choose(c.a.id), true);
  await c.working(c.a.id);
  const h = runHook(c.server.port, { ...C2[3], session_id: c.a.id });
  assert.ok(await c.waitFor(async () => (await c.state()).view === 'permission'), 'prompt on the bar');
  c.ctx.now += 1500;
  await c.key('F21', 'down');
  await c.key('F21', 'up');
  const r = await h;
  assert.equal(r.out, '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}\n');
  assert.equal(r.code, 0);
});

test('a prompt of a session that is not the chosen one gets no decision from the hook', { timeout: 20000 }, async (t) => {
  const c = await setup(t, { permissionWaitMs: 700 });
  assert.equal(await c.runner.choose(c.a.id), true);
  await c.working(c.b.id);
  const h = runHook(c.server.port, { ...C2[3], session_id: c.b.id });
  assert.ok(await c.waitFor(async () => (await c.state()).view === 'permission'), 'prompt on the bar');
  c.ctx.now += 1500;
  await c.key('F21', 'down');
  await c.key('F21', 'up');
  const r = await h;
  assert.equal(r.out, '');
  assert.equal(r.code, 0);
});
