import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The real CLI (src/server/index.js) with a real tmux on a private socket and a hookless stand-in `claude`:
// --start without --boot (the --live emulator) marks the session STARTING like menu -> New session; --boot (the Pi's
// key-on start) keeps its own path (BootBegin/BootDone + the key-on mark). The Pi's pure logic is pinned by
// server-boot / server-boot-done / server-launch (bootSessions); this pins the two CLI paths side by side.
const SERVER = fileURLToPath(new URL('../../src/server/index.js', import.meta.url));
const until = async (fn, what, ms = 15000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

async function runCli(extra) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cli-start-')));
  const shim = path.join(dir, 'shim');
  const proj = path.join(dir, 'proj');
  fs.mkdirSync(shim);
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(shim, 'claude'), '#!/bin/bash\nwhile :; do sleep 0.1; done\n', { mode: 0o755 });
  const sock = path.join(dir, 't.sock');
  const settings = path.join(dir, 's.json');
  fs.writeFileSync(settings, '{}');
  const child = spawn(process.execPath, [SERVER, '0', '--sessions', '--tmux-socket', sock, '--claude-settings', settings, '--start', proj, ...extra], {
    env: { ...process.env, HOME: dir, PATH: `${shim}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  try {
    const url = (await until(() => /^view:\s+(\S+?)\/?$/m.exec(out), 'view line'))[1];
    const state = async () => (await (await fetch(`${url}/state`)).json()).state;
    await until(async () => (await state()).position?.count === 1, 'the session on the bar');
    return { out, state: await state() };
  } finally {
    child.kill('SIGTERM');
    spawnSync('tmux', ['-f', '/dev/null', '-S', sock, 'kill-server']);
    await until(() => child.exitCode !== null || child.signalCode !== null, 'server exit').catch(() => child.kill('SIGKILL'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('--start without --boot: the first session shows STARTING (the --live emulator)', async () => {
  const r = await runCli([]);
  assert.equal(r.state.view, 'starting');
  assert.doesNotMatch(r.out, /boot: STARTING until/);
});

test('--boot --start (the Pi key-on path): still STARTING, with the boot line, as before', async () => {
  const r = await runCli(['--boot']);
  assert.equal(r.state.view, 'starting');
  assert.match(r.out, /boot: STARTING until the first session is on the board/);
});
