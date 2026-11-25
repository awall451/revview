// The demo player: posts the demo loop (emulator/demo/scenes.js) to a running revview server (--dev-bridge --dev-demo)
// at a watchable pace, and follows the demo keys the page sends (GET /dev/demo): 1-9 and 0 (= 10) jump to a scene, P pause/continue,
// [ slower, ] faster. Dev only, for the laptop emulator; never part of the product.
//   node emulator/demo/player.js --url http://127.0.0.1:8138
// Exits 0 when the server goes away (its demo stream closes, or a POST cannot connect) and on SIGTERM/SIGINT.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { buildLoop, endLoop, clearOverlays } from './scenes.js';

export const SPEEDS = Object.freeze([0.25, 0.5, 1, 2, 4]);
const DEFAULT_SPEED = SPEEDS.indexOf(1);

// POST one event; rejects when the server cannot be reached, resolves with the HTTP status otherwise.
function postHttp(url, event) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(event);
    const req = http.request(`${url}/event`, { method: 'POST', agent: false, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}

export function createPlayer({ url, clock = { setTimeout, clearTimeout }, post = (event) => postHttp(url, event), log = (m) => console.log(m), gapMs = 1500, holdMs = 5000 }) {
  let loop = 1;
  let scenes = buildLoop(loop);
  let si = 0; // the next step to post: scene si, step ti
  let ti = 0;
  let speed = DEFAULT_SPEED;
  let paused = false;
  let stopped = false;
  let gen = 0; // a jump starts a new run: steps of the old one are dropped
  let inflight = Promise.resolve();
  let pending = null; // { g, base, fn, holding }: what comes next, and its unscaled delay
  let timer = null;
  let sse = null;
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });

  const live = (g) => !stopped && g === gen;
  const delayOf = (base) => (base === 0 ? 0 : base / SPEEDS[speed]);

  function arm() {
    if (timer !== null) { clock.clearTimeout(timer); timer = null; }
    if (pending === null || paused || stopped) return;
    const { g, fn, base } = pending;
    timer = clock.setTimeout(() => {
      timer = null;
      pending = null;
      if (live(g)) track(fn(g));
    }, delayOf(base));
  }
  function schedule(g, base, fn, holding = false) {
    pending = { g, base, fn, holding };
    arm();
  }

  function finish() {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    pending = null;
    sse?.destroy();
    resolveDone();
  }

  // One POST; false when the run was replaced meanwhile (or the server is gone, which ends the player).
  async function send(g, event) {
    if (!live(g)) return false;
    try {
      const status = await post(event);
      if (typeof status === 'number' && status >= 300) log(`demo: POST ${event.hook_event_name} answered ${status}`);
    } catch {
      finish();
      return false;
    }
    return live(g);
  }
  function track(p) {
    inflight = p.catch(() => {});
    return inflight;
  }

  // The step at (si, ti) was just posted: schedule the next one, the hold after a scene's target, or the loop's end.
  function afterStep(g) {
    const scene = scenes[si];
    ti++;
    if (ti < scene.steps.length) return schedule(g, scene.steps[ti].gap ?? gapMs, playStep);
    si++;
    ti = 0;
    schedule(g, holdMs, si < scenes.length ? playStep : nextLoop, true);
  }

  async function playStep(g) {
    const scene = scenes[si];
    if (ti === 0) log(`demo: ${si + 1} ${scene.name}`);
    if (!await send(g, scene.steps[ti].event)) return;
    afterStep(g);
  }

  async function closeLoop(g) {
    for (const ev of [...endLoop(loop), ...clearOverlays()]) if (!await send(g, ev)) return false;
    loop++;
    scenes = buildLoop(loop);
    si = 0;
    ti = 0;
    return true;
  }

  async function nextLoop(g) {
    if (!await closeLoop(g)) return;
    await playStep(g);
  }

  async function jumpTo(g, n) {
    await inflight;
    if (!live(g) || !await closeLoop(g)) return;
    for (let s = 0; s < n; s++) {
      for (const step of scenes[s].steps) if (!await send(g, step.event)) return;
    }
    si = n - 1;
    ti = scenes[si].steps.length - 1;
    log(`demo: ${n} ${scenes[si].name}`);
    afterStep(g);
  }

  function jump(n) {
    if (stopped || !Number.isInteger(n) || n < 1 || n > scenes.length) return Promise.resolve();
    gen++;
    pending = null;
    arm();
    return track(jumpTo(gen, n));
  }

  function togglePause() {
    paused = !paused;
    arm();
    return paused;
  }
  function setSpeed(i) {
    speed = Math.min(SPEEDS.length - 1, Math.max(0, i));
    arm();
    return SPEEDS[speed];
  }

  function handleKey(code) {
    const m = /^Digit([0-9])$/.exec(code);
    if (m) return jump(Number(m[1]) === 0 ? 10 : Number(m[1]));
    if (code === 'KeyP') togglePause();
    else if (code === 'BracketLeft') setSpeed(speed - 1);
    else if (code === 'BracketRight') setSpeed(speed + 1);
    return undefined;
  }

  function listen() {
    const req = http.get(`${url}/dev/demo`, { agent: false }, (res) => {
      if (res.statusCode !== 200) {
        log(`demo: keys unavailable (GET /dev/demo answered ${res.statusCode})`);
        res.resume();
        return;
      }
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = block.split('\n').find((l) => l.startsWith('data:'));
          if (line === undefined) continue;
          try { handleKey(JSON.parse(line.slice(5)).code); } catch { /* not a key message */ }
        }
      });
      res.on('end', finish);
      res.on('close', finish);
      res.on('error', finish);
    });
    req.on('error', finish);
    return req;
  }

  return {
    done,
    start() {
      if (sse !== null || stopped) return;
      sse = listen();
      track(playStep(gen));
    },
    stop: finish,
    jump,
    togglePause,
    slower: () => setSpeed(speed - 1),
    faster: () => setSpeed(speed + 1),
    handleKey,
    // resolves when nothing is being posted any more (the next step waits on the clock)
    idle: async () => { let p; do { p = inflight; await p; } while (p !== inflight); },
    status: () => ({ loop, scene: si, step: ti, speed: SPEEDS[speed], paused, stopped, holding: pending?.holding === true, next: pending === null ? null : delayOf(pending.base) }),
  };
}

function main(argv) {
  const i = argv.indexOf('--url');
  const url = i >= 0 ? argv[i + 1] : undefined;
  if (url === undefined || !/^http:\/\/[^/]+$/.test(url)) {
    console.error('usage: node emulator/demo/player.js --url http://127.0.0.1:PORT');
    process.exit(2);
  }
  const player = createPlayer({ url });
  const quit = () => player.stop();
  process.on('SIGTERM', quit);
  process.on('SIGINT', quit);
  player.start();
  player.done.then(() => process.exit(0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
