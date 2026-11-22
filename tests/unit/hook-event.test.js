import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startLiveServer } from '../../src/server/index.js';
import { initialBoard, reduceBoard, boardView, pendingPrompts } from '../../src/state/index.js';

const SCRIPT = fileURLToPath(new URL('../../hooks/event.mjs', import.meta.url));
const FIX = new URL('../../fixtures/sessions/', import.meta.url);

function stub(handler = (q, r) => r.writeHead(204).end()) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, ctype: req.headers['content-type'], raw: Buffer.concat(chunks) });
      handler(req, res);
    });
  });
  return new Promise((resolve) =>
    srv.listen(0, '127.0.0.1', () =>
      resolve({
        srv,
        seen,
        port: srv.address().port,
        close: () => {
          srv.closeAllConnections();
          srv.close();
        },
      }),
    ),
  );
}

function runHook(port, input, env = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [SCRIPT], { env: { ...process.env, REVVIEW_PORT: String(port), ...env } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.resume();
    p.on('close', (code) => resolve({ out, code, ms: Date.now() - t0 }));
    p.stdin.on('error', () => {});
    p.stdin.end(input);
  });
}

const ev = (o) => JSON.stringify({ session_id: 's1', cwd: '/nonexistent-revview/x', ...o });
const bodies = (s) => s.seen.map((r) => JSON.parse(r.raw.toString()));

async function closedPort() {
  const s = await stub();
  const p = s.port;
  await new Promise((r) => s.srv.close(r));
  return p;
}

test('PermissionRequest posts nothing, prints nothing, exits 0', async () => {
  const s = await stub();
  const r = await runHook(s.port, ev({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' }));
  s.close();
  assert.equal(s.seen.length, 0);
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
});

test('Revview* and non-string event names post nothing', async () => {
  const s = await stub();
  for (const name of ['RevviewButton', 'RevviewContext', 'Revview', 5, null, ['Stop'], undefined]) {
    const r = await runHook(s.port, ev({ hook_event_name: name }));
    assert.equal(r.code, 0);
    assert.equal(r.out, '');
  }
  s.close();
  assert.equal(s.seen.length, 0);
});

test('a normal event is posted byte-identical to /event', async () => {
  const s = await stub();
  const input = '{"session_id":"s1",  "hook_event_name":"PreToolUse","tool_name":"Read","x":"\\u00e9é"}\n';
  const r = await runHook(s.port, input);
  s.close();
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  assert.equal(s.seen.length, 1);
  assert.equal(s.seen[0].method, 'POST');
  assert.equal(s.seen[0].url, '/event');
  assert.match(s.seen[0].ctype, /application\/json/);
  assert.equal(s.seen[0].raw.toString('utf8'), input);
});

test('server down: exits 0 quickly and silently', async () => {
  const port = await closedPort();
  const r = await runHook(port, ev({ hook_event_name: 'Stop' }));
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  assert.ok(r.ms < 1000, `took ${r.ms} ms`);
});

test('server that never answers: exits 0 near the deadline', async () => {
  const s = await stub(() => {});
  const r = await runHook(s.port, ev({ hook_event_name: 'Stop' }), { REVVIEW_EVENT_WAIT_MS: '200' });
  s.close();
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  assert.ok(r.ms >= 150 && r.ms < 1500, `took ${r.ms} ms`);
});

test('a non-number wait falls back to 1000 ms, a tiny one is clamped to 50 ms', async () => {
  const s = await stub(() => {});
  const a = await runHook(s.port, ev({ hook_event_name: 'Stop' }), { REVVIEW_EVENT_WAIT_MS: 'soon' });
  const b = await runHook(s.port, ev({ hook_event_name: 'Stop' }), { REVVIEW_EVENT_WAIT_MS: '1' });
  s.close();
  assert.ok(a.ms >= 900 && a.ms < 2500, `default took ${a.ms} ms`);
  assert.ok(b.ms < 600, `clamped took ${b.ms} ms`);
});

test('500 from the server: exit 0, no output, no context post afterwards', async () => {
  const s = await stub((q, r) => r.writeHead(500).end('no'));
  const r = await runHook(s.port, ev({ hook_event_name: 'Stop', cwd: os.tmpdir() }));
  s.close();
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  assert.equal(s.seen.length, 1);
});

test('not JSON, empty and array stdin post nothing', async () => {
  const s = await stub();
  for (const input of ['hello', '', '[{"hook_event_name":"Stop"}]', '"Stop"', 'null']) {
    const r = await runHook(s.port, input);
    assert.equal(r.code, 0);
    assert.equal(r.out, '');
  }
  s.close();
  assert.equal(s.seen.length, 0);
});

// ---- context ----

const GITENV = {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
};
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { env: { ...process.env, ...GITENV }, stdio: 'pipe' });

function tmpRepo(branch = 'feature-x') {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'revview-hook-')));
  git(top, 'init', '-q', '-b', branch);
  git(top, 'commit', '-q', '--allow-empty', '-m', 'one');
  fs.mkdirSync(path.join(top, 'sub', 'deep'), { recursive: true });
  return top;
}

test('SessionStart from a subdirectory posts the event, then context with toplevel and branch', async () => {
  const top = tmpRepo();
  const s = await stub();
  const input = ev({ hook_event_name: 'SessionStart', source: 'startup', cwd: path.join(top, 'sub', 'deep') });
  const r = await runHook(s.port, input, GITENV);
  s.close();
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  assert.equal(s.seen.length, 2);
  assert.equal(s.seen[0].raw.toString(), input);
  assert.deepEqual(bodies(s)[1], { hook_event_name: 'RevviewContext', session_id: 's1', cwd: top, branch: 'feature-x' });
  assert.equal(s.seen[1].url, '/event');
  fs.rmSync(top, { recursive: true, force: true });
});

test('context also follows UserPromptSubmit, Stop and PostToolUse Bash, not other tools or events', async () => {
  const top = tmpRepo();
  const s = await stub();
  const cases = [
    [{ hook_event_name: 'UserPromptSubmit' }, true],
    [{ hook_event_name: 'Stop' }, true],
    [{ hook_event_name: 'PostToolUse', tool_name: 'Bash' }, true],
    [{ hook_event_name: 'PostToolUse', tool_name: 'Edit' }, false],
    [{ hook_event_name: 'PreToolUse', tool_name: 'Bash' }, false],
    [{ hook_event_name: 'SessionStart', source: 'compact' }, false],
    [{ hook_event_name: 'SessionStart', source: 'resume' }, true],
  ];
  for (const [e, ctx] of cases) {
    s.seen.length = 0;
    await runHook(s.port, ev({ ...e, cwd: top }), GITENV);
    assert.equal(s.seen.length, ctx ? 2 : 1, JSON.stringify(e));
    if (ctx) assert.equal(bodies(s)[1].hook_event_name, 'RevviewContext');
  }
  s.close();
  fs.rmSync(top, { recursive: true, force: true });
});

test('detached HEAD gives branch null', async () => {
  const top = tmpRepo();
  git(top, 'checkout', '-q', '--detach');
  const s = await stub();
  await runHook(s.port, ev({ hook_event_name: 'Stop', cwd: top }), GITENV);
  s.close();
  assert.deepEqual(bodies(s)[1], { hook_event_name: 'RevviewContext', session_id: 's1', cwd: top, branch: null });
  fs.rmSync(top, { recursive: true, force: true });
});

test('not a repository: payload cwd and branch null; relative cwd gets no context', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'revview-nogit-')));
  const s = await stub();
  await runHook(s.port, ev({ hook_event_name: 'Stop', cwd: dir }), { ...GITENV, GIT_CEILING_DIRECTORIES: path.dirname(dir) });
  assert.deepEqual(bodies(s)[1], { hook_event_name: 'RevviewContext', session_id: 's1', cwd: dir, branch: null });
  s.seen.length = 0;
  await runHook(s.port, ev({ hook_event_name: 'Stop', cwd: 'relative/dir' }), GITENV);
  assert.equal(s.seen.length, 1);
  s.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- oversize and the real server ----

test('a body over 1 MiB reaches the server as a prefix and marks the session dropped', async () => {
  const srv = await startLiveServer({ port: 0 });
  try {
    const port = new URL(srv.url).port;
    const post = (o) => runHook(port, JSON.stringify(o));
    await post({ session_id: 's1', cwd: '/x/repo', hook_event_name: 'SessionStart', source: 'startup' });
    await post({ session_id: 's1', cwd: '/x/repo', hook_event_name: 'UserPromptSubmit', prompt: 'go' });
    const before = (await (await fetch(`${srv.url}/state`)).json()).state;
    assert.equal(before.diffIncomplete, false);
    const big = { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { new_string: 'a'.repeat(1024 * 1024 + 200000) } };
    const r = await runHook(port, JSON.stringify(big));
    assert.equal(r.code, 0);
    assert.equal(r.out, '');
    assert.ok(r.ms < 1000, `took ${r.ms} ms`);
    const after = (await (await fetch(`${srv.url}/state`)).json()).state;
    assert.equal(after.diffIncomplete, true);
  } finally {
    await srv.close();
  }
});

function gitContext(cwd) {
  try {
    const [top, br] = git(cwd, 'rev-parse', '--show-toplevel', '--abbrev-ref', 'HEAD').toString().split('\n');
    return { cwd: top, branch: br === 'HEAD' ? null : br };
  } catch {
    return { cwd, branch: null };
  }
}
const lines = (name) => fs.readFileSync(new URL(`${name}.jsonl`, FIX), 'utf8').split('\n').filter((l) => l.trim() !== '');
const getState = async (srv) => (await (await fetch(`${srv.url}/state`)).json()).state;

test('end to end, working-turn: every line through the real hook matches the board replay', async () => {
  const srv = await startLiveServer({ port: 0 });
  try {
    const port = new URL(srv.url).port;
    const all = lines('working-turn');
    let board = initialBoard();
    for (const [i, line] of all.entries()) {
      const r = await runHook(port, line);
      assert.equal(r.code, 0);
      assert.equal(r.out, '');
      const e = JSON.parse(line);
      board = reduceBoard(board, e);
      // The hook also posts a RevviewContext (git toplevel and branch of the payload cwd; where git fails, the
      // payload cwd and null). Mirror it so the replay is of exactly what the server was sent.
      if (['UserPromptSubmit', 'Stop'].includes(e.hook_event_name) || (e.hook_event_name === 'SessionStart' && e.source !== 'compact')
        || (e.hook_event_name === 'PostToolUse' && e.tool_name === 'Bash')) {
        board = reduceBoard(board, { hook_event_name: 'RevviewContext', session_id: e.session_id, ...gitContext(e.cwd) });
      }
      if (e.hook_event_name === 'PostToolUse' && e.tool_name === 'Edit') {
        // mid-session: the Edit's diff is on the bar
        const mid = await getState(srv);
        assert.ok(mid.diff.added + mid.diff.removed > 0, 'diff shows after the Edit');
        assert.deepEqual(mid.diff, boardView(board).diff);
      }
      // the served state equals the replay after every line (the board is not time dependent here)
      const live = await getState(srv);
      const want = boardView(board);
      assert.deepEqual({ ...live, voice: null }, { ...want, voice: null }, `after line ${i} (${e.hook_event_name})`);
    }
    const last = await getState(srv);
    assert.equal(last.repo, path.basename(gitContext(JSON.parse(all[0]).cwd).cwd));
  } finally {
    await srv.close();
  }
});

test('end to end, permission-prompt: the hook skips PermissionRequest, the Notification still asks', async () => {
  const srv = await startLiveServer({ port: 0 });
  try {
    const port = new URL(srv.url).port;
    // Reference: the same recording with the PermissionRequest line left out, plus the hook's context posts.
    // (A PermissionRequest that reached /event would put its own pending entry on the board; see below.)
    let board = initialBoard();
    let withDup = initialBoard();
    for (const line of lines('permission-prompt')) {
      const e = JSON.parse(line);
      const r = await runHook(port, line);
      assert.equal(r.code, 0);
      assert.equal(r.out, '');
      withDup = reduceBoard(withDup, e);
      if (e.hook_event_name !== 'PermissionRequest') board = reduceBoard(board, e);
      if (['UserPromptSubmit', 'Stop', 'SessionStart'].includes(e.hook_event_name)
        || (e.hook_event_name === 'PostToolUse' && e.tool_name === 'Bash')) {
        const ctx = { hook_event_name: 'RevviewContext', session_id: e.session_id, ...gitContext(e.cwd) };
        board = reduceBoard(board, ctx);
        withDup = reduceBoard(withDup, ctx);
      }
      const live = await getState(srv);
      assert.deepEqual({ ...live, voice: null }, { ...boardView(board), voice: null }, e.hook_event_name);
      if (e.hook_event_name === 'PermissionRequest') {
        // skipped: the board is still at the PreToolUse (working) and carries no pending entry
        assert.equal(live.view, 'working');
        assert.equal(pendingPrompts(board).length, 0);
        assert.equal(pendingPrompts(withDup).length, 1); // what a post to /event would have caused
      }
      if (e.hook_event_name === 'Notification' && e.notification_type === 'permission_prompt') {
        // the Notification alone makes the NEEDS PERMISSION state, with exactly one pending entry
        assert.equal(live.view, 'permission');
        assert.equal(pendingPrompts(board).length, 1);
      }
    }
    assert.equal((await getState(srv)).view, 'ended');
  } finally {
    await srv.close();
  }
});

for (const bad of ['99999', '-5', '1.5', '0', 'abc']) {
  test(`out-of-range REVVIEW_PORT=${bad}: exit 0, stdout empty (normal and oversize body)`, async () => {
    const small = await runHook(bad, ev({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }));
    assert.equal(small.code, 0);
    assert.equal(small.out, '');
    const big = await runHook(bad, ev({ hook_event_name: 'PreToolUse', pad: 'x'.repeat(1024 * 1024 + 10) }));
    assert.equal(big.code, 0);
    assert.equal(big.out, '');
  });
}

test('a hung git child is killed when the hook hits its deadline', async () => {
  const s = await stub();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revview-fakegit-'));
  const pidFile = path.join(dir, 'pid');
  fs.writeFileSync(path.join(dir, 'git'), `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 30\n`, { mode: 0o755 });
  const r = await runHook(s.port, ev({ hook_event_name: 'Stop', cwd: '/tmp' }), {
    PATH: `${dir}:${process.env.PATH}`,
    REVVIEW_EVENT_WAIT_MS: '300',
  });
  s.close();
  assert.equal(r.code, 0);
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.ok(pid > 0);
  await new Promise((res) => setTimeout(res, 300));
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch {
    alive = false;
  }
  if (alive) process.kill(pid, 'SIGKILL');
  assert.equal(alive, false, 'git child still running');
});
