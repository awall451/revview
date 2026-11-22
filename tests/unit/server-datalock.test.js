// The data lock on the server: the mount table decides, a posted RevviewDataLock is only a poke, no session
// starts while locked. Fake runner, injected mount table, no tmux.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startLiveServer, parseArgs, bootAfterUnlock } from '../../src/server/index.js';

const A = '11111111-1111-4111-8111-111111111111';
const D = '/srv/revview-data';
const MAPPER = `45 29 253:0 / ${D} rw - ext4 /dev/mapper/revview-data rw`;
const ROOT = '29 1 179:2 / / rw - ext4 /dev/mmcblk0p2 rw';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeRunner() {
  const r = {
    started: [],
    list: async () => [],
    start: async ({ cwd }) => { r.started.push(cwd); return { id: A, window: '@9', cwd }; },
  };
  return r;
}

async function boot(t, extra = {}) {
  const mount = { text: ROOT };
  const live = await startLiveServer({
    port: 0, boot: true, dataLock: { mountPoint: D, read: () => mount.text, pollMs: 3600000 }, ...extra,
  });
  t.after(() => live.close());
  return { live, mount };
}
const post = (live, body) => fetch(`${live.url}/event`, { method: 'POST', body: JSON.stringify(body) });

test('locked at start: the state shows insert-key', async (t) => {
  const { live } = await boot(t);
  assert.equal(live.state().view, 'insert-key');
  assert.equal(live.state().locked, true);
  assert.equal(live.dataLocked(), true);
});

test('a POSTed unlock while the mount table says locked is only a poke: stays locked', async (t) => {
  const { live } = await boot(t);
  const r = await post(live, { hook_event_name: 'RevviewDataLock', locked: false });
  assert.equal(r.status, 204);
  assert.equal(live.state().view, 'insert-key');
  assert.equal(live.dataLocked(), true);
});

test('after the table says mounted, a poke unlocks at once; whenUnlocked resolves only then', async (t) => {
  const { live, mount } = await boot(t);
  let done = false;
  live.whenUnlocked().then(() => { done = true; });
  await sleep(10);
  assert.equal(done, false);
  mount.text = `${ROOT}\n${MAPPER}`;
  assert.equal(live.dataLocked(), true); // not re-read until the poke or the poll
  const r = await post(live, { hook_event_name: 'RevviewDataLock', locked: true });
  assert.equal(r.status, 204);
  assert.equal(live.state().locked, false);
  assert.notEqual(live.state().view, 'insert-key');
  assert.equal(live.dataLocked(), false);
  await live.whenUnlocked();
  assert.equal(done, true);
});

test('bootAfterUnlock starts the key-on session only after the unlock', async (t) => {
  const runner = fakeRunner();
  const { live, mount } = await boot(t, { sessions: runner });
  const p = bootAfterUnlock({ live, runner, dirs: ['/tmp'], log: () => {} });
  await sleep(30);
  assert.deepEqual(runner.started, []);
  mount.text = MAPPER;
  await post(live, { hook_event_name: 'RevviewDataLock' });
  assert.equal(await p, A);
  assert.deepEqual(runner.started, ['/tmp']);
});

test('New session by the wheel is refused while locked and works after the unlock; list keeps working', async (t) => {
  const runner = fakeRunner();
  const mount = { text: ROOT };
  const live = await startLiveServer({
    port: 0, devBridge: true, sessions: runner, projects: ['/p/one'],
    dataLock: { mountPoint: D, read: () => mount.text, pollMs: 3600000 },
  });
  t.after(() => live.close());
  const key = async (code) => {
    const n = live.gestures().length;
    await fetch(`${live.url}/dev/key`, { method: 'POST', body: JSON.stringify({ code, type: 'down' }) });
    await fetch(`${live.url}/dev/key`, { method: 'POST', body: JSON.stringify({ code, type: 'up' }) });
    for (let i = 0; i < 100 && live.gestures().length === n; i++) await sleep(10);
    await sleep(60);
  };
  await live.refreshOwned(); // list works while locked
  await key('F23'); // menu
  await key('F21'); // New session
  assert.equal(live.state().nav?.kind, 'new');
  await key('F21'); // the project
  assert.deepEqual(runner.started, [], 'no session while locked');
  mount.text = MAPPER;
  await fetch(`${live.url}/event`, { method: 'POST', body: JSON.stringify({ hook_event_name: 'RevviewDataLock' }) });
  assert.equal(live.dataLocked(), false);
  await key('F23');
  await key('F21');
  await key('F21');
  assert.deepEqual(runner.started, ['/p/one']);
});

test('without dataLock a POSTed RevviewDataLock is applied as before; unlocked at once', async (t) => {
  const live = await startLiveServer({ port: 0 });
  t.after(() => live.close());
  assert.equal(live.dataLocked(), false);
  await live.whenUnlocked();
  const r = await post(live, { hook_event_name: 'RevviewDataLock', locked: true });
  assert.equal(r.status, 204);
  assert.equal(live.state().locked, true);
  await post(live, { hook_event_name: 'RevviewDataLock', locked: false });
  assert.equal(live.state().locked, false);
});

test('parseArgs: --data-lock, --data-lock DIR, env, bad path', () => {
  const env = process.env.REVVIEW_DATA_MOUNT;
  delete process.env.REVVIEW_DATA_MOUNT;
  try {
    assert.equal(parseArgs([]).dataLock, undefined);
    assert.equal(parseArgs(['--data-lock']).dataLock, '/srv/revview-data');
    assert.equal(parseArgs(['--data-lock', '--boot']).dataLock, '/srv/revview-data');
    assert.equal(parseArgs(['--data-lock', '/x/y']).dataLock, '/x/y');
    process.env.REVVIEW_DATA_MOUNT = '/mnt/data';
    assert.equal(parseArgs([]).dataLock, '/mnt/data');
    assert.equal(parseArgs(['--data-lock', '/x']).dataLock, '/x');
    process.env.REVVIEW_DATA_MOUNT = 'rel';
    assert.throws(() => parseArgs([]), /data-lock/);
    delete process.env.REVVIEW_DATA_MOUNT;
    assert.throws(() => parseArgs(['--data-lock', 'rel']), /unexpected argument rel/); // changed: a non-absolute word is no longer taken as the dir
    assert.throws(() => parseArgs(['--data-lock', '/a b']), /data-lock/);
    assert.throws(() => parseArgs(['--data-lock', '/a;b']), /data-lock/);
  } finally {
    if (env === undefined) delete process.env.REVVIEW_DATA_MOUNT; else process.env.REVVIEW_DATA_MOUNT = env;
  }
});

test('parseArgs: --data-lock leaves a port alone; --start with a data lock needs --boot', () => {
  const env = process.env.REVVIEW_DATA_MOUNT;
  delete process.env.REVVIEW_DATA_MOUNT;
  try {
    const a = parseArgs(['--data-lock', '9000']);
    assert.equal(a.dataLock, '/srv/revview-data');
    assert.equal(a.port, 9000);
    assert.throws(() => parseArgs(['--data-lock', '--start', '/tmp']), /--start with a data lock needs --boot/);
    assert.throws(() => parseArgs(['--data-lock', '/x', '--start', '/tmp']), /needs --boot/);
    process.env.REVVIEW_DATA_MOUNT = '/mnt/data';
    assert.throws(() => parseArgs(['--start', '/tmp']), /needs --boot/);
    assert.deepEqual(parseArgs(['--boot', '--start', '/tmp']).start, ['/tmp']);
    delete process.env.REVVIEW_DATA_MOUNT;
    assert.deepEqual(parseArgs(['--start', '/tmp']).start, ['/tmp']);
  } finally {
    if (env === undefined) delete process.env.REVVIEW_DATA_MOUNT; else process.env.REVVIEW_DATA_MOUNT = env;
  }
});
