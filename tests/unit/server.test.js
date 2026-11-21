import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { startLiveServer, DEFAULT_PORT, DEFAULT_HOST, MAX_BODY_BYTES } from '../../src/server/index.js';
import { initialState } from '../../src/state/index.js';

const FIX = new URL('../../fixtures/sessions/', import.meta.url);

async function withServer(fn) {
  const srv = await startLiveServer({ port: 0 });
  try {
    await fn(srv);
  } finally {
    await srv.close();
  }
}

const post = (srv, body, opts = {}) =>
  fetch(`${srv.url}/event`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), ...opts });
const getState = async (srv) => (await fetch(`${srv.url}/state`)).json();

// Minimal SSE reader: collects raw text and parsed data messages.
function sse(srv) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${srv.url}/events`, (res) => {
      const c = { res, raw: '', messages: [], waiters: [], close: () => req.destroy() };
      res.setEncoding('utf8');
      res.on('data', (d) => {
        c.raw += d;
        c.messages = c.raw.split('\n\n').filter((b) => b.startsWith('data: ')).map((b) => JSON.parse(b.slice(6)));
        c.waiters = c.waiters.filter((w) => !w());
      });
      res.on('error', () => {});
      c.until = (cond) =>
        new Promise((ok, bad) => {
          const t = setTimeout(() => bad(new Error('sse timeout: ' + c.raw)), 5000);
          const check = () => (cond(c) ? (clearTimeout(t), ok(c), true) : false);
          if (!check()) c.waiters.push(check);
        });
      resolve(c);
    });
    req.on('error', reject);
  });
}

test('binds to 127.0.0.1, default port 8138', async () => {
  assert.equal(DEFAULT_PORT, 8138);
  assert.equal(DEFAULT_HOST, '127.0.0.1');
  assert.equal(MAX_BODY_BYTES, 1048576);
  await withServer((srv) => {
    assert.match(srv.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(srv.port, Number(new URL(srv.url).port));
  });
});

test('initial state', async () => {
  await withServer(async (srv) => {
    const s = await getState(srv);
    assert.equal(s.seq, 0);
    assert.deepEqual(s.state, initialState());
    assert.deepEqual(srv.state(), initialState());
  });
});

test('late-joining SSE client gets retry and current state at once', async () => {
  await withServer(async (srv) => {
    await post(srv, { hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
    await post(srv, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
    const c = await sse(srv);
    try {
      assert.match(c.res.headers['content-type'], /text\/event-stream/);
      assert.equal(c.res.headers['cache-control'], 'no-store');
      await c.until((x) => x.messages.length >= 1);
      assert.ok(c.raw.startsWith('retry: 1000\n\n'));
      assert.equal(c.messages[0].seq, 2);
      assert.deepEqual(c.messages[0].state, srv.state());
    } finally {
      c.close();
    }
  });
});

test('every client gets a message per POST, even without a state change', async () => {
  await withServer(async (srv) => {
    const a = await sse(srv);
    const b = await sse(srv);
    try {
      await a.until((x) => x.messages.length === 1);
      await b.until((x) => x.messages.length === 1);
      const r1 = await post(srv, { hook_event_name: 'SomethingUnknown' });
      assert.equal(r1.status, 204);
      const r2 = await post(srv, { hook_event_name: 'SomethingUnknown' });
      assert.equal(r2.status, 204);
      for (const c of [a, b]) {
        await c.until((x) => x.messages.length === 3);
        assert.deepEqual(c.messages.map((m) => m.seq), [0, 1, 2]);
      }
    } finally {
      a.close();
      b.close();
    }
  });
});

for (const f of fs.readdirSync(FIX).filter((n) => n.endsWith('.jsonl'))) {
  test(`HTTP replay of ${f} matches expected`, async () => {
    const lines = fs.readFileSync(new URL(f, FIX), 'utf8').split('\n').filter((l) => l.trim());
    const expected = JSON.parse(fs.readFileSync(new URL(f.replace('.jsonl', '.expected.json'), FIX), 'utf8'));
    assert.equal(expected.length, lines.length);
    await withServer(async (srv) => {
      for (let i = 0; i < lines.length; i++) {
        assert.equal((await post(srv, lines[i])).status, 204);
        const s = await getState(srv);
        assert.equal(s.seq, i + 1);
        assert.deepEqual(s.state, expected[i].state, `${f} line ${i + 1}`);
      }
    });
  });
}

test('bad bodies give 400 and leave state alone', async () => {
  await withServer(async (srv) => {
    for (const body of ['{nope', '', '[]', '42', 'null', '"str"']) {
      const r = await post(srv, body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.ok((await r.text()).length > 0);
    }
    const s = await getState(srv);
    assert.equal(s.seq, 0);
    assert.deepEqual(s.state, initialState());
  });
});

test('body limit: oversize rejected, just under accepted', async () => {
  await withServer(async (srv) => {
    const status = await new Promise((resolve) => {
      const req = http.request(`${srv.url}/event`, { method: 'POST' }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', () => resolve('reset'));
      req.end(Buffer.alloc(MAX_BODY_BYTES + 1000, 0x20));
    });
    assert.ok(status === 413 || status === 'reset', String(status));
    assert.equal((await getState(srv)).seq, 0);
    const prefix = '{"hook_event_name":"X","pad":"';
    const under = prefix + 'a'.repeat(MAX_BODY_BYTES - prefix.length - 2) + '"}';
    assert.equal(Buffer.byteLength(under), MAX_BODY_BYTES);
    assert.equal((await post(srv, under)).status, 204);
    assert.equal((await getState(srv)).seq, 1);
  });
});

test('oversize body with fetch gets 413 or a reset, server survives', async () => {
  await withServer(async (srv) => {
    const big = JSON.stringify({ hook_event_name: 'X', pad: 'a'.repeat(MAX_BODY_BYTES + 10) });
    let status;
    try {
      status = (await post(srv, big)).status;
    } catch {
      status = 'reset';
    }
    assert.ok(status === 413 || status === 'reset', String(status));
    assert.equal((await fetch(`${srv.url}/state`)).status, 200);
  });
});

function raw(srv, headers, path = '/state') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, path, method: 'GET', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('Origin and Host checks', async () => {
  await withServer(async (srv) => {
    const ev = { hook_event_name: 'X' };
    assert.equal((await post(srv, ev, { headers: { origin: 'http://evil.example' } })).status, 403);
    assert.equal((await post(srv, ev, { headers: { origin: 'null' } })).status, 403);
    assert.equal((await post(srv, ev, { headers: { origin: srv.url } })).status, 204);
    assert.equal((await post(srv, ev, { headers: { origin: `http://localhost:${srv.port}` } })).status, 204);
    assert.equal((await post(srv, ev)).status, 204);
    assert.equal(await raw(srv, { host: 'evil.example' }), 403);
    assert.equal(await raw(srv, { host: `evil.example:${srv.port}` }), 403);
    assert.equal(await raw(srv, { host: `localhost:${srv.port}` }), 200);
    assert.equal((await getState(srv)).seq, 3);
  });
});

test('static files, traversal, methods, unknown paths', async () => {
  await withServer(async (srv) => {
    const r = await fetch(`${srv.url}/`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.equal(await r.text(), fs.readFileSync(new URL('../../src/view/index.html', import.meta.url), 'utf8'));
    assert.equal((await fetch(`${srv.url}/index.html`)).status, 200);
    assert.equal((await fetch(`${srv.url}/view.css`)).headers.get('cache-control'), 'no-store');
    for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/%2e%2e%2f%2e%2e%2fpackage.json']) {
      const st = await raw(srv, {}, p);
      assert.ok(st === 403 || st === 404, `${p} -> ${st}`);
    }
    const pj = await fetch(`${srv.url}/%2e%2e/package.json`);
    assert.ok(!(await pj.text()).includes('"revview"'));
    assert.equal((await fetch(`${srv.url}/event`, { method: 'PUT', body: '{}' })).status, 405);
    assert.equal((await fetch(`${srv.url}/event`)).status, 405);
    assert.equal((await fetch(`${srv.url}/state`, { method: 'POST', body: '{}' })).status, 405);
    assert.equal((await fetch(`${srv.url}/nope`)).status, 404);
    assert.equal((await fetch(`${srv.url}/missing.js`)).status, 404);
  });
});

test('close() resolves promptly with an SSE client connected', async () => {
  const srv = await startLiveServer({ port: 0 });
  const c = await sse(srv);
  await c.until((x) => x.messages.length >= 1);
  const t0 = Date.now();
  await srv.close();
  assert.ok(Date.now() - t0 < 2000);
  c.close();
});
