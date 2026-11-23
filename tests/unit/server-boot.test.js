import test from 'node:test';
import assert from 'node:assert/strict';
import { startLiveServer, parseArgs, bootSessions } from '../../src/server/index.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function fakeRunner(windows = []) {
  const r = {
    started: [],
    windows,
    list: async () => r.windows.map((w) => ({ ...w })),
    start: async ({ cwd }) => {
      const id = r.started.length === 0 ? A : B;
      r.started.push(cwd);
      r.windows.push({ id, window: `@${r.windows.length + 1}`, cwd, name: 'w' });
      return { id, window: '@9', cwd };
    },
  };
  return r;
}

test('boot:true shows starting with no sessions; boot:false does not', async (t) => {
  const a = await startLiveServer({ port: 0, boot: true });
  const b = await startLiveServer({ port: 0, boot: false });
  const c = await startLiveServer({ port: 0 });
  t.after(async () => { await a.close(); await b.close(); await c.close(); });
  assert.equal(a.state().view, 'starting');
  assert.notEqual(b.state().view, 'starting');
  assert.notEqual(c.state().view, 'starting');
});

test('boot with an owned window listed: that session shows, not starting', async (t) => {
  const runner = fakeRunner([{ id: A, window: '@1', cwd: '/tmp', name: 'one' }]);
  const live = await startLiveServer({ port: 0, boot: true, sessions: runner });
  t.after(() => live.close());
  // r6-06: the quiet placeholder stays STARTING until the boot is done (no "No session chosen" flash in between)
  assert.equal(live.state().view, 'starting');
  live.bootDone();
  assert.notEqual(live.state().view, 'starting');
});

test('bootSessions: no windows -> starts each dir, refreshes, selects the last', async (t) => {
  const runner = fakeRunner();
  const live = await startLiveServer({ port: 0, boot: true, sessions: runner });
  t.after(() => live.close());
  assert.equal(live.state().view, 'starting');
  const id = await bootSessions({ runner, live, dirs: ['/tmp/rel-a', '/tmp'], log: () => {} });
  assert.equal(id, B);
  assert.deepEqual(runner.started, ['/tmp/rel-a', '/tmp']);
  assert.equal(live.selected(), B);
  // the boot STARTING is over; the session revview just started shows its own STARTING until its first hook (r6 part D)
  assert.equal(live.state().view, 'starting');
  assert.equal(live.state().nav, null);
});

test('bootSessions: one existing window -> selected, nothing started; several -> none', async () => {
  const sel = [];
  const live = { select: (id) => sel.push(id), refreshOwned: async () => { throw new Error('not expected'); } };
  const one = fakeRunner([{ id: A, window: '@1' }]);
  assert.equal(await bootSessions({ runner: one, live, dirs: ['/tmp'] }), A);
  assert.deepEqual(sel, [A]);
  assert.deepEqual(one.started, []);
  const two = fakeRunner([{ id: A, window: '@1' }, { id: B, window: '@2' }]);
  assert.equal(await bootSessions({ runner: two, live, dirs: ['/tmp'] }), null);
  assert.deepEqual(sel, [A]);
  assert.deepEqual(two.started, []);
});

test('bootSessions: a failing start or list is logged and returns null', async () => {
  const live = { select: () => {}, refreshOwned: async () => {} };
  const logs = [];
  const bad = { list: async () => [], start: async () => { throw new Error('tmux gone'); } };
  assert.equal(await bootSessions({ runner: bad, live, dirs: ['/tmp'], log: (m) => logs.push(m) }), null);
  assert.match(logs[0], /tmux gone/);
  const bad2 = { list: async () => { throw new Error('nope'); }, start: async () => ({ id: A }) };
  assert.equal(await bootSessions({ runner: bad2, live, dirs: ['/tmp'], log: (m) => logs.push(m) }), null);
  assert.equal(logs.length, 2);
});

test('bootSessions: no dirs and no windows -> null, nothing started', async () => {
  const runner = fakeRunner();
  assert.equal(await bootSessions({ runner, live: { select() {}, refreshOwned: async () => {} }, dirs: [] }), null);
  assert.deepEqual(runner.started, []);
});

function withEnv(env, fn) {
  const old = {};
  for (const k of Object.keys(env)) {
    old[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(old)) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
}

test('parseArgs: --boot, --netmon, REVVIEW_START', () => {
  withEnv({ REVVIEW_START: undefined, REVVIEW_PORT: undefined }, () => {
    const plain = parseArgs([]);
    assert.ok(!plain.boot && !plain.netmon);
    assert.deepEqual(plain.start, []);
    assert.equal(parseArgs(['--boot']).boot, true);
    assert.equal(parseArgs(['--netmon']).netmon, true);
  });
  withEnv({ REVVIEW_START: '/srv/proj' }, () => {
    const b = parseArgs(['--boot', '--sessions']);
    assert.deepEqual(b.start, ['/srv/proj']);
    assert.equal(b.sessions, true);
    assert.equal(parseArgs(['--boot']).sessions, false, 'sessions stays as given');
    assert.deepEqual(parseArgs(['--boot', '--start', '/x']).start, ['/x'], '--start wins');
    assert.deepEqual(parseArgs(['--sessions']).start, [], 'ignored without --boot');
    assert.deepEqual(parseArgs([]).start, []);
    assert.deepEqual(parseArgs(['--start', '/a']).start, ['/a']);
  });
});

test('parseArgs: existing behaviour unchanged', () => {
  withEnv({ REVVIEW_START: undefined, REVVIEW_PORT: undefined, REVVIEW_PROJECTS: undefined, REVVIEW_SPEECH: undefined }, () => {
    assert.deepEqual(parseArgs([]), { port: 8138, inputPath: null, devBridge: false, sessions: false, start: [], projects: null });
    assert.deepEqual(parseArgs(['--start', '/a', '7']), { port: 7, inputPath: null, devBridge: false, sessions: true, start: ['/a'], projects: null });
    assert.throws(() => parseArgs(['--nope']), /unknown option --nope/);
  });
});

test('parseArgs: --tmux-socket and --claude-settings need an absolute value', () => {
  assert.equal(parseArgs([]).tmuxSocket, undefined);
  assert.equal(parseArgs([]).claudeSettings, undefined);
  const a = parseArgs(['--tmux-socket', '/x/t.sock', '--claude-settings', '/x/s.json']);
  assert.equal(a.tmuxSocket, '/x/t.sock');
  assert.equal(a.claudeSettings, '/x/s.json');
  for (const flag of ['--tmux-socket', '--claude-settings']) {
    assert.throws(() => parseArgs([flag]), new RegExp(`${flag} needs`));
    assert.throws(() => parseArgs([flag, '--sessions']), new RegExp(`${flag} needs`));
    assert.throws(() => parseArgs([flag, 'relative/path']), /absolute/);
  }
});
