// QA r6-01 / r6-04: the boot STARTING always ends; a bad REVVIEW_NETMON_HOST does not kill the bar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { startLiveServer, bootSessions, bootAfterUnlock, netmonTarget } from '../../src/server/index.js';

const A = '11111111-1111-4111-8111-111111111111';
const D = '/srv/revview-data';
const MAPPER = `45 29 253:0 / ${D} rw - ext4 /dev/mapper/revview-data rw`;
const ROOT = '29 1 179:2 / / rw - ext4 /dev/mmcblk0p2 rw';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runner({ windows = [], startError = null } = {}) {
  const r = {
    started: [],
    windows,
    list: async () => r.windows.map((w) => ({ ...w })),
    start: async ({ cwd }) => {
      if (startError) throw startError;
      r.started.push(cwd);
      r.windows.push({ id: A, window: '@1', cwd, name: 'w' });
      return { id: A, window: '@1', cwd };
    },
  };
  return r;
}
async function bootLive(t, r, extra = {}) {
  const live = await startLiveServer({ port: 0, boot: true, sessions: r, ...extra });
  t.after(() => live.close());
  return live;
}
const NOTE = {
  none: 'No session yet: open the menu for New session',
  rel: 'Key-on session not started: start folder must be an absolute path',
  missing: 'Key-on session not started: start folder missing',
  other: 'Key-on session not started: see the server log',
};
const post = (live, body) => fetch(`${live.url}/event`, { method: 'POST', body: JSON.stringify(body) });
const press = async (live, code) => {
  const n = live.gestures().length;
  await fetch(`${live.url}/dev/key`, { method: 'POST', body: JSON.stringify({ code, type: 'down' }) });
  await fetch(`${live.url}/dev/key`, { method: 'POST', body: JSON.stringify({ code, type: 'up' }) });
  for (let i = 0; i < 100 && live.gestures().length === n; i++) await sleep(10);
  await sleep(60);
};

test('BootDone is internal: a POST is refused with 403', async (t) => {
  const live = await bootLive(t, runner());
  const r = await post(live, { hook_event_name: 'RevviewBootDone' });
  assert.equal(r.status, 403);
  assert.equal(live.state().view, 'starting');
});

test('nothing to start and no windows: the bar leaves STARTING with the New session note', async (t) => {
  const r = runner();
  const live = await bootLive(t, r);
  assert.equal(await bootSessions({ runner: r, live, dirs: [], log: () => {} }), null);
  assert.equal(live.state().view, 'unknown');
  assert.equal(live.state().note, NOTE.none);
});

test('a relative start folder is refused before trying, logged, noted', async (t) => {
  const r = runner();
  const live = await bootLive(t, r);
  const logs = [];
  assert.equal(await bootSessions({ runner: r, live, dirs: ['rel-a'], log: (m) => logs.push(m) }), null);
  assert.deepEqual(r.started, []);
  assert.deepEqual(logs, ['boot sessions: REVVIEW_START must be an absolute folder, got rel-a']);
  assert.equal(live.state().view, 'unknown');
  assert.equal(live.state().note, NOTE.rel);
});

test('start failures: missing folder and any other failure give their notes and leave STARTING', async (t) => {
  for (const [err, note] of [
    [new Error('cwd is not an existing directory: /nope'), NOTE.missing],
    [new Error('tmux gone'), NOTE.other],
  ]) {
    const r = runner({ startError: err });
    const live = await bootLive(t, r);
    const logs = [];
    assert.equal(await bootSessions({ runner: r, live, dirs: ['/nope'], log: (m) => logs.push(m) }), null);
    assert.match(logs[0], new RegExp(err.message));
    assert.equal(live.state().view, 'unknown');
    assert.equal(live.state().note, note);
  }
});

test('list failure ends STARTING with the log note', async (t) => {
  const r = { list: async () => { throw new Error('nope'); }, start: async () => ({ id: A }) };
  const live = await bootLive(t, r);
  await bootSessions({ runner: r, live, dirs: ['/tmp'], log: () => {} });
  assert.equal(live.state().view, 'unknown');
  assert.equal(live.state().note, NOTE.other);
});

test('start ok: selected, STARTING over; one window: selected, no "No session chosen" flash', async (t) => {
  const r = runner();
  const live = await bootLive(t, r);
  assert.equal(await bootSessions({ runner: r, live, dirs: ['/tmp'], log: () => {} }), A);
  assert.equal(live.selected(), A);
  assert.notEqual(live.state().view, 'starting');
  assert.equal(live.state().note, 'No events from this session yet');
  const r2 = runner({ windows: [{ id: A, window: '@1', cwd: '/tmp', name: 'w' }] });
  const live2 = await bootLive(t, r2);
  assert.equal(await bootSessions({ runner: r2, live: live2, dirs: [], log: () => {} }), A);
  assert.equal(live2.state().view, 'unknown');
  assert.equal(live2.state().voice, 'here');
});

test('several windows: none selected, STARTING over', async (t) => {
  const r = runner({ windows: [{ id: A, window: '@1' }, { id: '22222222-2222-4222-8222-222222222222', window: '@2' }] });
  const live = await bootLive(t, r);
  assert.equal(await bootSessions({ runner: r, live, dirs: [], log: () => {} }), null);
  assert.notEqual(live.state().view, 'starting');
});

test('time bound: a slow start ends STARTING with the slow note, a later success still selects', async (t) => {
  let release;
  const gate = new Promise((res) => { release = res; });
  const r = runner();
  const realStart = r.start;
  r.start = async (o) => { await gate; return realStart(o); };
  const live = await bootLive(t, r);
  const fired = [];
  const timers = { setTimeout: (fn, ms) => { fired.push({ fn, ms }); return fired.length; }, clearTimeout: () => {} };
  const p = bootSessions({ runner: r, live, dirs: ['/tmp'], log: () => {}, timers, bootLimitMs: 1234 });
  await sleep(20);
  assert.equal(fired[0].ms, 1234);
  fired[0].fn();
  assert.equal(live.state().view, 'unknown');
  assert.equal(live.state().note, 'Key-on session is slow to start: see the server log');
  release();
  assert.equal(await p, A);
  assert.equal(live.selected(), A);
});

test('time bound: the timer is cleared when the boot finishes in time, and the default is 60000', async (t) => {
  const r = runner();
  const live = await bootLive(t, r);
  const calls = [];
  const timers = { setTimeout: (fn, ms) => { calls.push(['set', ms]); return 7; }, clearTimeout: (h) => calls.push(['clear', h]) };
  await bootSessions({ runner: r, live, dirs: ['/tmp'], log: () => {}, timers });
  assert.deepEqual(calls, [['set', 60000], ['clear', 7]]);
});

test('data lock: locked -> presses not dropped, menu opens; unlock + failing start -> leaves STARTING with the note', async (t) => {
  const r = runner({ startError: new Error('tmux gone') });
  const mount = { text: ROOT };
  const live = await startLiveServer({
    port: 0, boot: true, devBridge: true, sessions: r, projects: ['/p/one'],
    dataLock: { mountPoint: D, read: () => mount.text, pollMs: 3600000 },
  });
  t.after(() => live.close());
  const p = bootAfterUnlock({ live, runner: r, dirs: ['/tmp'], log: () => {} });
  assert.equal(live.state().view, 'insert-key');
  await press(live, 'F23');
  assert.equal(live.gestures()[0].dropped, false);
  assert.equal(live.state().nav?.kind, 'menu');
  mount.text = MAPPER;
  await post(live, { hook_event_name: 'RevviewDataLock' });
  assert.equal(await p, null);
  assert.equal(live.state().view, 'unknown');
  assert.equal(live.state().note, NOTE.other);
});

test('data lock: unlock + successful start -> selected', async (t) => {
  const r = runner();
  const mount = { text: ROOT };
  const live = await bootLive(t, r, { dataLock: { mountPoint: D, read: () => mount.text, pollMs: 3600000 } });
  const p = bootAfterUnlock({ live, runner: r, dirs: ['/tmp'], log: () => {} });
  mount.text = MAPPER;
  await post(live, { hook_event_name: 'RevviewDataLock' });
  assert.equal(await p, A);
  assert.equal(live.selected(), A);
});

test('presses are dropped while the boot STARTING lasts, not after BootDone', async (t) => {
  const live = await startLiveServer({ port: 0, boot: true, devBridge: true, sessions: runner() });
  t.after(() => live.close());
  await press(live, 'F23');
  assert.equal(live.gestures().at(-1).dropped, true);
  live.bootDone();
  await press(live, 'F23');
  assert.equal(live.gestures().at(-1).dropped, false);
  assert.equal(live.state().nav?.kind, 'menu');
});

test('r6-04: netmonTarget falls back (and logs) on bad values, accepts good ones', () => {
  const FALLBACK = { host: 'api.anthropic.com', port: 443 };
  for (const v of ['host:99999', 'a b', ':443', '[::1]:443', 'example.com:', 'host:0']) {
    const logs = [];
    assert.deepEqual(netmonTarget(v, (m) => logs.push(m)), FALLBACK, v);
    assert.deepEqual(logs, [`REVVIEW_NETMON_HOST must be host or host:port, got ${v}; using api.anthropic.com:443`]);
  }
  const quiet = (m) => { throw new Error(`unexpected log ${m}`); };
  assert.deepEqual(netmonTarget(undefined, quiet), FALLBACK);
  assert.deepEqual(netmonTarget('', quiet), FALLBACK);
  assert.deepEqual(netmonTarget('example.com', quiet), { host: 'example.com', port: 443 });
  assert.deepEqual(netmonTarget('10.0.0.1:8080', quiet), { host: '10.0.0.1', port: 8080 });
});

test('r6-04: the server with --netmon and a bad REVVIEW_NETMON_HOST starts anyway', async () => {
  const p = spawn(process.execPath, ['src/server/index.js', '0', '--netmon'], { env: { ...process.env, REVVIEW_NETMON_HOST: 'a b' } });
  let out = '';
  let err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  const exited = new Promise((res) => p.once('exit', (code) => res(code)));
  for (let i = 0; i < 200 && !out.includes('netmon:') && p.exitCode === null; i++) await sleep(25);
  const code = p.exitCode;
  p.kill();
  await exited;
  assert.equal(code, null, `exited with ${code}: ${err}`);
  assert.match(out, /revview live server/);
  assert.match(out, /netmon: online = default route \+ TCP connect to api\.anthropic\.com:443/);
  assert.match(err, /using api\.anthropic\.com:443/);
});
