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
//   --smoke          a short pass (20 simulated minutes at 60x) to see that the tool works
/* global document */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';
import { createReplay, loadSessions, postEvent, DEFAULTS } from './replay.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The state word the page shows for each view (the spec; same table as emulator/tests/live.spec.js).
const LABELS = {
  working: 'WORKING', waiting: 'WAITING FOR ME', permission: 'NEEDS PERMISSION', done: 'DONE',
  starting: 'STARTING', offline: 'OFFLINE', 'insert-key': 'INSERT KEY',
  unknown: 'UNKNOWN', ended: 'CLAUDE EXITED', 'no-link': 'NO LINK',
};

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
  const o = { simHours: 4, speedup: 30, streams: DEFAULTS.streams, samples: 7, out: '/tmp/long-drive', smoke: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === '--sim-hours') o.simHours = Number(val());
    else if (a === '--speedup') o.speedup = Number(val());
    else if (a === '--streams') o.streams = Number(val());
    else if (a === '--samples') o.samples = Number(val());
    else if (a === '--out') o.out = val();
    else if (a === '--smoke') { o.smoke = true; o.simHours = 1 / 3; o.speedup = 60; o.samples = 2; }
    else throw new Error(`unknown option ${a}`);
  }
  for (const k of ['simHours', 'speedup', 'streams', 'samples']) if (!(o[k] > 0)) throw new Error(`--${k} must be a positive number`);
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
  async function startServer() {
    serverStarts++;
    const child = spawn(process.execPath, ['--import', path.join(HERE, 'clock-skew.js'), path.join(ROOT, 'src/server/index.js'), String(port)], {
      cwd: ROOT, env: { ...process.env, LONG_DRIVE_SKEW_FILE: skewFile, LONG_DRIVE_SKEW_MS: String(skewMs) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
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
  const browser = await chromium.launch({ headless: true });
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
      word: t('state-word'), tool: t('tool'), file: t('file'),
    };
  });
  function expectedFrom({ seq, state }) {
    const working = ['working', 'waiting', 'permission', 'done'].includes(state.view);
    const compacting = working && state.compacting === true;
    return {
      seq: String(seq), view: state.view, word: LABELS[state.view],
      ...(working ? { tool: compacting ? 'Compacting context' : state.tool || '', file: compacting ? '' : state.file || '' } : {}),
    };
  }
  const differs = (shown, want) => Object.keys(want).filter((k) => shown[k] !== want[k]);

  // --- the replay
  const replay = createReplay({ sessions: loadSessions(path.join(ROOT, 'fixtures/sessions')), post: (e) => postEvent(url, e), speedup: opt.speedup, streams: opt.streams });
  const ticker = setInterval(() => replay.tick(), 25);
  const simMin = () => replay.simNow() / 60000;
  async function untilSim(ms) { while (replay.simNow() < ms) await sleep(100); }

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
    replay.resume();
    const ms = Math.round(performance.now() - t);
    if (bad.length === 0) { log(`${label}: page agrees with the server's board after ${ms} ms (view ${want.view}, seq ${want.seq})`); return { ok: true, ms, view: want.view, seq: want.seq }; }
    log(`${label}: MISMATCH on ${bad.join(', ')} after ${ms} ms: page ${JSON.stringify(shown)} board ${JSON.stringify(want)}`);
    return { ok: false, ms, differs: bad, page: shown, board: want };
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
  results.serverLogLines = fs.readFileSync(path.join(opt.out, 'server.log'), 'utf8').split('\n').filter((l) => l.trim()).length;
  const checks = [results.startCheck, results.endCheck, ...results.samples.map((s) => s.check).filter(Boolean), ...results.disturbances.map((d) => d.check)];
  results.failedChecks = checks.filter((c) => !c.ok).length;
  fs.writeFileSync(path.join(opt.out, 'long-drive.json'), JSON.stringify(results, null, 2));
  log(`done: ${results.simulatedMin} simulated min in ${results.runningWallS} s running (${results.totalWallS} s total), ${replay.stats.posted} events (${replay.stats.failed} failed), ${results.failedChecks} failed comparisons; results in ${path.join(opt.out, 'long-drive.json')}`);

  await browser.close();
  proxy.close();
  await stopServer('SIGTERM');
  serverLog.end();
  return results.failedChecks === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e); process.exit(2); });
}
