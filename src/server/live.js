import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialBoard, reduceBoard, boardView, selectedKey } from '../state/index.js';
import { createActions, createPermissionRegistry } from '../sessions/index.js';
import { createSpeaker, createClosingMemo, createReadAloud } from '../speech/index.js';
import { createSounds, createCuePlayer, CUE_DIR } from '../sounds/index.js';
import { text, serveStatic, originOk } from './http.js';
import { apply as applyEvent, events, stateHandler, startPing } from './feed.js';
import { postEvent } from './routes-event.js';
import { postPermission } from './routes-permission.js';
import { devKey, demoStream, bridgeCodes } from './routes-dev.js';
import { acceptGesture, setupInput, buttonsHandler } from './gestures.js';
import { createLifecycle, LAUNCH_LIMIT_MS, COMPACT_LIMIT_MS, QUIET_MS } from './lifecycle.js';
import { startMonitors } from './monitors.js';

export const DEFAULT_PORT = 8138;
// The server's clock for the bar's times: ms since the epoch at process start, then monotonic. A Pi has no RTC and sets
// its time over the network mid-drive; Date.now() would jump with it, this does not (only differences are ever shown).
export const steadyNow = () => performance.timeOrigin + performance.now();
export const DEFAULT_HOST = '127.0.0.1'; // the only address it binds; there is no option for another
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_VIEW_DIR = path.resolve(HERE, '..', 'view');

export async function startLiveServer({
  port = 0, viewDir = DEFAULT_VIEW_DIR, reduce: reduceEvent = reduceBoard,
  input = null, devBridge = false, devKeys = null, devDemo = false, inputDeps, inputRetryMs, onGesture,
  sessions = null, clock = steadyNow, quietMs = QUIET_MS, permissionWaitMs, minShownMs, projects = [], timers, navTimeoutMs, ownedPollMs = 5000, speech = null, launchLimitMs = LAUNCH_LIMIT_MS, compactLimitMs = COMPACT_LIMIT_MS,
  boot = false, netmon = null, thermal = null, dataLock = null,
} = {}) {
  const root = path.resolve(viewDir);
  // Everything the modules share, per server (no module-level state: tests start many servers in one process).
  // Set later in this function: readAloud, sounds (with speech), actions, inputHandle, bridge, lastSource (setupInput), monitor, thermalMonitor,
  // dataMonitor (startMonitors), compactSync, quietSeen, quietClose, launchTimers, compactTimers, clearT (createLifecycle), ownedTimer (the owned poll below).
  const ctx = {
    root, reduceEvent, clock, input, devBridge, devKeys, devDemo, onGesture, sessions, dataLock,
    board: initialBoard(),
    seq: 0,
    clients: new Set(),
    ownPort: 0,
    registry: createPermissionRegistry({ clock, waitMs: permissionWaitMs, minShownMs }),
    closed: false,
    demoClients: new Set(),
    gestureLog: [],
    lastSource: 'device',
    readAloud: null,
    sounds: null,
    actions: null,
    inputHandle: null,
    bridge: null,
    monitor: null,
    thermalMonitor: null,
    dataMonitor: null,
    ownedTimer: null,
    apply: (event, onlyIfChanged) => applyEvent(ctx, event, onlyIfChanged),
    compactSync: null,
    acceptGesture: (g) => acceptGesture(ctx, g),
  };
  // speech = { engine, speakOnStop, sounds?, cuePlayer?, spawn?, killWaitMs? } or null: with null nothing about speech or sounds exists.
  // sounds is the mode ('off' | 'cues' | 'speech'); cuePlayer is { argv, dir?, spawn? } or null (no player found: silent).
  // The mode lives on the board (the Settings row changes it): speech on Stop follows board.sounds === 'speech'.
  if (speech) {
    const log = (m) => console.error(m);
    const speaker = createSpeaker({ engine: speech.engine, spawn: speech.spawn, killWaitMs: speech.killWaitMs, log });
    const mode = speech.sounds ?? (speech.speakOnStop === true ? 'speech' : 'off');
    ctx.board = reduceBoard(ctx.board, { hook_event_name: 'RevviewSounds', mode }); // set at creation: no seq, no broadcast
    ctx.sounds = createSounds({
      player: createCuePlayer({ argv: speech.cuePlayer?.argv ?? null, dir: speech.cuePlayer?.dir ?? CUE_DIR, spawn: speech.cuePlayer?.spawn, timers, log, waitBefore: () => speaker.idle() }),
      log,
    });
    ctx.readAloud = createReadAloud({ speaker, memo: createClosingMemo(), speakOnStop: () => ctx.board.sounds === 'speech', beforeSpeak: () => ctx.sounds.idle(), log });
  }
  const { applyProjects, refreshOwned, launched, runner: marked } = createLifecycle(ctx, { projects, timers, launchLimitMs, compactLimitMs, quietMs });
  ctx.actions = createActions({
    readAloud: ctx.readAloud, runner: marked, registry: ctx.registry, getBoard: () => ctx.board, apply: ctx.apply, projects, clock, timers, navTimeoutMs,
    log: (m) => console.error(m), onOwnedChanged: refreshOwned,
  });

  setupInput(ctx, { inputDeps, inputRetryMs });

  const ROUTES = {
    '/event': { POST: (req, res) => postEvent(ctx, req, res) },
    '/permission': { POST: (req, res) => postPermission(ctx, req, res) },
    '/events': { GET: (req, res) => events(ctx, req, res) },
    '/buttons': { GET: (req, res) => buttonsHandler(ctx, req, res) },
    '/state': { GET: (req, res) => stateHandler(ctx, req, res) },
  };

  if (devBridge) {
    ROUTES['/dev/key'] = { POST: (req, res) => devKey(ctx, req, res) };
    ROUTES['/dev/keys'] = { GET: (req, res) => res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ codes: bridgeCodes(ctx) })) };
  }

  if (devBridge && devDemo) ROUTES['/dev/demo'] = { GET: (req, res) => demoStream(ctx, req, res) };

  const server = http.createServer((req, res) => {
    req.on('error', () => {});
    res.on('error', () => {});
    if (!originOk(ctx, req)) return text(res, 403, 'forbidden origin or host');
    let pathname;
    try {
      pathname = new URL(req.url, 'http://x').pathname;
    } catch {
      return text(res, 400, 'bad url');
    }
    const route = Object.hasOwn(ROUTES, pathname) ? ROUTES[pathname] : null;
    if (route) {
      const h = route[req.method];
      if (!h) return text(res, 405, 'method not allowed', { allow: Object.keys(route).join(', ') });
      return h(req, res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405, 'method not allowed', { allow: 'GET, HEAD' });
    serveStatic(req, res, root);
  });
  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n');
    else socket.destroy();
  });

  const timer = startPing(ctx);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, DEFAULT_HOST, resolve);
  });
  ctx.ownPort = server.address().port;

  applyProjects();
  if (boot) ctx.apply({ hook_event_name: 'RevviewBootBegin' }, true);
  const whenUnlocked = startMonitors(ctx, { netmon, thermal, dataLock });
  if (sessions) {
    await refreshOwned();
    ctx.ownedTimer = setInterval(refreshOwned, ownedPollMs);
    ctx.ownedTimer.unref();
  }

  return {
    // internal: the boot path picks the session the buttons act on (no HTTP route reaches it)
    select: (id) => ctx.apply({ hook_event_name: 'RevviewSelect', session_id: id }, true),
    // internal: the key-on boot is over (ends the boot STARTING; a no-op afterwards)
    bootDone: (note, kind) => ctx.apply({ hook_event_name: 'RevviewBootDone', ...(note ? { note } : {}), ...(note && kind ? { kind } : {}) }, true),
    // internal: revview just started this session (marks it STARTING for launchLimitMs; no HTTP route)
    launched,
    refreshOwned,
    whenUnlocked: () => whenUnlocked,
    dataLocked: () => (ctx.dataMonitor ? ctx.dataMonitor.locked() !== false : false),
    selected: () => selectedKey(ctx.board),
    url: `http://${DEFAULT_HOST}:${ctx.ownPort}`,
    port: ctx.ownPort,
    state: () => boardView(ctx.board),
    gestures: () => ctx.gestureLog.map((g) => ({ ...g })),
    permissionsWaiting: () => ctx.registry.size(), // test seam: waiting PermissionRequest hook calls
    close: async () => {
      try {
        await ctx.sounds?.close(); // kills any cue player child
      } catch (e) {
        console.error('sounds close failed:', e instanceof Error ? e.message : e);
      }
      try {
        await ctx.readAloud?.close(); // kills any speech child
      } catch (e) {
        console.error('read aloud close failed:', e instanceof Error ? e.message : e);
      }
      return new Promise((resolve) => {
        ctx.closed = true;
        ctx.inputHandle?.stop();
        ctx.monitor?.stop();
        ctx.thermalMonitor?.stop();
        ctx.dataMonitor?.stop();
        ctx.actions.close();
        for (const t of ctx.launchTimers.values()) ctx.clearT(t);
        ctx.launchTimers.clear();
        for (const t of ctx.compactTimers.values()) ctx.clearT(t);
        ctx.compactTimers.clear();
        ctx.quietClose();
        if (ctx.ownedTimer !== null) clearInterval(ctx.ownedTimer);
        ctx.registry.close(); // leaves the tmux server alone: sessions outlive a server restart
        clearInterval(timer);
        server.close(() => resolve());
        for (const c of ctx.clients) c.end();
        for (const c of ctx.demoClients) c.end();
        ctx.clients.clear();
        server.closeAllConnections();
      });
    },
  };
}
