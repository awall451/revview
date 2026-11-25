// Read aloud on the live server, with the real stand-in engine (tests/unit/fixtures/speech/fake-engine.sh).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLiveServer, parseArgs } from '../../src/server/index.js';

const FAKE = fileURLToPath(new URL('fixtures/speech/fake-engine.sh', import.meta.url));
const T = { timeout: 15000 };
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CLOSING = 'All done. The tests pass! See `code` here.';
const SPOKEN = 'All done. The tests pass! See here.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await sleep(20);
  }
}
function alive(pid) {
  try {
    process.kill(pid, 0);
  } catch (e) {
    if (e.code === 'ESRCH') return false;
  }
  try {
    return !/^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return false;
  }
}
const files = (dir, prefix) => fs.readdirSync(dir).filter((f) => f.startsWith(`${prefix}.`) && !f.startsWith('.tmp'));
const texts = (dir) => files(dir, 'text').map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
const pidsOf = (dir) => files(dir, 'pid').map((f) => Number(f.split('.')[1]));
const kidsOf = (dir) => files(dir, 'child').map((f) => Number(fs.readFileSync(path.join(dir, f), 'utf8')));

// runs fn(c, dir) with a server (dev bridge, selected session A) and a stand-in engine writing into dir
async function withServer(opts, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-speech-'));
  const engine = { name: 'fake', stages: [[FAKE, dir]], needs: [] };
  const speech = opts.speech === null ? null : { engine, speakOnStop: false, killWaitMs: 200, ...opts.speech };
  let s;
  try {
    s = await startLiveServer({ port: 0, devBridge: true, ...opts, speech });
    const post = (body) => fetch(`${s.url}/event`, { method: 'POST', body: JSON.stringify(body) });
    const ev = async (e) => assert.equal((await post(e)).status, 204);
    const key = async (code, holdMs = 0) => {
      const n = s.gestures().length;
      await fetch(`${s.url}/dev/key`, { method: 'POST', body: JSON.stringify({ code, type: 'down' }) });
      if (holdMs) await sleep(holdMs);
      await fetch(`${s.url}/dev/key`, { method: 'POST', body: JSON.stringify({ code, type: 'up' }) });
      await until(() => s.gestures().length > n, 'a gesture');
      await sleep(60);
    };
    await ev({ hook_event_name: 'SessionStart', session_id: A, cwd: '/w/a' });
    await ev({ hook_event_name: 'SessionStart', session_id: B, cwd: '/w/b' });
    s.select(A);
    assert.equal(s.selected(), A);
    await fn({ s, dir, post, ev, key, tap: () => key('F14'), hold: () => key('F14', 600) });
  } finally {
    if (s) await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const stop = (id, msg = CLOSING) => ({ hook_event_name: 'Stop', session_id: id, last_assistant_message: msg });

test('a tap reads the selected session closing words', T, () => withServer({}, async (c) => {
  await c.ev(stop(A));
  await c.tap();
  const [t] = await until(() => (texts(c.dir).length ? texts(c.dir) : null), 'the spoken text');
  assert.equal(t, `${SPOKEN}\n`);
}));

test('a hold stops the speech: the stand-in and its sleep child are dead', T, () => withServer({}, async (c) => {
  await c.ev(stop(A));
  await c.tap();
  const [pid] = await until(() => (pidsOf(c.dir).length && kidsOf(c.dir).length ? pidsOf(c.dir) : null), 'the stand-in');
  const [kid] = kidsOf(c.dir);
  assert.ok(alive(pid));
  await c.hold();
  await until(() => !alive(pid) && !alive(kid), 'the stand-in to be dead');
}));

test('speakOnStop: the selected session Stop speaks without a tap; another session does not', T, () => withServer({ speech: { speakOnStop: true } }, async (c) => {
  await c.ev(stop(B, 'Other session done.'));
  await sleep(400);
  assert.deepEqual(texts(c.dir), []);
  await c.ev(stop(A));
  const [t] = await until(() => (texts(c.dir).length ? texts(c.dir) : null), 'the spoken text');
  assert.equal(t, `${SPOKEN}\n`);
}));

test('without speakOnStop a Stop alone is silent', T, () => withServer({}, async (c) => {
  await c.ev(stop(A));
  await sleep(400);
  assert.deepEqual(texts(c.dir), []);
}));

test('close() kills a running stand-in', T, async () => {
  let pid;
  let kid;
  await withServer({}, async (c) => {
    await c.ev(stop(A));
    await c.tap();
    await until(() => (pidsOf(c.dir).length && kidsOf(c.dir).length), 'the stand-in');
    pid = pidsOf(c.dir)[0];
    kid = kidsOf(c.dir)[0];
    assert.ok(alive(pid));
    await c.s.close();
    // The stand-in's own exit is awaited by close(); its sleep child gets the same signal
    // but node does not wait for it, so poll (same as the hold test above).
    await until(() => !alive(pid), 'the stand-in to be dead after close()');
    await until(() => !alive(kid), 'its sleep child to be dead after close()');
  });
});

test('RevviewButton over HTTP without the dev bridge is 403 and nothing is spoken', T, () => withServer({ devBridge: false }, async (c) => {
  await c.ev(stop(A));
  const r = await c.post({ hook_event_name: 'RevviewButton', button: 'read-aloud', gesture: 'tap' });
  assert.equal(r.status, 403);
  await sleep(400);
  assert.deepEqual(texts(c.dir), []);
  assert.deepEqual(c.s.gestures(), []);
}));

test('speech: null: a read-aloud tap does nothing', T, () => withServer({ speech: null }, async (c) => {
  await c.ev(stop(A));
  await c.tap();
  await sleep(300);
  assert.deepEqual(texts(c.dir), []);
  assert.equal(c.s.state().note ?? null, null);
}));

test('parseArgs: --speech file and REVVIEW_SPEECH', () => {
  assert.equal(parseArgs(['--speech', '/x/s.json']).speech, '/x/s.json');
  assert.throws(() => parseArgs(['--speech']), /--speech needs a file/);
  assert.throws(() => parseArgs(['--speech', '--sessions']), /--speech needs a file/);
  const old = process.env.REVVIEW_SPEECH;
  try {
    delete process.env.REVVIEW_SPEECH;
    assert.equal(parseArgs([]).speech, undefined);
    process.env.REVVIEW_SPEECH = '/env/s.json';
    assert.equal(parseArgs([]).speech, '/env/s.json');
    assert.equal(parseArgs(['--speech', '/x/s.json']).speech, '/x/s.json');
  } finally {
    if (old === undefined) delete process.env.REVVIEW_SPEECH;
    else process.env.REVVIEW_SPEECH = old;
  }
});

// POST /permission is the only way a PermissionRequest arrives in the real server
const ASK = {
  hook_event_name: 'PermissionRequest', session_id: A, tool_name: 'AskUserQuestion',
  tool_input: { questions: [{ question: 'Which colour should the new file use?', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: 'r' }, { label: 'Green', description: 'g' }] }] },
};
// a main-thread request needs a running turn: the prompt first, then the request as the hook posts it
const permit = async (c, body) => {
  await c.ev({ hook_event_name: 'UserPromptSubmit', session_id: body.session_id, prompt: 'go' });
  return fetch(`${c.s.url}/permission`, { method: 'POST', body: JSON.stringify(body) });
};

test('speakOnStop: a question posted to /permission is read out by itself', T, () => withServer({ speech: { speakOnStop: true } }, async (c) => {
  assert.equal((await permit(c, ASK)).status, 204);
  const [t] = await until(() => (texts(c.dir).length ? texts(c.dir) : null), 'the spoken question');
  assert.match(t, /Which colour should the new file use\?/);
  assert.match(t, /Red/);
}));

test('a question on /permission is silent without speakOnStop', T, () => withServer({}, async (c) => {
  assert.equal((await permit(c, ASK)).status, 204);
  await sleep(400);
  assert.deepEqual(texts(c.dir), []);
}));

test('speakOnStop: a question of another session, and an ordinary permission request, are not read out', T, () => withServer({ speech: { speakOnStop: true } }, async (c) => {
  assert.equal((await permit(c, { ...ASK, session_id: B })).status, 204);
  assert.equal((await permit(c, { hook_event_name: 'PermissionRequest', session_id: A, tool_name: 'Bash', tool_input: { command: 'ls' } })).status, 204);
  await sleep(400);
  assert.deepEqual(texts(c.dir), []);
}));
