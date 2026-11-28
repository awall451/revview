// A whole drive in the emulator: the recorded sessions replayed for a simulated 4 hours (by default) against the REAL
// server (its own process) and the REAL bar page in Playwright's Chromium, with disturbances on the way (server killed
// and restarted, event stream dropped, network lost, clock jumped), and page memory, DOM size and server memory
// measured along the way. Run on request, never by tools/check:  bash tools/long-drive [options]  (docs/LONG-DRIVE.md)
//
//   --sim-hours H    simulated hours (default 4)
//   --speedup X      simulated seconds per wall second (default 30: 4 h take about 8 minutes of running time)
//   --streams N      sessions replayed at once (default 4)
//   --samples N      measurement points between start and end (default 7, evenly spread)
//   --out DIR        logs and long-drive.json go here (default /tmp/long-drive)
//   --cpu-load N     N busy loops (nice 5) run beside the drive and the server (default 0)
//   --smoke          a short pass to see that the tool works: 1/3 simulated hour at 60x, but the simulated clock runs
//                    on through the outages (wall seconds, 60x), so it simulates about 65 minutes in about a minute
/* global document */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';
import { encodeWs2812 } from '../../src/lights/ws2812.js';
import { createReplay, loadSessions, postEvent, DEFAULTS } from './replay.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- everything the drive starts (the server, Chromium) is stopped on every way out: the normal end, a thrown error, a
// failed run, SIGINT/SIGTERM/SIGHUP, and process 'exit'. The server and Chromium each lead their own process group, so
// the whole group is killed. If the drive itself is killed (SIGKILL) nothing can run here: the server then ends when its
// stdin pipe closes (clock-skew.js) and Chromium ends when its DevTools pipe closes.
const started = new Set(); // pids of group leaders
function killGroup(pid) {
  try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
}
function killAll() {
  for (const pid of started) killGroup(pid);
  started.clear();
}
let launching = null; // the pending chromium.launch, so a signal that comes during it can still stop that browser
const browserPids = new Set();
function trackBrowser() { // this Playwright has no browser.process(): the browser is the child of ours that is not tracked yet
  for (const n of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(n)) continue;
    try {
      const ppid = Number(fs.readFileSync(`/proc/${n}/stat`, 'utf8').replace(/^.*\) \S+ /, '').split(' ')[0]);
      if (ppid === process.pid && !started.has(Number(n))) { started.add(Number(n)); browserPids.add(Number(n)); }
    } catch { /* gone */ }
  }
}
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  process.on(sig, async () => {
    killAll();
    if (launching) { try { await launching, trackBrowser(); } catch { /* it did not start */ } killAll(); }
    process.exit(code);
  });
}
process.on('exit', killAll);

// The state word the page shows for each view (the spec; same table as emulator/tests/live.spec.js).
const LABELS = {
  working: 'WORKING', waiting: 'WAITING FOR ME', permission: 'NEEDS PERMISSION', asking: 'CLAUDE ASKS', done: 'DONE',
  starting: 'STARTING', offline: 'OFFLINE', 'insert-key': 'INSERT KEY',
  unknown: 'UNKNOWN', ended: 'CLAUDE EXITED', 'no-link': 'NO LINK',
};

const ASK_WORDS = { AskUserQuestion: 'Question', ExitPlanMode: 'Plan' }; // row A under CLAUDE ASKS (src/view/view.js)
const NIGHT = { from: '21:00', to: '23:00' }; // the look config's night, in the server's simulated local time

// Disturbances, as a fraction of the simulated run. `down` and `out` are WALL milliseconds.
const PLAN = [
  { at: 0.08, kind: 'sse-reset' },
  { at: 0.20, kind: 'server-kill', down: 3000 },
  { at: 0.33, kind: 'clock-jump', ms: 6 * 3600 * 1000 },
  { at: 0.46, kind: 'network-loss', out: 25000 },
  { at: 0.58, kind: 'server-term', down: 2000 },
  { at: 0.70, kind: 'clock-jump', ms: -2 * 3600 * 1000 },
  { at: 0.80, kind: 'server-kill', down: 20000 },
  { at: 0.90, kind: 'sse-drop', out: 4000 },
];

export function parseArgs(argv) {
  const o = { simHours: 4, speedup: 30, streams: DEFAULTS.streams, samples: 7, out: '/tmp/long-drive', smoke: false, cpuLoad: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === '--sim-hours') o.simHours = Number(val());
    else if (a === '--speedup') o.speedup = Number(val());
    else if (a === '--streams') o.streams = Number(val());
    else if (a === '--samples') o.samples = Number(val());
    else if (a === '--out') o.out = val();
    else if (a === '--cpu-load') o.cpuLoad = Number(val());
    else if (a === '--smoke') { o.smoke = true; o.simHours = 1 / 3; o.speedup = 60; o.samples = 2; }
    else throw new Error(`unknown option ${a}`);
  }
  for (const k of ['simHours', 'speedup', 'streams', 'samples']) if (!(o[k] > 0)) throw new Error(`--${k} must be a positive number`);
  if (!(o.cpuLoad >= 0 && o.cpuLoad <= 16)) throw new Error('--cpu-load must be 0 to 16');
  return o;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// A proxy between the page and the server, so the "network" can be cut: the page loads from the proxy, the proxy
// forwards to the server (with the Host and Origin the server expects). drop() destroys every connection of the page (an open event
// stream too); block(true) also refuses new ones until block(false). The replay posts to the server directly (on the
// Pi the hooks and the server are on the same machine; only the page's link is the one that can fail here).
function startProxy(target) {
  const sockets = new Set();
  let blocked = false;
  const srv = http.createServer((req, res) => {
    if (blocked) { req.socket.destroy(); return; }
    const up = http.request({ host: '127.0.0.1', port: target, method: req.method, path: req.url, agent: false, headers: { ...req.headers, host: `127.0.0.1:${target}`, ...(req.headers.origin ? { origin: `http://127.0.0.1:${target}` } : {}) } }, (ur) => {
      res.writeHead(ur.statusCode, ur.headers);
      ur.pipe(res);
      ur.on('close', () => { if (!ur.complete) res.destroy(); }); // the server went away mid-stream: the page sees the stream cut
    });
    up.on('error', () => res.destroy());
    res.on('close', () => up.destroy());
    req.pipe(up);
  });
  srv.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); if (blocked) s.destroy(); });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({
    port: srv.address().port,
    drop: () => { for (const s of sockets) s.destroy(); },
    block: (b) => { blocked = b; },
    close: () => { for (const s of sockets) s.destroy(); srv.close(); },
  })));
}

const procKb = (pid, field) => {
  try {
    const m = new RegExp(`^${field}:\\s+(\\d+) kB`, 'm').exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
    return m ? Number(m[1]) : null;
  } catch { return null; }
};

export async function main(argv) {
  try { return await drive(argv); } finally { killAll(); }
}

async function drive(argv) {
  const opt = parseArgs(argv);
  fs.mkdirSync(opt.out, { recursive: true });
  const skewFile = path.join(opt.out, 'skew-ms');
  fs.writeFileSync(skewFile, '0');
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`; // the server
  const totalSim = opt.simHours * 3600 * 1000;
  const log = (m) => console.log(`[${((performance.now() - t0) / 1000).toFixed(0).padStart(4)}s wall] ${m}`);
  const t0 = performance.now();

  // --- the server, as its own process
  let server = null;
  let serverStarts = 0;
  let skewMs = 0;
  const serverLog = fs.createWriteStream(path.join(opt.out, 'server.log'));
  // What the server is started with (cycle 81): the feature set of the appliance, with stand-ins for what needs hardware.
  // No --settings: the drive never changes a Settings choice, so a kept file would only hold what the config files say; every
  // restart reads the same config defaults, as the first run's restarts did. (settings.js is not exercised here.)
  const fakeState = path.join(opt.out, 'fake-state');
  fs.rmSync(fakeState, { recursive: true, force: true });
  fs.mkdirSync(fakeState, { recursive: true });
  const speechFile = path.join(opt.out, 'speech.json');
  const lookFile = path.join(opt.out, 'look.json');
  const lightsFile = path.join(opt.out, 'lights.json');
  fs.writeFileSync(speechFile, JSON.stringify({ engines: [], sounds: 'cues', cuePlayers: [['aplay', '-q']] }));
  fs.writeFileSync(lookFile, JSON.stringify({ look: 'auto', night: NIGHT }));
  fs.writeFileSync(lightsFile, JSON.stringify({ lights: 'on', leds: 8, driver: 'ws2812-spi', device: '/dev/spidev0.0', brightness: { day: 48, night: 12 } }));
  const simStart = new Date(); // the simulated wall clock of the server: today 20:30 local, so the night (21:00-23:00) starts after 30 and ends after 150 simulated minutes
  simStart.setHours(20, 30, 0, 0);
  const wallAnchor = Date.now();
  const diagFile = path.join(opt.out, 'diag.json');
  async function startServer() {
    serverStarts++;
    const child = spawn(process.execPath, [
      '--import', path.join(HERE, 'clock-skew.js'), path.join(ROOT, 'src/server/index.js'), String(port),
      '--dev-bridge', '--speech', speechFile, '--look-config', lookFile, '--lights-config', lightsFile,
    ], {
      cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], detached: true, // stdin: a pipe, whose close ends the server (clock-skew.js)
      env: {
        ...process.env, PATH: `${path.join(HERE, 'fake')}:${process.env.PATH}`, LONG_DRIVE_FAKE_DIR: fakeState,
        LONG_DRIVE_SKEW_FILE: skewFile, LONG_DRIVE_SKEW_MS: String(skewMs), LONG_DRIVE_DIAG: diagFile,
        LONG_DRIVE_SCALE: String(opt.speedup), LONG_DRIVE_SIM_START: String(simStart.getTime()), LONG_DRIVE_WALL_ANCHOR: String(wallAnchor),
      },
    });
    if (child.pid) started.add(child.pid);
    child.once('exit', () => started.delete(child.pid));
    child.stdout.pipe(serverLog, { end: false });
    child.stderr.pipe(serverLog, { end: false });
    child.exited = new Promise((r) => child.once('exit', r));
    server = child;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${url}/state`)).ok) return; } catch { /* not listening yet */ }
      await sleep(100);
    }
    throw new Error('the server did not start');
  }
  async function stopServer(signal) {
    const child = server;
    child.kill(signal);
    await child.exited;
  }
  const serverState = async () => (await fetch(`${url}/state`)).json();

  // --- the page
  launching = chromium.launch({ headless: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
  const browser = await launching;
  launching = null;
  trackBrowser();
  for (let i = 0; i < opt.cpuLoad; i++) { // CPU load beside the drive: busy loops, own process groups, stopped with everything else
    const b = spawn('nice', ['-n', '5', process.execPath, '-e', 'for(;;){}'], { stdio: 'ignore', detached: true });
    if (b.pid) { started.add(b.pid); b.once('exit', () => started.delete(b.pid)); }
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 400 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageProblems = { errors: [], consoleErrors: 0, consoleTexts: {}, crashed: false };
  page.on('pageerror', (e) => pageProblems.errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    pageProblems.consoleErrors++;
    const text = m.text().slice(0, 160);
    pageProblems.consoleTexts[text] = (pageProblems.consoleTexts[text] ?? 0) + 1; // what the errors were (refused connections while the server is away, ...)
  });
  page.on('crash', () => { pageProblems.crashed = true; });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  await startServer();
  if (process.env.LONG_DRIVE_FAULT === 'throw') { await sleep(2000); throw new Error('injected fault'); } // self-check of the cleanup (cleanup.test.js)
  const proxy = await startProxy(port);
  await page.goto(`http://127.0.0.1:${proxy.port}/`);
  await page.waitForFunction(() => document.documentElement.dataset.link === 'up', null, { timeout: 15000 });

  // --- what the page shows, and the comparison with the server's board
  const pageShows = () => page.evaluate(() => {
    const t = (id) => document.getElementById(id)?.textContent ?? null;
    return {
      link: document.documentElement.dataset.link ?? null,
      seq: document.documentElement.dataset.seq ?? null,
      view: document.body.dataset.view ?? null,
      look: document.documentElement.dataset.look ?? null,
      // a long path is shown cut in its middle (src/view/view.js fitFile); data-full holds the whole path the page has
      word: t('state-word'), tool: t('tool'), file: document.getElementById('file')?.dataset.full ?? null,
    };
  });
  function expectedFrom({ seq, state }) {
    const working = ['working', 'waiting', 'permission', 'done'].includes(state.view);
    const compacting = working && state.compacting === true;
    return {
      seq: String(seq), view: state.view, word: LABELS[state.view], look: state.look,
      ...(working ? { tool: compacting ? 'Compacting context' : state.tool || '', file: compacting ? '' : state.file || '' } : {}),
      // CLAUDE ASKS: the tool in row A (as emulator/tests/live.spec.js checks it); the file row is not used
      ...(state.view === 'asking' ? { tool: ASK_WORDS[state.tool] ?? state.tool ?? '' } : {}),
    };
  }
  const differs = (shown, want) => Object.keys(want).filter((k) => shown[k] !== want[k]);

  // --- the replay
  const replay = createReplay({ sessions: loadSessions(path.join(ROOT, 'fixtures/sessions')), post: (e) => postEvent(url, e), speedup: opt.speedup, streams: opt.streams });
  const ticker = setInterval(() => replay.tick(), 25);
  const simMin = () => replay.simNow() / 60000;
  async function untilSim(ms) { while (replay.simNow() < ms) await sleep(100); }

  // --- the stand-ins and the server's own diagnostics
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const procs = () => {
    const out = [];
    for (const n of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(n)) continue;
      try {
        const ppid = Number(fs.readFileSync(`/proc/${n}/stat`, 'utf8').replace(/^.*\) \S+ /, '').split(' ')[0]);
        out.push({ pid: Number(n), ppid, cmd: fs.readFileSync(`/proc/${n}/cmdline`, 'utf8').replace(/\0/g, ' ').trim() });
      } catch { /* gone */ }
    }
    return out;
  };
  const standIns = () => procs().filter((p) => /tests\/long\/fake\/(python3|aplay)/.test(p.cmd));
  const helperEvents = () => {
    try { return fs.readFileSync(path.join(fakeState, 'helper.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
  };
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const countLines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
  // The lights: the frame the server says it shows (GET /dev/lights) against what the fake helper last received (the
  // helper keeps the last 32 frames), and the brightness cap of the look the board is in. A helper that was stalled or
  // that died is not expected to match (the driver stops by design, "the LEDs stay off until the server restarts").
  async function lightsCheck(look) {
    const ev = helperEvents();
    const n = Math.max(0, ...ev.map((e) => e.n));
    const mine = ev.filter((e) => e.n === n);
    const helperPid = mine[0]?.pid;
    const expectMatch = mine.length === 1 && mine[0].mode === 'normal' && alive(helperPid);
    const cap = look === 'night' ? 12 : 48;
    let r = null;
    let max = 0;
    let match = false;
    for (let i = 0; i < 8 && !match; i++) {
      r = await (await fetch(`${url}/dev/lights`)).json();
      max = Math.max(0, ...r.frame.flat());
      const want = encodeWs2812(r.frame).toString('hex');
      let ring = [];
      try { ring = fs.readFileSync(path.join(fakeState, 'last-frames'), 'utf8').split('\n').slice(1); } catch { /* no frame yet */ }
      match = ring.includes(want);
      if (!match && expectMatch) await sleep(100); else break;
    }
    const ok = r.lights === 'on' && max <= cap && (!expectMatch || match);
    return { ok, board: r.lights, max, cap, match, expectMatch, helperStart: n, helperMode: mine[0]?.mode ?? null, helperLast: mine.at(-1)?.ev ?? null };
  }

  // Wait for the page to agree with the server's board while the replay is stopped. Returns how long it took (ms), or
  // null with the two views when it did not within `limitMs`.
  async function compare(label, limitMs = 20000) {
    replay.pause();
    await replay.drain();
    const t = performance.now();
    let shown = null;
    let want = null;
    let bad = ['unread'];
    while (performance.now() - t < limitMs) {
      try {
        want = expectedFrom(await serverState());
        shown = await pageShows();
        bad = differs(shown, want);
        if (bad.length === 0) break;
      } catch { bad = ['unreachable']; }
      await sleep(150);
    }
    let lights = null;
    try { lights = await lightsCheck(want?.look); } catch (e) { lights = { ok: false, error: String(e) }; }
    replay.resume();
    const ms = Math.round(performance.now() - t);
    if (!lights.ok) log(`${label}: LIGHTS ${JSON.stringify(lights)}`);
    if (bad.length === 0) { log(`${label}: page agrees with the server's board after ${ms} ms (view ${want.view}, look ${want.look}, seq ${want.seq}; lights ${lights.ok ? 'ok' : 'WRONG'})`); return { ok: lights.ok, ms, view: want.view, look: want.look, seq: want.seq, lights }; }
    log(`${label}: MISMATCH on ${bad.join(', ')} after ${ms} ms: page ${JSON.stringify(shown)} board ${JSON.stringify(want)}`);
    return { ok: false, ms, differs: bad, page: shown, board: want, lights };
  }

  // --- measurements
  async function measure(label) {
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    const before = await metrics();
    await cdp.send('HeapProfiler.collectGarbage');
    const after = await metrics();
    const domNodes = await page.evaluate(() => document.getElementsByTagName('*').length);
    let stateBytes = null;
    try { stateBytes = JSON.stringify((await serverState()).state).length; } catch { /* server away */ }
    const s = {
      label, simMin: Math.round(simMin()), wallS: Math.round((performance.now() - t0) / 1000), events: replay.stats.posted,
      serverRssKb: procKb(server.pid, 'VmRSS'), serverPeakRssKb: procKb(server.pid, 'VmHWM'),
      heapUsedKb: Math.round(before.JSHeapUsedSize / 1024), heapUsedAfterGcKb: Math.round(after.JSHeapUsedSize / 1024), heapTotalKb: Math.round(after.JSHeapTotalSize / 1024),
      domNodes, cdpNodes: after.Nodes, listeners: after.JSEventListeners, documents: after.Documents, stateBytes,
      serverFds: (() => { try { return fs.readdirSync(`/proc/${server.pid}/fd`).length; } catch { return null; } })(),
      serverChildren: procs().filter((p) => p.ppid === server.pid).map((p) => p.cmd.replace(/^\S*node\S* /, '').replace(ROOT, '.').slice(0, 60)),
      standIns: standIns().length, cues: countLines(path.join(fakeState, 'cues.log')), helperStarts: Number(readJson(path.join(fakeState, 'helper-spawns')) ?? 0),
      diag: readJson(diagFile), simClock: readJson(diagFile) ? new Date(readJson(diagFile).simNow).toTimeString().slice(0, 5) : null,
    };
    log(`measured ${label}: server RSS ${s.serverRssKb} kB, JS heap ${s.heapUsedKb} kB (${s.heapUsedAfterGcKb} kB after GC), DOM ${s.domNodes} nodes`);
    return s;
  }

  // --- the disturbances
  async function linkWatcher() {
    const seen = new Set();
    const timer = setInterval(() => { pageShows().then((p) => seen.add(`${p.link}/${p.view}`)).catch(() => {}); }, 150);
    return () => { clearInterval(timer); return [...seen]; };
  }
  async function disturb(d) {
    const stopWatch = await linkWatcher();
    const t = performance.now();
    if (d.kind === 'sse-reset' || d.kind === 'sse-drop' || d.kind === 'network-loss') {
      // the page's connections are cut (its open event stream too); for `out` ms new ones are refused as well.
      // The server and the replay go on.
      if (d.out) proxy.block(true);
      proxy.drop();
      if (d.out) { await sleep(d.out); proxy.block(false); }
    } else if (d.kind === 'server-kill' || d.kind === 'server-term') {
      await stopServer(d.kind === 'server-kill' ? 'SIGKILL' : 'SIGTERM');
      await sleep(d.down); // the replay keeps posting into the void: those events are lost, as hooks are
      await startServer();
    } else if (d.kind === 'clock-jump') {
      skewMs += d.ms;
      fs.writeFileSync(skewFile, String(skewMs));
      server.kill('SIGUSR2');
      await page.evaluate((off) => { const real = Date.now; Date.now = () => real() + off; }, d.ms); // the page's own clock
      await sleep(1500);
    }
    const recovered = performance.now();
    let upMs = null;
    while (performance.now() - recovered < 20000) {
      const p = await pageShows().catch(() => null);
      if (p?.link === 'up') { upMs = Math.round(performance.now() - recovered); break; }
      await sleep(100);
    }
    const seen = stopWatch();
    return { upMs, seen, tookMs: Math.round(performance.now() - t) };
  }

  // --- the run
  const results = { options: opt, samples: [], disturbances: [], startedAt: new Date().toISOString() };
  const sampleAt = Array.from({ length: opt.samples }, (_, i) => ((i + 1) / (opt.samples + 1)) * totalSim);
  const pending = [
    ...PLAN.map((d) => ({ at: d.at * totalSim, d })),
    ...sampleAt.map((at) => ({ at, sample: true })),
  ].sort((a, b) => a.at - b.at);

  results.samples.push(await measure('start'));
  results.startCheck = await compare('start');
  replay.resume();
  const runStart = performance.now();
  for (const item of pending) {
    await untilSim(item.at);
    if (item.sample) {
      results.samples.push(await measure(`sim ${Math.round(simMin())} min`));
      results.samples.at(-1).check = await compare(`sample at sim ${Math.round(simMin())} min`);
    } else {
      const d = item.d;
      const label = `${d.kind} at sim ${Math.round(simMin())} min`;
      log(`disturbance: ${label}`);
      const eventsBefore = replay.stats.failed;
      const r = await disturb(d);
      const check = await compare(label);
      results.disturbances.push({ ...d, simMin: Math.round(simMin()), ...r, eventsLostDuring: replay.stats.failed - eventsBefore, check });
    }
  }
  await untilSim(totalSim);
  replay.pause();
  await replay.drain();
  results.endCheck = await compare('end');
  results.samples.push(await measure('end'));
  clearInterval(ticker);

  results.runningWallS = Math.round((performance.now() - runStart) / 1000);
  results.totalWallS = Math.round((performance.now() - t0) / 1000);
  results.simulatedMin = Math.round(replay.simNow() / 60000);
  results.replay = replay.stats;
  results.serverStarts = serverStarts;
  results.pageProblems = pageProblems;
  const serverLogText = fs.readFileSync(path.join(opt.out, 'server.log'), 'utf8');
  results.serverLogLines = serverLogText.split('\n').filter((l) => l.trim()).length;
  // what the server's own log said, by kind (the first line of each kind is kept as an example)
  results.serverLogKinds = {};
  for (const l of serverLogText.split('\n').filter((x) => x.trim())) {
    const kind = l.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>').replace(/\d+/g, '#').slice(0, 70);
    results.serverLogKinds[kind] = (results.serverLogKinds[kind] ?? 0) + 1;
  }
  results.helperLog = helperEvents();
  results.cues = countLines(path.join(fakeState, 'cues.log'));
  results.cueNames = Object.fromEntries([...new Set(fs.readFileSync(path.join(fakeState, 'cues.log'), 'utf8').split('\n').filter(Boolean))].map((c) => [c, fs.readFileSync(path.join(fakeState, 'cues.log'), 'utf8').split('\n').filter((x) => x === c).length]));
  results.endChildren = procs().filter((p) => p.ppid === server.pid).map((p) => p.cmd.slice(0, 80));
  const checks = [results.startCheck, results.endCheck, ...results.samples.map((s) => s.check).filter(Boolean), ...results.disturbances.map((d) => d.check)];
  results.failedChecks = checks.filter((c) => !c.ok).length;
  fs.writeFileSync(path.join(opt.out, 'long-drive.json'), JSON.stringify(results, null, 2));
  log(`done: ${results.simulatedMin} simulated min in ${results.runningWallS} s running (${results.totalWallS} s total), ${replay.stats.posted} events (${replay.stats.failed} failed), ${results.failedChecks} failed comparisons; results in ${path.join(opt.out, 'long-drive.json')}`);

  await browser.close();
  for (const p of browserPids) started.delete(p);
  proxy.close();
  await stopServer('SIGTERM');
  await sleep(1500);
  results.leftoverStandIns = standIns().map((p) => p.cmd.slice(0, 80)); // helper and player processes still alive after the server stopped
  log(`stopped; stand-in processes left: ${results.leftoverStandIns.length}`);
  fs.writeFileSync(path.join(opt.out, 'long-drive.json'), JSON.stringify(results, null, 2));
  serverLog.end();
  return results.failedChecks === 0 && results.leftoverStandIns.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e); process.exit(2); });
}
