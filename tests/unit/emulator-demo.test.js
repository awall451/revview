import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { startLiveServer, parseArgs, DEMO_CODES } from '../../src/server/index.js';
import { loadConfig } from '../../src/input/keymap.js';
import { BROWSER_CODES } from '../../src/input/keys.js';
import { createPlayer, SPEEDS } from '../../emulator/demo/player.js';
import { buildLoop, clearOverlays } from '../../emulator/demo/scenes.js';

// The laptop demo (emulator/demo): the player posts the real recordings to a live server with a FAKE clock
// (timers run only when a test fires them), the demo keys come back over GET /dev/demo.
const LAPTOP = fileURLToPath(new URL('../../config/buttons.laptop.json', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP = 1500;
const HOLD = 5000;

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const queue = new Map();
  return {
    setTimeout: (fn, ms) => { const id = nextId++; queue.set(id, { at: now + ms, id, fn }); return id; },
    clearTimeout: (id) => { queue.delete(id); },
    size: () => queue.size,
    delays: () => [...queue.values()].map((t) => t.at - now),
    runNext() {
      const due = [...queue.values()].sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) return false;
      queue.delete(due.id);
      now = due.at;
      due.fn();
      return true;
    },
  };
}

async function until(fn, what = 'condition', ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await sleep(10);
  }
}

async function demoServer(extra = {}) {
  const live = await startLiveServer({ port: 0, devBridge: true, devKeys: loadConfig(LAPTOP), devDemo: true, ...extra });
  return { live, url: `http://127.0.0.1:${live.port}` };
}
const get = async (url, p) => (await fetch(`${url}${p}`)).json();
async function shown(url) {
  const { state } = await get(url, '/state');
  return { view: state.view, sessions: state.view === 'ended' ? 0 : state.others + 1, offline: state.offline, locked: state.locked, compacting: state.compacting, tool: state.tool, file: state.file };
}
function newPlayer(url, lines = []) {
  const clock = fakeClock();
  const player = createPlayer({ url, clock, log: (m) => lines.push(m), gapMs: GAP, holdMs: HOLD });
  return { clock, player, lines };
}
const key = (url, code, extra = {}) => fetch(`${url}/dev/key`, { method: 'POST', body: JSON.stringify({ code, type: 'down', ...extra }) });

test('playing through: every scene reaches the state the bar shows, then the loop restarts cleanly', async () => {
  const { live, url } = await demoServer();
  const { clock, player, lines } = newPlayer(url);
  try {
    player.start();
    const expects = buildLoop(1).map((s) => s.expect);
    for (const [i, expect] of expects.entries()) {
      for (;;) {
        await player.idle();
        if (player.status().holding) break;
        assert.ok(clock.runNext(), `a timer is pending before scene ${i + 1}`);
      }
      const s = await shown(url);
      assert.deepEqual({ view: s.view, sessions: s.sessions, ...(expect.compacting ? { compacting: true } : {}) }, expect, `scene ${i + 1} ${buildLoop(1)[i].name}`);
      if (!expect.compacting) assert.ok(!s.compacting, `scene ${i + 1} is not compacting`);
      assert.equal(player.status().loop, 1);
      clock.runNext(); // the hold ends
    }
    // loop 2 has started: scene 1 again, three sessions, nothing left of loop 1
    await player.idle();
    assert.equal(player.status().loop, 2);
    for (;;) {
      await player.idle();
      if (player.status().holding) break;
      clock.runNext();
    }
    const s1 = await shown(url);
    assert.deepEqual({ view: s1.view, sessions: s1.sessions, offline: s1.offline, locked: s1.locked, compacting: s1.compacting }, { view: 'working', sessions: 3, offline: false, locked: false, compacting: false });
    const names = ['working', 'permission', 'done', 'waiting', 'offline', 'insert-key', 'ended', 'compaction', 'compact-cmd', 'asking'];
    assert.deepEqual(lines.slice(0, names.length + 1), [...names, 'working'].map((n, i) => `demo: ${(i % names.length) + 1} ${n}`));
  } finally {
    player.stop();
    await live.close();
  }
});

test('jump(n) reaches scene n for every n, from any state, and leaves no overlay behind', async () => {
  const { live, url } = await demoServer();
  const { player } = newPlayer(url);
  try {
    player.start();
    await player.idle();
    const expects = buildLoop(1).map((s) => s.expect);
    // descending, then ascending: the old loop's sessions and overlays must not leak into the next scene
    for (const n of [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      await player.jump(n);
      const s = await shown(url);
      assert.deepEqual({ view: s.view, sessions: s.sessions, ...(expects[n - 1].compacting ? { compacting: true } : {}) }, expects[n - 1], `jump ${n}`);
      assert.equal(s.offline, n === 5, `offline after jump ${n}`);
      assert.equal(s.locked, n === 6, `locked after jump ${n}`);
    }
    await player.jump(0);
    await player.jump(11);
    await player.jump(1.5);
    assert.equal((await shown(url)).view, 'asking', 'jumps outside 1..10 do nothing (scene 10 stays)');
  } finally {
    player.stop();
    await live.close();
  }
});

test('a jump drops the old run: its pending step never posts, pacing continues from the jump', async () => {
  const { live, url } = await demoServer();
  const { clock, player, lines } = newPlayer(url);
  try {
    player.start();
    await player.idle();
    await player.jump(3);
    assert.equal(clock.size(), 1);
    assert.deepEqual(clock.delays(), [HOLD]);
    clock.runNext(); // hold over: scene 4 starts
    await player.idle();
    assert.equal(lines.at(-1), 'demo: 4 waiting');
    for (;;) { await player.idle(); if (player.status().holding) break; clock.runNext(); }
    assert.equal((await shown(url)).view, 'waiting');
  } finally {
    player.stop();
    await live.close();
  }
});

test('pause stops progress, continue resumes', async () => {
  const { live, url } = await demoServer();
  const { clock, player } = newPlayer(url);
  try {
    player.start();
    await player.idle();
    const before = player.status();
    assert.equal(player.togglePause(), true);
    assert.equal(clock.size(), 0, 'no timer while paused');
    assert.equal(clock.runNext(), false);
    assert.deepEqual({ scene: player.status().scene, step: player.status().step }, { scene: before.scene, step: before.step });
    assert.equal(player.togglePause(), false);
    assert.equal(clock.size(), 1);
    clock.runNext();
    await player.idle();
    assert.ok(player.status().scene > before.scene || player.status().step > before.step, 'progress after continue');
  } finally {
    player.stop();
    await live.close();
  }
});

test('[ and ] change the gap (and the hold) by the speed steps', async () => {
  const { live, url } = await demoServer();
  const { clock, player } = newPlayer(url);
  try {
    assert.deepEqual(SPEEDS, [0.25, 0.5, 1, 2, 4]);
    player.start();
    await player.idle();
    while (clock.delays()[0] === 0) { clock.runNext(); await player.idle(); } // the setup steps have no gap
    assert.deepEqual(clock.delays(), [GAP]);
    player.handleKey('BracketLeft');
    assert.deepEqual(clock.delays(), [GAP * 2]);
    player.handleKey('BracketLeft');
    player.handleKey('BracketLeft');
    player.handleKey('BracketLeft');
    assert.deepEqual(clock.delays(), [GAP * 4], 'slowest is 0.25');
    assert.equal(player.status().speed, 0.25);
    for (let i = 0; i < 6; i++) player.handleKey('BracketRight');
    assert.deepEqual(clock.delays(), [GAP / 4], 'fastest is 4');
    player.handleKey('BracketLeft');
    player.handleKey('BracketLeft');
    assert.deepEqual(clock.delays(), [GAP]);
    await player.jump(2);
    assert.deepEqual(clock.delays(), [HOLD], 'the hold after a target at speed 1');
    player.faster();
    assert.deepEqual(clock.delays(), [HOLD / 2]);
  } finally {
    player.stop();
    await live.close();
  }
});

test('a demo key typed in the page reaches the player over /dev/demo and is not fed to the bridge', async () => {
  const { live, url } = await demoServer();
  const { player } = newPlayer(url);
  try {
    player.start();
    await player.idle();
    const gestures = (await get(url, '/buttons')).gestures;
    // the stream may not be connected yet: the jump is idempotent, so retry until it took
    await until(async () => {
      assert.equal((await key(url, 'Digit2')).status, 204);
      await player.idle();
      return (await shown(url)).view === 'permission';
    }, 'Digit2 -> permission');
    // a repeat and a key-up do nothing
    await key(url, 'Digit5', { repeat: true });
    await fetch(`${url}/dev/key`, { method: 'POST', body: JSON.stringify({ code: 'Digit5', type: 'up' }) });
    await sleep(50);
    await player.idle();
    assert.equal((await shown(url)).view, 'permission');
    // pause and speed over the stream too
    await key(url, 'KeyP');
    await until(() => player.status().paused, 'P pauses');
    await key(url, 'BracketRight');
    await until(() => player.status().speed === 2, '] faster');
    assert.deepEqual((await get(url, '/buttons')).gestures, gestures, 'the bridge saw none of the demo keys');
  } finally {
    player.stop();
    await live.close();
  }
});

test('the server going away ends the player', async () => {
  const { live, url } = await demoServer();
  const { player } = newPlayer(url);
  player.start();
  await player.idle();
  await live.close();
  await player.done;
  assert.equal(player.status().stopped, true);
});

test('a POST that cannot connect ends the player', async () => {
  const { live, url } = await demoServer();
  await live.close();
  const { player } = newPlayer(url);
  player.start();
  await player.done;
});

test('at most two demo streams, a third gets 503', async () => {
  const { live, url } = await demoServer();
  const ctl = [new globalThis.AbortController(), new globalThis.AbortController(), new globalThis.AbortController()];
  try {
    const a = await fetch(`${url}/dev/demo`, { signal: ctl[0].signal });
    const b = await fetch(`${url}/dev/demo`, { signal: ctl[1].signal });
    assert.deepEqual([a.status, b.status], [200, 200]);
    assert.equal(a.headers.get('content-type'), 'text/event-stream');
    const c = await fetch(`${url}/dev/demo`, { signal: ctl[2].signal });
    assert.equal(c.status, 503);
  } finally {
    ctl.forEach((c) => c.abort());
    await live.close();
  }
});

test('the stream carries {code} for a demo key down, nothing for a repeat', async () => {
  const { live, url } = await demoServer();
  const ctl = new globalThis.AbortController();
  try {
    const res = await fetch(`${url}/dev/demo`, { signal: ctl.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let text = '';
    const read = async (until_) => { while (!text.includes(until_)) { const { value, done } = await reader.read(); if (done) break; text += dec.decode(value); } };
    await key(url, 'Digit3', { repeat: true });
    await key(url, 'Digit3');
    await read('data:');
    assert.match(text, /^retry: 1000\n\ndata: \{"code":"Digit3"\}\n\n$/);
  } finally {
    ctl.abort();
    await live.close();
  }
});

test('without devDemo: no /dev/demo route, and the demo codes go the old way', async () => {
  const live = await startLiveServer({ port: 0, devBridge: true, devKeys: loadConfig(LAPTOP) });
  const url = `http://127.0.0.1:${live.port}`;
  try {
    const unknown = await fetch(`${url}/dev/nothing-here`);
    const demo = await fetch(`${url}/dev/demo`);
    assert.equal(demo.status, unknown.status);
    assert.equal(await demo.text(), await unknown.text());
    for (const code of DEMO_CODES) assert.equal((await key(url, code)).status, 204);
    assert.deepEqual((await get(url, '/buttons')).gestures, [], 'unbound codes: ignored as before');
  } finally {
    await live.close();
  }
});

test('--dev-demo needs --dev-bridge; with it the flag is set', () => {
  assert.throws(() => parseArgs(['--dev-demo']), /--dev-demo needs --dev-bridge/);
  assert.equal(parseArgs(['--dev-bridge', '--dev-demo']).devDemo, true);
  assert.notEqual(parseArgs(['--dev-bridge']).devDemo, true);
});

test('DEMO_CODES: Digit1-9 and Digit0, P, [ and ], none of them bound in the laptop key map', () => {
  assert.deepEqual([...DEMO_CODES], [...'1234567890'].map((d) => `Digit${d}`).concat(['KeyP', 'BracketLeft', 'BracketRight']));
  const bound = new Set(loadConfig(LAPTOP).bindings.map((b) => b.key));
  for (const code of DEMO_CODES) {
    const linux = Object.hasOwn(BROWSER_CODES, code) ? BROWSER_CODES[code] : undefined;
    assert.ok(linux === undefined || !bound.has(linux), `${code} is bound in config/buttons.laptop.json`);
  }
});

test('scenes: ids are fresh per loop, overlays are cleared by the loop end, Claude events come from the recordings', () => {
  const ids = (loop) => new Set(buildLoop(loop).flatMap((s) => s.steps.map((x) => x.event.session_id)).filter(Boolean));
  const [one, two] = [ids(1), ids(2)];
  assert.equal(one.size, 4, 'three sessions and the compaction one');
  for (const id of one) assert.ok(!two.has(id));
  assert.deepEqual(clearOverlays().map((e) => e.hook_event_name), ['RevviewNetwork', 'RevviewDataLock']);
  const names = new Set(buildLoop(1).flatMap((s) => s.steps.map((x) => x.event.hook_event_name)));
  for (const n of names) assert.ok(!n.startsWith('Revview') || ['RevviewContext', 'RevviewNetwork', 'RevviewDataLock'].includes(n), n);
});

test('compaction scenes: the real recording, events 0-8 and 9-20, one session re-addressed to revview, "Compacting context" on the bar', async () => {
  const rec = fs.readFileSync(new URL('../../fixtures/sessions/compaction.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const [auto, cmd] = buildLoop(1).slice(7);
  assert.deepEqual([auto.name, cmd.name], ['compaction', 'compact-cmd']);
  const claude = (scene) => scene.steps.map((x) => x.event).filter((e) => !e.hook_event_name.startsWith('Revview'));
  const key = (e) => [e.hook_event_name, e.source, e.trigger, e.tool_name].join('/');
  assert.deepEqual(claude(auto).map(key), rec.slice(0, 9).map(key));
  assert.deepEqual(claude(cmd).map(key), rec.slice(9, 21).map(key));
  assert.deepEqual(claude(auto).at(-1).hook_event_name, 'SubagentStop');
  assert.deepEqual(claude(cmd).slice(-2).map((e) => e.hook_event_name + (e.trigger ?? '')), ['PreCompactmanual', 'SubagentStop']);
  for (const e of [...claude(auto), ...claude(cmd)]) {
    assert.equal(e.session_id, 'demo1-compaction');
    assert.ok(e.cwd === undefined || e.cwd === '/home/user/revview');
  }
  const ok = ['RevviewContext'];
  for (const e of [...auto.steps, ...cmd.steps].map((x) => x.event)) assert.ok(!e.hook_event_name.startsWith('Revview') || ok.includes(e.hook_event_name));
  assert.deepEqual([auto.expect, cmd.expect], [{ view: 'working', sessions: 1, compacting: true }, { view: 'done', sessions: 1, compacting: true }]);
  // /state carries the mark (the words are the view's: emulator/tests/demo-keys.spec.js)
  const { live, url } = await demoServer();
  const { player } = newPlayer(url);
  try {
    player.start();
    await player.idle();
    await player.jump(8);
    let s = await shown(url);
    assert.deepEqual([s.view, s.compacting], ['working', true]);
    await player.jump(9);
    s = await shown(url);
    assert.deepEqual([s.view, s.compacting], ['done', true]);
    await player.jump(7);
    assert.equal((await shown(url)).compacting, false, 'ending the sessions clears it');
  } finally {
    player.stop();
    await live.close();
  }
});

test('asking scenes: the real ask-question recording, events 1-4, in the compaction session; the bar shows the question', async () => {
  const rec = fs.readFileSync(new URL('../../fixtures/sessions/ask-question.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const [asking, ...more] = buildLoop(1).slice(9);
  assert.equal(asking.name, 'asking');
  assert.equal(more.length, 0, 'asking is the last scene');
  const claude = (scene) => scene.steps.map((x) => x.event).filter((e) => !e.hook_event_name.startsWith('Revview'));
  const key = (e) => [e.hook_event_name, e.tool_name, e.notification_type].join('/');
  assert.deepEqual(claude(asking).map(key), rec.slice(1, 5).map(key));
  for (const e of claude(asking)) assert.equal(e.session_id, 'demo1-compaction');
  assert.deepEqual(asking.expect, { view: 'asking', sessions: 1 });
  const { live, url } = await demoServer();
  const { player } = newPlayer(url);
  try {
    player.start();
    await player.idle();
    await player.jump(10);
    const { state } = await get(url, '/state');
    assert.equal(state.view, 'asking');
    assert.equal(state.tool, 'AskUserQuestion');
    assert.equal(state.ask.kind, 'question');
    assert.ok(state.ask.options.length > 0);
    assert.equal(state.compacting, false);
    // the demo key 0 is scene 10
    await player.jump(1);
    await player.handleKey('Digit0');
    assert.equal((await shown(url)).view, 'asking');
  } finally {
    player.stop();
    await live.close();
  }
});
