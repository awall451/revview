import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { createSessionRunner } from '../../src/sessions/index.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CMDS = ['list-windows', 'has-session', 'new-session', 'new-window', 'set-option', 'send-keys', 'kill-window', 'kill-server'];

// Fake exec: records calls, answers by tmux subcommand from a mutable state.
function fake(state = {}) {
  const calls = [];
  const exec = async (bin, args) => {
    calls.push({ bin, args });
    const cmd = args.find((a) => CMDS.includes(a));
    if (cmd === 'list-windows') {
      if (state.noServer) throw Object.assign(new Error('x'), { stderr: 'no server running on /tmp/x' });
      return { stdout: (state.windows ?? []).join('\n') + '\n' };
    }
    if (cmd === 'has-session') {
      if (!state.hasSession) throw new Error('no');
      return { stdout: '' };
    }
    if (cmd === 'new-session' || cmd === 'new-window') return { stdout: '@7\n' };
    return { stdout: '' };
  };
  return { calls, exec, state };
}
const row = (w, id, cwd = '/tmp', name = 'n') => [w, id, cwd, name].join('\t');
const sub = (calls, c) => calls.filter((x) => x.args.includes(c));

test('start: first creates the session, argv shape, no shell', async () => {
  const f = fake();
  const r = createSessionRunner({ exec: f.exec, claude: ['claude', '--x'], newId: () => A });
  const s = await r.start({ cwd: os.tmpdir(), name: 'w' });
  assert.deepEqual(s, { id: A, window: '@7', cwd: os.tmpdir() });
  const ns = sub(f.calls, 'new-session')[0];
  assert.equal(ns.bin, 'tmux');
  assert.deepEqual(ns.args.slice(0, 4), ['-f', '/dev/null', '-L', 'revview']);
  assert.deepEqual(ns.args.slice(ns.args.indexOf('--'), ns.args.indexOf(';')), ['--', 'claude', '--x', '--session-id', A]);
  assert.equal(ns.args[ns.args.indexOf('-c') + 1], os.tmpdir());
  assert.ok(ns.args.includes('-d') && ns.args.includes('-P'));
  const so = sub(f.calls, 'set-option').find((c) => c.args.includes('@revview_id'));
  assert.deepEqual(so.args.slice(-5), ['-w', '-t', '@7', '@revview_id', A]);
  assert.deepEqual(ns.args.slice(-5), [';', 'set-option', '-g', 'remain-on-exit', 'on'], 'a window whose Claude exited is kept for reap');
  assert.equal(r.chosen, undefined, 'the runner keeps no second "chosen" state');
  assert.equal(r.choose, undefined);
});

test('start: later sessions use new-window; socket path uses -S', async () => {
  const f = fake({ hasSession: true });
  const r = createSessionRunner({ exec: f.exec, socket: { path: '/tmp/x/sock' }, newId: () => B });
  await r.start({ cwd: os.tmpdir() });
  const nw = sub(f.calls, 'new-window')[0];
  assert.deepEqual(nw.args.slice(0, 4), ['-f', '/dev/null', '-S', '/tmp/x/sock']);
  assert.ok(nw.args.includes('revview:'));
  assert.equal(sub(f.calls, 'new-session').length, 0);
});

test('start: cwd must be absolute and an existing directory', async () => {
  const f = fake();
  const r = createSessionRunner({ exec: f.exec });
  await assert.rejects(r.start({ cwd: 'rel' }));
  await assert.rejects(r.start({ cwd: '/nonexistent-dir-xyz' }));
  await assert.rejects(r.start({ cwd: new URL(import.meta.url).pathname }));
  assert.equal(f.calls.length, 0);
});

test('list: only windows with a uuid @revview_id; no server -> []', async () => {
  const f = fake({ windows: [row('@1', A, '/a', 'one'), row('@2', ''), row('@3', 'not-a-uuid'), row('@4', B, '/b', 'two')] });
  const r = createSessionRunner({ exec: f.exec });
  assert.deepEqual(await r.list(), [
    { id: A, window: '@1', cwd: '/a', name: 'one' },
    { id: B, window: '@4', cwd: '/b', name: 'two' },
  ]);
  f.state.noServer = true;
  assert.deepEqual(await r.list(), []);
});

test('target only for listed uuid ids; anything else is null without a tmux call', async () => {
  const f = fake({ windows: [row('@1', A)] });
  const r = createSessionRunner({ exec: f.exec });
  assert.equal(await r.target(B), null);
  assert.deepEqual(await r.target(A), { id: A, window: '@1' });
  const n = f.calls.length;
  for (const bad of [undefined, null, '', 'not-a-uuid', 7, `${A};x`]) assert.equal(await r.target(bad), null);
  assert.equal(f.calls.length, n);
});

test('send goes only to the re-verified window of the given id', async () => {
  const f = fake({ windows: [row('@1', A), row('@2', B)] });
  const r = createSessionRunner({ exec: f.exec });
  f.state.windows = [row('@9', A), row('@2', B)]; // window id changed behind our back
  assert.deepEqual(await r.send('Escape', A), { sent: true, id: A, window: '@9' });
  const sk = sub(f.calls, 'send-keys');
  assert.equal(sk.length, 1);
  assert.deepEqual(sk[0].args.slice(-3), ['-t', '@9', 'Escape']);
  assert.ok(!sk[0].args.includes('-l'));
});

test('send: unknown key throws and runs nothing', async () => {
  const f = fake({ windows: [row('@1', A)] });
  const r = createSessionRunner({ exec: f.exec });
  const n = f.calls.length;
  for (const k of ['Enter', 'a', '', undefined, 'Escape;x']) await assert.rejects(r.send(k, A));
  assert.equal(f.calls.length, n);
});

test('send without a valid session id runs nothing', async () => {
  const f = fake({ windows: [row('@1', A)] });
  const r = createSessionRunner({ exec: f.exec });
  for (const id of [undefined, null, '', 'not-a-uuid', 7]) {
    assert.deepEqual(await r.send('C-c', id), { sent: false, reason: 'no session selected' });
  }
  assert.equal(f.calls.length, 0);
});

test('session window gone: nothing sent', async () => {
  const f = fake({ windows: [row('@1', A)] });
  const logs = [];
  const r = createSessionRunner({ exec: f.exec, log: (m) => logs.push(m) });
  f.state.windows = [row('@2', B)];
  assert.equal(await r.target(A), null);
  assert.ok(logs.length > 0);
  f.state.windows = [];
  assert.deepEqual(await r.send('Space', B), { sent: false, reason: 'selected session gone' });
  assert.equal(sub(f.calls, 'send-keys').length, 0);
});

test('stop kills the verified window', async () => {
  const f = fake({ windows: [row('@1', A), row('@2', B)] });
  const r = createSessionRunner({ exec: f.exec });
  assert.equal(await r.stop(B), true);
  assert.deepEqual(sub(f.calls, 'kill-window')[0].args.slice(-2), ['-t', '@2']);
  assert.equal(await r.stop(A), true);
  assert.equal(await r.stop('33333333-3333-4333-8333-333333333333'), false);
  assert.equal(sub(f.calls, 'kill-window').length, 2);
});

test('killServer ignores no server', async () => {
  const exec = async () => { throw Object.assign(new Error('x'), { stderr: 'no server running on /tmp/x' }); };
  await createSessionRunner({ exec }).killServer();
});

test('start: cwd or name with # or control characters is refused before any tmux call', async () => {
  const f = fake();
  const r = createSessionRunner({ exec: f.exec, newId: () => A });
  for (const bad of ['/tmp/#(x)', '/tmp/a#b', '/tmp/a\nb', '/tmp/a\u0001b']) await assert.rejects(r.start({ cwd: bad }), /cwd/);
  for (const bad of ['#(x)', 'a#', 'a\nb', 'a\u007fb']) await assert.rejects(r.start({ cwd: os.tmpdir(), name: bad }), /name/);
  assert.equal(f.calls.length, 0);
});
