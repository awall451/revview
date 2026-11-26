import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startLiveServer, MAX_SSE_CLIENTS } from '../../src/server/index.js';

const open = (srv) =>
  new Promise((resolve, reject) => {
    const req = http.get(`${srv.url}/events`, (res) => resolve({ req, res }));
    req.on('error', reject);
  });

test('a throwing state core answers 500 and leaves seq and state alone', async () => {
  let boom = false;
  const srv = await startLiveServer({
    port: 0,
    reduce: (s, e) => {
      if (boom) throw new Error('boom');
      return { ...s, n: (s.n || 0) + 1, e };
    },
  });
  try {
    const post = (b) => fetch(`${srv.url}/event`, { method: 'POST', body: JSON.stringify(b) });
    assert.equal((await post({ a: 1 })).status, 204);
    const before = await (await fetch(`${srv.url}/state`)).json();
    boom = true;
    const origError = console.error;
    console.error = () => {};
    try {
      assert.equal((await post({ a: 2 })).status, 500);
    } finally {
      console.error = origError;
    }
    assert.deepEqual({ ...(await (await fetch(`${srv.url}/state`)).json()), now: before.now }, before); // the server clock moves on: only seq and state must be unchanged
    boom = false;
    assert.equal((await post({ a: 3 })).status, 204);
    assert.equal((await (await fetch(`${srv.url}/state`)).json()).seq, before.seq + 1);
  } finally {
    await srv.close();
  }
});

test('SSE clients are capped: the next one gets 503, a freed slot is reusable', async () => {
  const srv = await startLiveServer({ port: 0 });
  const conns = [];
  try {
    for (let i = 0; i < MAX_SSE_CLIENTS; i++) {
      const c = await open(srv);
      assert.equal(c.res.statusCode, 200);
      conns.push(c);
    }
    const over = await open(srv);
    assert.equal(over.res.statusCode, 503);
    over.res.resume();
    conns.pop().req.destroy();
    await new Promise((r) => setTimeout(r, 100));
    const again = await open(srv);
    assert.equal(again.res.statusCode, 200);
    conns.push(again);
    // plain requests still work at the cap
    assert.equal((await fetch(`${srv.url}/state`)).status, 200);
  } finally {
    for (const c of conns) c.req.destroy();
    await srv.close();
  }
});
