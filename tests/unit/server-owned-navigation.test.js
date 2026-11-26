// WB4 on the server: internal events refused over HTTP, owned sessions from the runner, the wheel keys driving
// the list and New session. Fake runner, no tmux.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startLiveServer, parseArgs } from '../../src/server/index.js';

const A = '11111111-1111-4111-8111-111111111111';
const N = '44444444-4444-4444-8444-444444444444';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INTERNAL = [
  { hook_event_name: 'RevviewSelect', session_id: A },
  { hook_event_name: 'RevviewNav', button: 'up', gesture: 'tap' },
  { hook_event_name: 'RevviewOwned', ids: [A] },
  { hook_event_name: 'RevviewProjects', paths: ['/x'] },
  { hook_event_name: 'RevviewNote', note: 'forged' },
  { hook_event_name: 'RevviewNoSessionPress' },
];

function fakeRunner(state = {}) {
  const r = {
    started: [],
    ids: state.ids ?? [A],
    failList: false,
    list: async () => { if (r.failList) throw new Error('tmux gone'); return r.ids.map((id) => ({ id, window: '@1' })); },
    target: async (id) => (r.ids.includes(id) ? { id, window: '@1' } : null),
    send: async (k, id) => ({ sent: r.ids.includes(id), id, window: '@1' }),
    start: async ({ cwd }) => { r.started.push(cwd); r.ids.push(N); return { id: N, window: '@2', cwd }; },
  };
  return r;
}

async function setup(t, opts = {}) {
  const s = await startLiveServer({ port: 0, ...opts });
  t.after(() => s.close());
  const post = (p, body) => fetch(`${s.url}${p}`, { method: 'POST', body: JSON.stringify(body) });
  const state = async () => ({ ...(await (await fetch(`${s.url}/state`)).json()), now: 0 }); // now (the server clock) is not part of the comparisons
  const key = async (code) => {
    const n = s.gestures().length;
    await post('/dev/key', { code, type: 'down' });
    await post('/dev/key', { code, type: 'up' });
    for (let i = 0; i < 100 && s.gestures().length === n; i++) await sleep(10);
    await sleep(60);
  };
  const ev = async (e) => assert.equal((await post('/event', e)).status, 204);
  return { s, post, state, key, ev };
}

for (const devBridge of [false, true]) {
  test(`POST /event of the internal events is 403 and changes nothing (devBridge ${devBridge})`, async (t) => {
    const c = await setup(t, { devBridge, sessions: fakeRunner() });
    const before = await c.state();
    for (const e of INTERNAL) assert.equal((await c.post('/event', e)).status, 403, e.hook_event_name);
    assert.deepEqual(await c.state(), before);
  });
}

test('a server with a runner gets owned from list(); without sessions voice stays null', async (t) => {
  const c = await setup(t, { sessions: fakeRunner() });
  await c.ev({ hook_event_name: 'SessionStart', session_id: A, cwd: '/w/a' });
  c.s.select(A);
  const v = (await c.state()).state;
  assert.equal(v.voice, 'here');
  assert.deepEqual(v.position, { index: 1, count: 1 });

  const plain = await setup(t);
  await plain.ev({ hook_event_name: 'SessionStart', session_id: A, cwd: '/w/a' });
  plain.s.select(A);
  const p = (await plain.state()).state;
  assert.equal(p.voice, null);
  assert.equal(p.position, null);
});

test('owned follows the runner on a poll; a failing list keeps the last value', async (t) => {
  const runner = fakeRunner({ ids: [] });
  const c = await setup(t, { sessions: runner, ownedPollMs: 20 });
  await c.ev({ hook_event_name: 'SessionStart', session_id: A, cwd: '/w/a' });
  c.s.select(A);
  assert.equal((await c.state()).state.voice, 'no-session');
  runner.ids = [A];
  await sleep(120);
  assert.equal((await c.state()).state.voice, 'here');
  runner.failList = true;
  runner.ids = [];
  await sleep(120);
  assert.equal((await c.state()).state.voice, 'here', 'the last value is kept');
});

test('dev keys drive the list: F17 (up) opens it, F22 (back) closes it', async (t) => {
  const c = await setup(t, { devBridge: true, sessions: fakeRunner() });
  await c.ev({ hook_event_name: 'SessionStart', session_id: A, cwd: '/w/a' });
  await c.key('F17');
  assert.equal((await c.state()).state.nav.kind, 'list');
  await c.key('F21'); // press in the list: selects the row and closes
  assert.equal((await c.state()).state.nav, null);
  await c.key('F23');
  assert.equal((await c.state()).state.nav.kind, 'menu');
});

test('navigation works without sessions; keys are refused', async (t) => {
  const c = await setup(t, { devBridge: true });
  await c.key('F17');
  assert.equal((await c.state()).state.nav.kind, 'list');
  await c.key('F13'); // push-to-talk inside the list: nothing
  assert.equal((await c.state()).state.nav.kind, 'list');
});

test('New session by the wheel starts in the chosen project and the board selects it', async (t) => {
  const runner = fakeRunner();
  const c = await setup(t, { devBridge: true, sessions: runner, projects: ['/p/one', '/p/two'] });
  await c.ev({ hook_event_name: 'SessionStart', session_id: A, cwd: '/w/a' });
  c.s.select(A);
  await c.key('F23'); // menu
  await c.key('F21'); // New session
  const v = (await c.state()).state.nav;
  assert.equal(v.kind, 'new');
  assert.deepEqual(v.rows.map((x) => x.label), ['/p/one', '/p/two']);
  await c.key('F18'); // down
  await c.key('F21');
  assert.deepEqual(runner.started, ['/p/two']);
  assert.equal((await c.state()).state.nav, null);
  await c.ev({ hook_event_name: 'SessionStart', session_id: N, cwd: '/p/two' });
  const after = (await c.state()).state;
  assert.deepEqual(after.position, { index: 2, count: 2 });
  assert.equal(after.voice, 'here', 'owned was refreshed after the start');
});

test('parseArgs: --projects, and REVVIEW_PROJECTS as its default', () => {
  assert.equal(parseArgs(['--projects', '/x/p.json']).projects, '/x/p.json');
  assert.throws(() => parseArgs(['--projects']), /--projects needs a file/);
  assert.throws(() => parseArgs(['--projects', '--sessions']), /--projects needs a file/);
  const old = process.env.REVVIEW_PROJECTS;
  process.env.REVVIEW_PROJECTS = '/env/p.json';
  try {
    assert.equal(parseArgs([]).projects, '/env/p.json');
    assert.equal(parseArgs(['--projects', '/x/p.json']).projects, '/x/p.json');
  } finally {
    if (old === undefined) delete process.env.REVVIEW_PROJECTS; else process.env.REVVIEW_PROJECTS = old;
  }
  assert.equal(parseArgs([]).projects, process.env.REVVIEW_PROJECTS ?? null);
});

test('after a restart an existing owned window is on the board and selectable before any hook event', async (t) => {
  const runner = fakeRunner({ ids: [A] });
  runner.list = async () => [{ id: A, window: '@1', cwd: '/w/a', name: 'alpha' }];
  const c = await setup(t, { sessions: runner });
  c.s.select(A);
  assert.equal(c.s.selected(), A);
  const v = (await c.state()).state;
  assert.equal(v.voice, 'here');
  assert.equal(v.view, 'unknown');
  assert.equal(v.repo, 'alpha');
  assert.equal(v.note, 'No events from this session yet');
  assert.deepEqual(v.position, { index: 1, count: 1 });
});
