// Self-check of tests/long/drive.js: whatever way the drive ends (a signal, a thrown error, even its own SIGKILL), no server,
// no Chromium and no listening port is left behind. Run on request (it starts a real Chromium; tools/check does not run it):
//   node --test tests/long/cleanup.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DRIVE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'drive.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const read = (pid, f) => { try { return fs.readFileSync(`/proc/${pid}/${f}`, 'utf8'); } catch { return ''; } };
const allPids = () => fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)).map(Number);
const ppidOf = (pid) => Number(read(pid, 'stat').replace(/^.*\) \S+ /, '').split(' ')[0]) || 0;
const alive = (pid) => { const st = read(pid, 'stat').replace(/^.*\) /, '')[0]; return st !== undefined && st !== '' && st !== 'Z'; };

function descendants(root) {
  const kids = new Map();
  for (const p of allPids()) { const pp = ppidOf(p); if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(p); }
  const out = [];
  const walk = (p) => { for (const k of kids.get(p) ?? []) { out.push(k); walk(k); } };
  walk(root);
  return out;
}
// the servers of this drive: their environment names this drive's skew file
const serversOf = (out) => allPids().filter((p) => read(p, 'environ').split('\0').includes(`LONG_DRIVE_SKEW_FILE=${path.join(out, 'skew-ms')}`));
const portOf = (pid) => Number(read(pid, 'cmdline').split('\0').filter(Boolean).at(-1));
const listening = (port) => new Promise((resolve) => {
  const s = net.connect(port, '127.0.0.1');
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
});
async function until(f, ms, what) {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = await f(); if (v) return v; await sleep(50); }
  throw new Error(`timed out: ${what}`);
}

async function run(t, { env = {}, end }) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-cleanup-'));
  const child = spawn(process.execPath, [DRIVE, '--smoke', '--out', out], { env: { ...process.env, ...env }, stdio: 'ignore' });
  const exited = new Promise((r) => child.once('exit', (code, signal) => r({ code, signal })));
  t.after(() => {
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ }
    for (const p of serversOf(out)) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
    fs.rmSync(out, { recursive: true, force: true });
  });
  const server = await until(() => serversOf(out)[0], 30000, 'the server started');
  const port = portOf(server);
  await until(() => listening(port), 10000, 'the server listens');
  const before = [...descendants(child.pid), ...serversOf(out)];
  assert.ok(before.length >= 2, `the drive has children (${before})`);
  await end(child);
  const result = await exited;
  await until(() => before.every((p) => !alive(p)), 8000, `children gone (${before.filter(alive)} left)`);
  assert.deepEqual(serversOf(out).filter(alive), []);
  assert.equal(await listening(port), false, 'the port is closed');
  return result;
}

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  test(`${sig} in the middle of a drive leaves no server, Chromium or port`, async (t) => {
    const r = await run(t, { end: async (c) => { await sleep(500); c.kill(sig); } });
    assert.ok(r.code !== 0 || r.signal, 'the drive did not end as a success');
  });
}

test('the drive killed with SIGKILL: the server ends with it (stdin pipe), Chromium too', async (t) => {
  await run(t, { end: async (c) => { c.kill('SIGKILL'); } });
});

test('a thrown error after the server started leaves nothing behind', async (t) => {
  const r = await run(t, { env: { LONG_DRIVE_FAULT: 'throw' }, end: async () => {} });
  assert.equal(r.code, 2);
});
