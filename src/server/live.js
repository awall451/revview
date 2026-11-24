import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialBoard, reduceBoard, boardView, selectedKey } from '../state/index.js';
import { createDataLockMonitor } from './datalock.js';
import { createNetMonitor } from './netmon.js';
import { createThermalMonitor } from './thermal.js';
import { createActions, createPermissionRegistry } from '../sessions/index.js';
import { createSpeaker, createClosingMemo, createReadAloud } from '../speech/index.js';
import { text, serveStatic, originOk } from './http.js';
import { apply as applyEvent, events, stateHandler, startPing } from './feed.js';
import { postEvent } from './routes-event.js';
import { postPermission } from './routes-permission.js';
import { devKey, demoStream, bridgeCodes } from './routes-dev.js';
import { acceptGesture, setupInput, buttonsHandler } from './gestures.js';


export const DEFAULT_PORT = 8138;
export const DEFAULT_HOST = '127.0.0.1'; // the only address it binds; there is no option for another
const LAUNCH_LIMIT_MS = 30000;
// a compaction took 5-7 s in the recordings and 1-2 min in long sessions; this bounds a lost end event
export const COMPACT_LIMIT_MS = 180000;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_VIEW_DIR = path.resolve(HERE, '..', 'view');

export async function startLiveServer({
  port = 0, viewDir = DEFAULT_VIEW_DIR, reduce: reduceEvent = reduceBoard,
  input = null, devBridge = false, devKeys = null, devDemo = false, inputDeps, inputRetryMs, onGesture,
  sessions = null, clock, permissionWaitMs, minShownMs, projects = [], timers, navTimeoutMs, ownedPollMs = 5000, speech = null, launchLimitMs = LAUNCH_LIMIT_MS, compactLimitMs = COMPACT_LIMIT_MS,
  boot = false, netmon = null, thermal = null, dataLock = null,
} = {}) {
  const root = path.resolve(viewDir);
  // Everything the modules share, per server (no module-level state: tests start many servers in one process).
  // Set later in this function: readAloud, actions, inputHandle, bridge, lastSource (setupInput), monitor, thermalMonitor, dataMonitor.
  const ctx = {
    root, reduceEvent, input, devBridge, devKeys, devDemo, onGesture, sessions, dataLock,
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
    actions: null,
    inputHandle: null,
    bridge: null,
    monitor: null,
    thermalMonitor: null,
    dataMonitor: null,
    apply: (event, onlyIfChanged) => applyEvent(ctx, event, onlyIfChanged),
    compactSync: (id, started) => compactSync(id, started),
    acceptGesture: (g) => acceptGesture(ctx, g),
  };
  // owned = the sessions revview itself started (the runner's windows); null without a runner (the old look)
  // project folders that do not exist are marked in the New session rows; re-checked on the owned poll (no timer of its own)
  let missingKey = null;
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  function applyProjects() {
    const missing = projects.filter((p) => !isDir(p));
    const k = JSON.stringify(missing);
    if (k === missingKey) return;
    missingKey = k;
    ctx.apply({ hook_event_name: 'RevviewProjects', paths: projects, missing }, true);
  }
  let lastOwned = new Map(); // id -> name of the windows the last listing had (only to log the ones that vanish)
  // One refresh at a time: a caller that comes while one runs shares a single later run (it then sees what changed
  // meanwhile), so a slow or hung tmux never piles up one pending refresh per poll.
  let ownedRun = null;
  let ownedAgain = null;
  function refreshOwned() {
    if (!ownedRun) {
      ownedRun = refreshOwnedOnce().finally(() => { ownedRun = null; });
      return ownedRun;
    }
    ownedAgain ??= ownedRun.then(() => { ownedAgain = null; return refreshOwned(); });
    return ownedAgain;
  }
  async function refreshOwnedOnce() {
    applyProjects();
    if (!sessions) return;
    try {
      // Claude windows that exited stay until read here (remain-on-exit): the last screen lines go to the log (the
      // journal under the user unit; untrusted text, at most 20 lines) and the last non-empty one to the bar
      for (const r of (await sessions.reap?.()) ?? []) {
        lastOwned.delete(r.id); // its end is logged below: not a second "disappeared" line
        console.error(`owned sessions: Claude of session ${r.id}${r.name ? ` (${r.name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')})` : ''} ended${r.status === null ? '' : ` with status ${r.status}`}; ${r.lines.length === 0 ? 'its screen was empty' : `last ${r.lines.length} screen line(s):`}`);
        for (const l of r.lines) console.error(`  | ${l}`);
        if (!ctx.closed) ctx.apply({ hook_event_name: 'RevviewEndReason', session_id: r.id, text: [...r.lines].reverse().find((l) => l.trim() !== '') ?? '' }, true);
      }
      const list = await sessions.list();
      const now = new Map(list.map((x) => [x.id, x.name]));
      for (const [id, name] of lastOwned) {
        if (!now.has(id)) console.error(`owned sessions: window of session ${id}${typeof name === 'string' && name !== '' ? ` (${name})` : ''} disappeared (Claude exited or the window was closed)`);
      }
      lastOwned = now;
      if (!ctx.closed) ctx.apply({ hook_event_name: 'RevviewOwned', ids: list.map((x) => x.id), names: list.map((x) => x.name) }, true);
    } catch (e) {
      console.error('owned sessions: list failed:', e instanceof Error ? e.message : e);
    }
  }
  // speech = { engine, speakOnStop, spawn?, killWaitMs? } or null: with null nothing about speech exists
  if (speech) {
    const log = (m) => console.error(m);
    const speaker = createSpeaker({ engine: speech.engine, spawn: speech.spawn, killWaitMs: speech.killWaitMs, log });
    ctx.readAloud = createReadAloud({ speaker, memo: createClosingMemo(), speakOnStop: speech.speakOnStop === true, log });
  }
  // while the data is locked no Claude session may start (the key-on one waits, New session is refused)
  const guarded = sessions && dataLock ? {
    ...sessions,
    start: async (...a) => {
      if (ctx.dataMonitor?.check() ?? true) throw new Error('data is locked: insert the key stick');
      return sessions.start(...a);
    },
  } : sessions;
  // a session revview just started shows STARTING until its first hook, but at most launchLimitMs
  const setT = timers?.setTimeout ?? setTimeout;
  const clearT = timers?.clearTimeout ?? clearTimeout;
  const launchTimers = new Map();
  function launched(id, keyon = false) {
    if (ctx.closed || typeof id !== 'string') return;
    ctx.apply({ hook_event_name: 'RevviewLaunching', session_id: id, ...(keyon ? { keyon: true } : {}) }, true);
    if (launchTimers.has(id)) clearT(launchTimers.get(id));
    const t = setT(() => {
      launchTimers.delete(id);
      if (!ctx.closed) ctx.apply({ hook_event_name: 'RevviewLaunchExpired', session_id: id }, true);
    }, launchLimitMs);
    t?.unref?.();
    launchTimers.set(id, t);
  }
  // a PreCompact marks the session as compacting; the mark ends with the next event, or after compactLimitMs
  const compactTimers = new Map();
  function compactStarted(id) {
    if (ctx.closed) return;
    if (compactTimers.has(id)) clearT(compactTimers.get(id));
    const t = setT(() => {
      compactTimers.delete(id);
      if (!ctx.closed) ctx.apply({ hook_event_name: 'RevviewCompactExpired', session_id: id }, true);
    }, compactLimitMs);
    t?.unref?.();
    compactTimers.set(id, t);
  }
  // after every posted event: arm the timer only when the board's session really is compacting, drop it otherwise
  function compactSync(id, started) {
    const on = ctx.board.sessions?.[id]?.state?.compacting === true;
    if (on && started) compactStarted(id);
    else if (!on && compactTimers.has(id)) {
      clearT(compactTimers.get(id));
      compactTimers.delete(id);
    }
  }
  const marked = sessions ? {
    ...guarded,
    start: async (...a) => {
      const r = await guarded.start(...a);
      launched(r?.id);
      return r;
    },
  } : guarded;
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
  if (netmon) {
    ctx.monitor = createNetMonitor({
      log: (m) => console.error(m), ...netmon,
      onChange: (online) => { if (!ctx.closed) ctx.apply({ hook_event_name: 'RevviewNetwork', online }, true); },
    });
  }
  if (thermal) {
    ctx.thermalMonitor = createThermalMonitor({
      log: (m) => console.error(m), ...thermal,
      onChange: ({ hot, lowPower }) => { if (!ctx.closed) ctx.apply({ hook_event_name: 'RevviewThermal', hot, lowPower }, true); },
    });
  }
  let unlocked = !dataLock;
  let resolveUnlocked = () => {};
  const whenUnlocked = unlocked ? Promise.resolve() : new Promise((r) => { resolveUnlocked = r; });
  if (dataLock) {
    ctx.dataMonitor = createDataLockMonitor({
      log: (m) => console.error(m), ...dataLock,
      onChange: (locked) => {
        if (!locked) { unlocked = true; resolveUnlocked(); }
        if (!ctx.closed) ctx.apply({ hook_event_name: 'RevviewDataLock', locked }, true);
      },
    });
    ctx.dataMonitor.check();
  }
  let ownedTimer = null;
  if (sessions) {
    await refreshOwned();
    ownedTimer = setInterval(refreshOwned, ownedPollMs);
    ownedTimer.unref();
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
        for (const t of launchTimers.values()) clearT(t);
        launchTimers.clear();
        for (const t of compactTimers.values()) clearT(t);
        compactTimers.clear();
        if (ownedTimer !== null) clearInterval(ownedTimer);
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
