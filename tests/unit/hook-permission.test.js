import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../hooks/permission-request.mjs', import.meta.url));
const REQ = JSON.stringify({ session_id: 'sess-a', hook_event_name: 'PermissionRequest', tool_name: 'Bash' });

function stub(handler) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, ctype: req.headers['content-type'], body: Buffer.concat(chunks).toString() });
      handler(req, res);
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, seen, port: srv.address().port })));
}

function runHook(port, { input = REQ, wait = '2000' } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [SCRIPT], {
      env: { ...process.env, REVVIEW_PORT: String(port), REVVIEW_HOOK_WAIT_MS: wait },
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.resume();
    p.on('close', (code) => resolve({ out, code, ms: Date.now() - t0 }));
    p.stdin.end(input);
  });
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const wrap = (d) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: d } });

test('allow prints the exact hook output and forwards the body unchanged', async () => {
  const s = await stub((q, r) => json(r, 200, { behavior: 'allow' }));
  const r = await runHook(s.port);
  s.srv.close();
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), wrap({ behavior: 'allow' }));
  assert.equal(s.seen.length, 1);
  assert.equal(s.seen[0].method, 'POST');
  assert.equal(s.seen[0].url, '/permission');
  assert.match(s.seen[0].ctype, /application\/json/);
  assert.equal(s.seen[0].body, REQ);
});

test('deny passes the message', async () => {
  const s = await stub((q, r) => json(r, 200, { behavior: 'deny', message: 'No.' }));
  const r = await runHook(s.port);
  s.srv.close();
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), wrap({ behavior: 'deny', message: 'No.' }));
});

test('204 means no decision', async () => {
  const s = await stub((q, r) => {
    r.writeHead(204);
    r.end();
  });
  const r = await runHook(s.port);
  s.srv.close();
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
});

test('no answer: times out quietly', async () => {
  const s = await stub(() => {});
  const r = await runHook(s.port, { wait: '300' });
  s.srv.closeAllConnections();
  s.srv.close();
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  assert.ok(r.ms < 1500, `took ${r.ms}`);
});

test('server down prints nothing', async () => {
  const s = await stub(() => {});
  const port = s.port;
  await new Promise((res) => s.srv.close(res));
  const r = await runHook(port);
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
});

test('extra keys, bad shapes, 500, bad JSON are refused', async () => {
  const bodies = [
    [200, { behavior: 'allow', updatedPermissions: [{ type: 'x' }] }],
    [200, { behavior: 'allow', message: 'x' }],
    [200, { behavior: 'deny' }],
    [200, { behavior: 'deny', message: '' }],
    [200, { behavior: 'deny', message: 'x'.repeat(201) }],
    [200, { behavior: 'deny', message: 5 }],
    [200, { behavior: 'ask' }],
    [200, 'not json'],
    [200, '[]'],
    [200, 'null'],
    [500, { behavior: 'allow' }],
  ];
  for (const [status, body] of bodies) {
    const s = await stub((q, r) => json(r, status, body));
    const r = await runHook(s.port);
    s.srv.close();
    assert.equal(r.code, 0);
    assert.equal(r.out, '', JSON.stringify(body));
  }
});

test('stdin that is not JSON prints nothing', async () => {
  const s = await stub((q, r) => json(r, 200, { behavior: 'allow' }));
  const r = await runHook(s.port, { input: 'garbage' });
  s.srv.close();
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  assert.equal(s.seen.length, 0);
});

test('stdin over 1 MiB prints nothing', async () => {
  const s = await stub((q, r) => json(r, 200, { behavior: 'allow' }));
  const r = await runHook(s.port, { input: JSON.stringify({ x: 'a'.repeat(1024 * 1024 + 10) }) });
  s.srv.close();
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  assert.equal(s.seen.length, 0);
});

test('hook wait: default 570 s, clamped below the 600 s settings timeout', async () => {
  const { resolveWaitMs, DEFAULT_WAIT_MS, MAX_WAIT_MS } = await import('../../hooks/wait.mjs');
  assert.equal(DEFAULT_WAIT_MS, 570000);
  assert.equal(resolveWaitMs(undefined), 570000);
  assert.equal(resolveWaitMs(''), 570000);
  assert.equal(resolveWaitMs('abc'), 570000);
  assert.equal(resolveWaitMs('0'), 570000);
  assert.equal(resolveWaitMs('-5'), 570000);
  assert.equal(resolveWaitMs('2000'), 2000);
  assert.equal(resolveWaitMs('600000'), MAX_WAIT_MS);
  assert.equal(resolveWaitMs('99999999'), MAX_WAIT_MS);
  assert.ok(MAX_WAIT_MS < 600000);
});

// ---- AskUserQuestion answers
const QS = [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: 'r' }, { label: 'Green', description: 'g' }] }];
const ASK = JSON.stringify({ session_id: 'sess-a', hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: { questions: QS } });
const ans = (o = {}) => ({ behavior: 'allow', updatedInput: { questions: QS, answers: { 'Which colour?': 'Green' }, ...o } });

test('AskUserQuestion: a valid updatedInput is printed', async () => {
  const s = await stub((q, r) => json(r, 200, ans()));
  const r = await runHook(s.port, { input: ASK });
  s.srv.close();
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), wrap(ans()));
});

test('AskUserQuestion: each mismatch prints nothing', async () => {
  const bad = [
    ['other tool', ans(), REQ],
    ['extra key in updatedInput', ans({ extra: 1 }), ASK],
    ['extra key in decision', { ...ans(), message: 'x' }, ASK],
    ['questions differ', ans({ questions: [{ ...QS[0], header: 'Other' }] }), ASK],
    ['unknown question', ans({ answers: { 'Which fruit?': 'Green' } }), ASK],
    ['label not an option', ans({ answers: { 'Which colour?': 'Purple' } }), ASK],
    ['label not a string', ans({ answers: { 'Which colour?': 1 } }), ASK],
    ['empty answers', ans({ answers: {} }), ASK],
    ['answers an array', ans({ answers: ['Green'] }), ASK],
    ['no answers key', { behavior: 'allow', updatedInput: { questions: QS } }, ASK],
    ['updatedInput not an object', { behavior: 'allow', updatedInput: 'x' }, ASK],
  ];
  for (const [name, decision, input] of bad) {
    const s = await stub((q, r) => json(r, 200, decision));
    const r = await runHook(s.port, { input });
    s.srv.close();
    assert.equal(r.code, 0, name);
    assert.equal(r.out, '', name);
  }
});
