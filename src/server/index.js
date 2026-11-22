// Live server: hook scripts POST raw Claude Code hook JSON to /event, the state core
// (src/state) reduces it, and the new state is pushed to the page over Server-Sent Events.
// It also serves the view. Binds to 127.0.0.1 only; see src/server/README.md.
//   node src/server/index.js [port] [--input [path]] [--dev-bridge] [--sessions] [--start dir]... [--projects file] [--speech file] [--boot] [--netmon] [--data-lock [dir]]   (port default 8138, or REVVIEW_PORT)
//   --boot: key-on start: show STARTING until the first session is on the board; with no tmux windows, start one session in $REVVIEW_START (or each --start dir)
//   --data-lock [dir]: the data is locked until the topmost mount on dir (default /srv/revview-data, or $REVVIEW_DATA_MOUNT) is ext4 from /dev/mapper/revview-data;
//     locked shows INSERT KEY, no session starts (key-on and New session wait); a posted RevviewDataLock is only a poke to re-read the mount table
//   --netmon: watch the network (default route + TCP connect to $REVVIEW_NETMON_HOST, default api.anthropic.com:443); offline after 2 failures, online after 1 success
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialBoard, reduceBoard, boardView, pendingPrompts, shownPrompt, selectedKey } from '../state/index.js';
import { createDataLockMonitor, DEFAULT_DATA_MOUNT } from './datalock.js';
import { createNetMonitor, createDefaultProbe } from './netmon.js';
import { createSessionRunner, createActions, createPermissionRegistry, loadProjects } from '../sessions/index.js';
import { startInput, createInputPipeline } from '../input/index.js';
import { loadConfig, ConfigError, DEFAULT_CONFIG_PATH } from '../input/keymap.js';
import { BROWSER_CODES } from '../input/keys.js';
import {
  createSpeaker, createClosingMemo, createReadAloud, loadSpeechConfig, pickEngine, describeChoice, SpeechConfigError,
  DEFAULT_SPEECH_CONFIG_PATH,
} from '../speech/index.js';

export const DEFAULT_PORT = 8138;
export const DEFAULT_HOST = '127.0.0.1'; // the only address it binds; there is no option for another
export const MAX_BODY_BYTES = 1024 * 1024;
const PREFIX_BYTES = 64 * 1024; // of an oversize body, kept to tell whether it was a hook event
const PREFIX_WAIT_MS = 2000; // how long to wait for a prefix when only Content-Length was over the limit
const SESSION_ID_RE = /"session_id"\s*:\s*"([^"\\]{1,200})"/;
const EVENT_NAME_RE = /"hook_event_name"\s*:\s*"([A-Za-z]{1,64})"/;
const TOOL_NAME_RE = /"tool_name"\s*:\s*"([^"\\]{1,200})"/;
const DIFF_TOOLS = ['Edit', 'Write', 'MultiEdit']; // the only tools whose PostToolUse counts diff (src/state/diff.js)
const PING_MS = 15000;
const MAX_DEV_BODY_BYTES = 1024;
const GESTURE_LOG_MAX = 32;
const BUTTON_RE = /^[a-z][a-z0-9-]{0,31}$/;
const GESTURES = ['tap', 'hold', 'long-hold'];
// made only by revview itself (the actions, the boot path): no POST may forge them, not even under --dev-bridge
const INTERNAL_EVENTS = ['RevviewInterrupted', 'RevviewAnswered', 'RevviewSelect', 'RevviewNav', 'RevviewOwned', 'RevviewProjects', 'RevviewNote'];
export const MAX_SSE_CLIENTS = 8;
export const MAX_CLIENT_BACKLOG_BYTES = 256 * 1024; // unread bytes after which a stalled SSE client is dropped
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_VIEW_DIR = path.resolve(HERE, '..', 'view');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const text = (res, status, msg, extra = {}) =>
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra }).end(msg + '\n');

function serveStatic(req, res, root) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return text(res, 400, 'bad path');
  }
  if (rel.includes('\0')) return text(res, 400, 'bad path');
  const file = path.resolve(root, '.' + rel);
  if (file !== root && !file.startsWith(root + path.sep)) return text(res, 403, 'forbidden');
  fs.stat(file, (err, st) => {
    const target = !err && st.isDirectory() ? path.join(file, 'index.html') : file;
    fs.readFile(target, (err2, body) => {
      if (err2) return text(res, 404, 'not found');
      res.writeHead(200, {
        'content-type': TYPES[path.extname(target)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  });
}

export async function startLiveServer({
  port = 0, viewDir = DEFAULT_VIEW_DIR, reduce: reduceEvent = reduceBoard,
  input = null, devBridge = false, inputDeps, inputRetryMs, onGesture,
  sessions = null, clock, permissionWaitMs, minShownMs, projects = [], timers, navTimeoutMs, ownedPollMs = 5000, speech = null,
  boot = false, netmon = null, dataLock = null,
} = {}) {
  const root = path.resolve(viewDir);
  let board = initialBoard();
  let seq = 0;
  const clients = new Set();
  let ownPort = 0;
  const registry = createPermissionRegistry({ clock, waitMs: permissionWaitMs, minShownMs });
  let closed = false;
  // owned = the sessions revview itself started (the runner's windows); null without a runner (the old look)
  // project folders that do not exist are marked in the New session rows; re-checked on the owned poll (no timer of its own)
  let missingKey = null;
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  function applyProjects() {
    const missing = projects.filter((p) => !isDir(p));
    const k = JSON.stringify(missing);
    if (k === missingKey) return;
    missingKey = k;
    apply({ hook_event_name: 'RevviewProjects', paths: projects, missing }, true);
  }
  async function refreshOwned() {
    applyProjects();
    if (!sessions) return;
    try {
      const list = await sessions.list();
      if (!closed) apply({ hook_event_name: 'RevviewOwned', ids: list.map((x) => x.id), names: list.map((x) => x.name) }, true);
    } catch (e) {
      console.error('owned sessions: list failed:', e instanceof Error ? e.message : e);
    }
  }
  // speech = { engine, speakOnStop, spawn?, killWaitMs? } or null: with null nothing about speech exists
  let readAloud = null;
  if (speech) {
    const log = (m) => console.error(m);
    const speaker = createSpeaker({ engine: speech.engine, spawn: speech.spawn, killWaitMs: speech.killWaitMs, log });
    readAloud = createReadAloud({ speaker, memo: createClosingMemo(), speakOnStop: speech.speakOnStop === true, log });
  }
  let dataMonitor = null;
  // while the data is locked no Claude session may start (the key-on one waits, New session is refused)
  const guarded = sessions && dataLock ? {
    ...sessions,
    start: async (...a) => {
      if (dataMonitor?.check() ?? true) throw new Error('data is locked: insert the key stick');
      return sessions.start(...a);
    },
  } : sessions;
  const actions = createActions({
    readAloud, runner: guarded, registry, getBoard: () => board, apply, projects, clock, timers, navTimeoutMs,
    log: (m) => console.error(m), onOwnedChanged: refreshOwned,
  });

  const message = () => `data: ${JSON.stringify({ seq, state: boardView(board) })}\n\n`;
  const broadcast = () => {
    const m = message();
    for (const c of clients) {
      // a client that never reads would make the write buffer grow without bound: drop it
      if (c.writableLength > MAX_CLIENT_BACKLOG_BYTES) {
        clients.delete(c);
        c.destroy();
        continue;
      }
      c.write(m);
    }
  };

  // An event the core can take: seq += 1, new board, broadcast. A throwing core leaves everything alone.
  // A POSTed event always counts (even if nothing changed); an internal one (onlyIfChanged) only when it did.
  function apply(event, onlyIfChanged = false) {
    let next;
    try {
      next = reduceEvent(board, event);
    } catch (e) {
      console.error('reduce failed:', e);
      return false;
    }
    if (onlyIfChanged && next === board) return true;
    seq += 1;
    board = next;
    // permission requests: drop those whose prompt is gone, then note what the bar shows now
    registry.sweep(pendingPrompts(board));
    registry.observe(shownPrompt(board));
    broadcast();
    return true;
  }

  // Gestures: an in-memory log, never part of the board. Presses during 'starting' are dropped, not queued.
  const gestureLog = [];
  function acceptGesture({ button, gesture, source }) {
    const entry = { button, gesture, source, at: Date.now(), dropped: boardView(board).view === 'starting' };
    gestureLog.push(entry);
    if (gestureLog.length > GESTURE_LOG_MAX) gestureLog.shift();
    try {
      onGesture?.({ ...entry });
    } catch (e) {
      console.error('onGesture failed:', e);
    }
    // the actions never throw into the reader (handle() catches), the extra catch is a belt
    try {
      actions.handle({ ...entry }).catch((e) => console.error('action failed:', e));
    } catch (e) {
      console.error('action failed:', e);
    }
  }

  // Source of the key event that is feeding the one detector (hold timers inherit the last one).
  let lastSource = 'device';
  const gestureFromDetector = (g) => acceptGesture({ button: g.button, gesture: g.gesture, source: lastSource });
  let inputHandle = null;
  if (input) {
    inputHandle = startInput({
      config: input,
      onGesture: gestureFromDetector,
      onPresence: (present) => apply({ hook_event_name: 'RevviewInput', present }, true),
      onKey: () => { lastSource = 'device'; },
      log: (m) => console.error(m),
      deps: inputDeps,
      retryMs: inputRetryMs,
    });
  }
  let bridge = null;
  if (devBridge) {
    bridge = inputHandle ?? createInputPipeline({ config: loadConfig(DEFAULT_CONFIG_PATH), onGesture: gestureFromDetector });
  }

  // A body over the limit that still looks like a hook event means an event was lost (QA issue 11).
  function noteDropped(prefix) {
    // Only a lost PostToolUse of a diff tool makes +N -N wrong; any other lost event (a huge Read or Bash
    // output, a PreToolUse) changes no count, so it is not marked. Claude Code writes session_id first and
    // tool_name before tool_input, so they are in the prefix (and the first match is the real field).
    const head = prefix.toString('utf8');
    const name = EVENT_NAME_RE.exec(head);
    if (!name || name[1] !== 'PostToolUse') return;
    const tool = TOOL_NAME_RE.exec(head);
    if (tool && !DIFF_TOOLS.includes(tool[1])) return;
    const m = SESSION_ID_RE.exec(head);
    apply(m ? { hook_event_name: 'RevviewDropped', session_id: m[1] } : { hook_event_name: 'RevviewDropped' }, true);
  }

  function readBody(req, res, done) {
    const declared = Number(req.headers['content-length']);
    let size = 0;
    let kept = 0;
    const chunks = [];
    const prefix = []; // first PREFIX_BYTES of the body, for an oversize one
    let finished = false;
    let timer = null;
    const keep = (c) => {
      if (kept >= PREFIX_BYTES) return;
      const part = c.subarray(0, PREFIX_BYTES - kept);
      prefix.push(part);
      kept += part.length;
    };
    const tooBig = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      req.removeAllListeners('data');
      req.removeAllListeners('end');
      chunks.length = 0;
      res.on('finish', () => req.socket.destroy());
      text(res, 413, 'body too large (max 1 MiB)', { connection: 'close' });
      noteDropped(Buffer.concat(prefix));
    };
    if (declared > MAX_BODY_BYTES) {
      // nothing counted yet: wait briefly for up to 64 KiB so the prefix can be looked at
      timer = setTimeout(tooBig, PREFIX_WAIT_MS);
      req.on('data', (c) => {
        if (finished) return;
        keep(c);
        if (kept >= PREFIX_BYTES) tooBig();
      });
      req.on('end', tooBig);
      return;
    }
    req.on('data', (c) => {
      if (finished) return;
      keep(c);
      size += c.length;
      if (size > MAX_BODY_BYTES) return tooBig();
      chunks.push(c);
    });
    req.on('end', () => {
      if (finished) return;
      finished = true;
      done(Buffer.concat(chunks).toString('utf8'));
    });
  }

  function postEvent(req, res) {
    readBody(req, res, (body) => {
      let event;
      try {
        event = JSON.parse(body);
      } catch {
        return text(res, 400, body.trim() === '' ? 'empty body' : 'malformed JSON');
      }
      if (event === null || typeof event !== 'object' || Array.isArray(event)) {
        return text(res, 400, 'body must be a JSON object');
      }
      // Gestures and presence come only from the in-process reader (or the dev bridge): a local process
      // without an Origin header must not be able to forge a press or the NO BUTTONS state.
      if (!devBridge && (event.hook_event_name === 'RevviewButton' || event.hook_event_name === 'RevviewInput')) {
        return text(res, 403, `${event.hook_event_name} is not accepted over HTTP (dev bridge only)`);
      }
      // internal only: it makes a screen state from a key revview sent itself, so no POST may forge it
      if (INTERNAL_EVENTS.includes(event.hook_event_name)) {
        return text(res, 403, `${event.hook_event_name} is internal and not accepted over HTTP`);
      }
      // with a data lock the mount table decides: a posted RevviewDataLock is only a poke to re-read it
      if (dataLock && event.hook_event_name === 'RevviewDataLock') {
        dataMonitor?.check();
        return res.writeHead(204).end();
      }
      if (!apply(event)) return text(res, 500, 'state core failed; event ignored');
      try {
        readAloud?.onEvent(event, board, selectedKey(board));
      } catch (e) {
        console.error('read aloud failed:', e instanceof Error ? e.message : e);
      }
      if (event.hook_event_name === 'RevviewButton' && typeof event.button === 'string'
        && BUTTON_RE.test(event.button) && GESTURES.includes(event.gesture)) {
        acceptGesture({ button: event.button, gesture: event.gesture, source: 'post' });
      }
      res.writeHead(204).end();
    });
  }

  // The PermissionRequest hook's long poll. The request is bound to the prompt this very event put on the
  // board (matched by session, agent and the board tick); nothing the client sends can name another prompt,
  // and no route answers it: only a wheel button (src/sessions/actions.js) can.
  function postPermission(req, res) {
    readBody(req, res, (body) => {
      let ev;
      try {
        ev = JSON.parse(body);
      } catch {
        return text(res, 400, body.trim() === '' ? 'empty body' : 'malformed JSON');
      }
      if (ev === null || typeof ev !== 'object' || Array.isArray(ev) || ev.hook_event_name !== 'PermissionRequest'
        || typeof ev.session_id !== 'string' || ev.session_id === '' || typeof ev.tool_name !== 'string') {
        return text(res, 400, 'expected a PermissionRequest hook object');
      }
      const before = board;
      if (!apply(ev)) return text(res, 500, 'state core failed; event ignored');
      if (!sessions) return res.writeHead(204).end(); // no buttons can answer: the terminal dialog stays
      const agent = typeof ev.agent_id === 'string' && ev.agent_id !== '' ? ev.agent_id : '';
      // only an entry THIS event created (the board changed and the entry is from this tick) is bound, so its
      // text on the bar is this request's own tool and command
      const mine = board === before ? [] : pendingPrompts(board).filter((p) => p.session === ev.session_id
        && p.agent === agent && p.since === board.tick);
      let prompt;
      if (mine.length === 1) prompt = mine[0];
      else {
        prompt = { session: ev.session_id, agent, since: null, tool: ev.tool_name, file: null, command: null };
        console.error('permission request not bound to a prompt on the bar: buttons cannot answer it');
      }
      let over = false;
      const id = registry.add(prompt, (decision) => {
        if (over || res.writableEnded) return;
        over = true;
        if (decision === null) return res.writeHead(204).end();
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(decision));
      });
      if (id === null) return text(res, 503, 'too many waiting permission requests');
      res.on('close', () => {
        over = true;
        registry.remove(id);
      });
    });
  }

  // Dev only (registered only with devBridge): the page forwards key presses to the same detector.
  function devKey(req, res) {
    const declared = Number(req.headers['content-length']);
    if (declared > MAX_DEV_BODY_BYTES) {
      res.on('finish', () => req.socket.destroy());
      return text(res, 413, 'body too large (max 1 KiB)', { connection: 'close' });
    }
    let size = 0;
    const chunks = [];
    let over = false;
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > MAX_DEV_BODY_BYTES) {
        over = true;
        chunks.length = 0;
        res.on('finish', () => req.socket.destroy());
        text(res, 413, 'body too large (max 1 KiB)', { connection: 'close' });
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (over) return;
      let b;
      try {
        b = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return text(res, 400, 'malformed JSON');
      }
      if (b === null || typeof b !== 'object' || Array.isArray(b)) return text(res, 400, 'body must be a JSON object');
      if (b.type === 'lost') {
        bridge.reset();
        return res.writeHead(204).end();
      }
      if ((b.type !== 'down' && b.type !== 'up') || typeof b.code !== 'string' || b.code.length > 32
        || (b.repeat !== undefined && typeof b.repeat !== 'boolean')) {
        return text(res, 400, 'expected {code, type: down|up|lost, repeat?}');
      }
      const code = Object.hasOwn(BROWSER_CODES, b.code) ? BROWSER_CODES[b.code] : undefined;
      if (code !== undefined) {
        lastSource = 'bridge';
        bridge.feed(code, b.type === 'up' ? 0 : b.repeat ? 2 : 1);
      }
      res.writeHead(204).end();
    });
  }

  function events(req, res) {
    if (clients.size >= MAX_SSE_CLIENTS) return text(res, 503, 'too many event streams', { 'retry-after': '5' });
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    res.write(message());
    clients.add(res);
    const drop = () => clients.delete(res);
    res.on('close', drop);
    res.on('error', drop);
  }

  function originOk(req) {
    const allowed = [`127.0.0.1:${ownPort}`, `localhost:${ownPort}`];
    if (!allowed.includes(req.headers.host)) return false;
    const origin = req.headers.origin;
    return origin === undefined || allowed.some((a) => origin === `http://${a}`);
  }

  const ROUTES = {
    '/event': { POST: postEvent },
    '/permission': { POST: postPermission },
    '/events': { GET: events },
    '/buttons': { GET: (req, res) => res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ buttons: boardView(board).buttons, gestures: gestureLog })) },
    '/state': { GET: (req, res) => res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ seq, state: boardView(board) })) },
  };

  if (devBridge) ROUTES['/dev/key'] = { POST: devKey };

  const server = http.createServer((req, res) => {
    req.on('error', () => {});
    res.on('error', () => {});
    if (!originOk(req)) return text(res, 403, 'forbidden origin or host');
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

  const timer = setInterval(() => {
    for (const c of clients) {
      if (c.writableLength > MAX_CLIENT_BACKLOG_BYTES) {
        clients.delete(c);
        c.destroy();
      } else c.write(': ping\n\n');
    }
  }, PING_MS);
  timer.unref();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, DEFAULT_HOST, resolve);
  });
  ownPort = server.address().port;

  applyProjects();
  if (boot) apply({ hook_event_name: 'RevviewStarting' }, true);
  let monitor = null;
  if (netmon) {
    monitor = createNetMonitor({
      log: (m) => console.error(m), ...netmon,
      onChange: (online) => { if (!closed) apply({ hook_event_name: 'RevviewNetwork', online }, true); },
    });
  }
  let unlocked = !dataLock;
  let resolveUnlocked = () => {};
  const whenUnlocked = unlocked ? Promise.resolve() : new Promise((r) => { resolveUnlocked = r; });
  if (dataLock) {
    dataMonitor = createDataLockMonitor({
      log: (m) => console.error(m), ...dataLock,
      onChange: (locked) => {
        if (!locked) { unlocked = true; resolveUnlocked(); }
        if (!closed) apply({ hook_event_name: 'RevviewDataLock', locked }, true);
      },
    });
    dataMonitor.check();
  }
  let ownedTimer = null;
  if (sessions) {
    await refreshOwned();
    ownedTimer = setInterval(refreshOwned, ownedPollMs);
    ownedTimer.unref();
  }

  return {
    // internal: the boot path picks the session the buttons act on (no HTTP route reaches it)
    select: (id) => apply({ hook_event_name: 'RevviewSelect', session_id: id }, true),
    refreshOwned,
    whenUnlocked: () => whenUnlocked,
    dataLocked: () => (dataMonitor ? dataMonitor.locked() !== false : false),
    selected: () => selectedKey(board),
    url: `http://${DEFAULT_HOST}:${ownPort}`,
    port: ownPort,
    state: () => boardView(board),
    gestures: () => gestureLog.map((g) => ({ ...g })),
    permissionsWaiting: () => registry.size(), // test seam: waiting PermissionRequest hook calls
    close: async () => {
      try {
        await readAloud?.close(); // kills any speech child
      } catch (e) {
        console.error('read aloud close failed:', e instanceof Error ? e.message : e);
      }
      return new Promise((resolve) => {
        closed = true;
        inputHandle?.stop();
        monitor?.stop();
        dataMonitor?.stop();
        actions.close();
        if (ownedTimer !== null) clearInterval(ownedTimer);
        registry.close(); // leaves the tmux server alone: sessions outlive a server restart
        clearInterval(timer);
        server.close(() => resolve());
        for (const c of clients) c.end();
        clients.clear();
        server.closeAllConnections();
      });
    },
  };
}

export function parseArgs(argv) {
  const out = { port: null, inputPath: null, devBridge: false, sessions: false, start: [], projects: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dev-bridge') out.devBridge = true;
    else if (a === '--sessions') out.sessions = true;
    else if (a === '--boot') out.boot = true;
    else if (a === '--netmon') out.netmon = true;
    else if (a === '--data-lock') {
      const next = argv[i + 1];
      if (next !== undefined && next.startsWith('/')) { out.dataLock = next; i++; } else out.dataLock = DEFAULT_DATA_MOUNT;
    }
    else if (a === '--start') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error('--start needs a directory');
      out.start.push(next);
      out.sessions = true;
      i++;
    }
    else if (a === '--projects') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error('--projects needs a file');
      out.projects = next;
      i++;
    } else if (a === '--speech') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error('--speech needs a file');
      out.speech = next;
      i++;
    } else if (a === '--input') {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out.inputPath = next; i++; } else out.inputPath = DEFAULT_CONFIG_PATH;
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else if (out.port === null && /^\d+$/.test(a)) out.port = Number(a);
    else throw new Error(`unexpected argument ${a}`);
  }
  if (out.port === null) out.port = Number(process.env.REVVIEW_PORT || DEFAULT_PORT);
  if (out.boot && out.start.length === 0 && process.env.REVVIEW_START) out.start = [process.env.REVVIEW_START];
  if (out.dataLock === undefined && process.env.REVVIEW_DATA_MOUNT) out.dataLock = process.env.REVVIEW_DATA_MOUNT;
  if (out.dataLock !== undefined && !/^\/[A-Za-z0-9._/-]+$/.test(out.dataLock)) throw new Error(`--data-lock needs an absolute directory (letters, digits, . _ / -), got ${out.dataLock}`);
  if (out.dataLock !== undefined && out.start.length > 0 && !out.boot) throw new Error('--start with a data lock needs --boot (the key-on session waits for the unlock)');
  if (out.projects === null) out.projects = process.env.REVVIEW_PROJECTS || null;
  // the key exists only when a speech file was named (flag or REVVIEW_SPEECH)
  if (out.speech === undefined && process.env.REVVIEW_SPEECH) out.speech = process.env.REVVIEW_SPEECH;
  return out;
}

// Key-on: after the server listens, make sure there is a session. No windows (tmux died with the power) ->
// start one per dir; exactly one (a service restart) -> select it; several -> select none. Never throws.
export async function bootSessions({ runner, live, dirs = [], log = () => {} }) {
  try {
    const existing = await runner.list();
    if (existing.length > 0) {
      if (existing.length !== 1) return null;
      live.select(existing[0].id);
      return existing[0].id;
    }
    let last = null;
    for (const dir of dirs) last = (await runner.start({ cwd: path.resolve(dir) })).id;
    if (last === null) return null;
    await live.refreshOwned();
    live.select(last);
    return last;
  } catch (e) {
    log(`boot sessions: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// Key-on with a data lock: the boot session waits for the unlock; never blocks the caller, never throws.
export function bootAfterUnlock({ live, runner, dirs = [], log = () => {} }) {
  return live.whenUnlocked().then(() => {
    log('boot: data unlocked, starting the key-on session');
    return bootSessions({ runner, live, dirs, log });
  });
}

// SIGTERM/SIGINT: close the server (which stops the grab helper), then exit 0.
export function installShutdown(server, proc = process) {
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    Promise.resolve().then(() => server.close()).catch(() => {}).finally(() => proc.exit(0));
  };
  proc.on('SIGTERM', stop);
  proc.on('SIGINT', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let args;
  let input = null;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.inputPath) input = loadConfig(args.inputPath);
  } catch (e) {
    console.error(e instanceof ConfigError || e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  let runner = null;
  let selectId = null; // the session the buttons act on at boot: the last one started, else the only one there is
  if (args.sessions) {
    runner = createSessionRunner({ socket: { name: 'revview' }, log: (m) => console.error(m) });
    if (!args.boot) {
      try {
        const existing = await runner.list();
        if (existing.length === 1) selectId = existing[0].id;
        for (const dir of args.start) selectId = (await runner.start({ cwd: path.resolve(dir) })).id;
      } catch (e) {
        console.error(`sessions: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(2);
      }
    }
  }
  let netmon = null;
  let netmonLine = null;
  if (args.netmon) {
    let host = 'api.anthropic.com';
    let port = 443;
    const v = process.env.REVVIEW_NETMON_HOST;
    if (v) {
      const m = /^([A-Za-z0-9._-]+)(?::(\d{1,5}))?$/.exec(v);
      if (!m || (m[2] !== undefined && (Number(m[2]) < 1 || Number(m[2]) > 65535))) {
        console.error(`REVVIEW_NETMON_HOST must be host or host:port, got ${v}`);
        process.exit(2);
      }
      host = m[1];
      if (m[2] !== undefined) port = Number(m[2]);
    }
    netmon = { probe: createDefaultProbe({ host, port }) };
    netmonLine = `netmon: online = default route + TCP connect to ${host}:${port} every 10 s`;
  }
  const projects = args.projects ? loadProjects(args.projects, { log: (m) => console.error(m) }) : [];
  // a bad speech config means no voice, never no bar
  let speech = null;
  let speechLine;
  try {
    const config = loadSpeechConfig(args.speech ?? DEFAULT_SPEECH_CONFIG_PATH);
    const engine = pickEngine(config);
    console.error(describeChoice(config, engine));
    speech = { engine, speakOnStop: config.speakOnStop };
    speechLine = `speech: ${engine ? engine.name : 'none found (read aloud does nothing)'}${config.speakOnStop ? ' (spoken summary on Stop: on)' : ''}`;
  } catch (e) {
    if (!(e instanceof SpeechConfigError)) throw e;
    console.error(e.message);
    speechLine = 'speech: off (bad speech config, see the log)';
  }
  const live = await startLiveServer({ port: args.port, input, devBridge: args.devBridge, sessions: runner, projects, speech, boot: args.boot, netmon, dataLock: args.dataLock ? { mountPoint: args.dataLock } : null });
  if (args.boot && runner && args.dataLock) {
    const log = (m) => console.error(m);
    bootAfterUnlock({ live, runner, dirs: args.start, log }).then(() => log('boot: key-on session step done'));
  } else if (args.boot && runner) selectId = await bootSessions({ runner, live, dirs: args.start, log: (m) => console.error(m) });
  else if (selectId !== null) live.select(selectId);
  const selectedNow = selectId !== null && live.selected() === selectId;
  const { url } = live;
  installShutdown(live);
  console.log(`revview live server (127.0.0.1 only)`);
  console.log(`view:  ${url}/`);
  console.log(`post:  curl -s -X POST --data-binary @- ${url}/event < <(head -1 fixtures/sessions/working-turn.jsonl)`);
  if (input) console.log('input: reading wheel buttons (GET /buttons)');
  if (runner) console.log(`sessions: private tmux server (-L revview), ${selectId === null ? 'selected: none' : `${selectedNow ? 'selected' : 'wanted'}: ${selectId}`}`);
  console.log(speechLine);
  if (netmonLine) console.log(netmonLine);
  if (args.boot) console.log('boot: STARTING until the first session is on the board');
  if (args.boot && runner && args.dataLock) console.log(`boot: the key-on session waits for the data unlock (${args.dataLock})`);
  if (args.projects) console.log(`projects: ${projects.length} from ${args.projects}`);
  if (args.devBridge) console.log('dev bridge ON (POST /dev/key): never use this on the car');
}
