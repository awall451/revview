// Live server: hook scripts POST raw Claude Code hook JSON to /event, the state core
// (src/state) reduces it, and the new state is pushed to the page over Server-Sent Events.
// It also serves the view. Binds to 127.0.0.1 only; see src/server/README.md.
//   node src/server/index.js [port]      (default 8138, or REVVIEW_PORT)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialBoard, reduceBoard, boardView } from '../state/index.js';

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

export async function startLiveServer({ port = 0, viewDir = DEFAULT_VIEW_DIR, reduce: reduceEvent = reduceBoard } = {}) {
  const root = path.resolve(viewDir);
  let board = initialBoard();
  let seq = 0;
  const clients = new Set();
  let ownPort = 0;

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
    broadcast();
    return true;
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
      if (!apply(event)) return text(res, 500, 'state core failed; event ignored');
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
    '/events': { GET: events },
    '/state': { GET: (req, res) => res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ seq, state: boardView(board) })) },
  };

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

  return {
    url: `http://${DEFAULT_HOST}:${ownPort}`,
    port: ownPort,
    state: () => boardView(board),
    close: () =>
      new Promise((resolve) => {
        clearInterval(timer);
        server.close(() => resolve());
        for (const c of clients) c.end();
        clients.clear();
        server.closeAllConnections();
      }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || process.env.REVVIEW_PORT || DEFAULT_PORT);
  const { url } = await startLiveServer({ port });
  console.log(`revview live server (127.0.0.1 only)`);
  console.log(`view:  ${url}/`);
  console.log(`post:  curl -s -X POST --data-binary @- ${url}/event < <(head -1 fixtures/sessions/working-turn.jsonl)`);
}
