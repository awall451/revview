import { boardView, pendingPrompts, shownPrompt, shownAsk } from '../state/index.js';
import { text } from './http.js';

export const PING_MS = 15000;
export const MAX_SSE_CLIENTS = 8;
export const MAX_CLIENT_BACKLOG_BYTES = 256 * 1024; // unread bytes after which a stalled SSE client is dropped

// the page and GET /state get the server's clock with every board: the page corrects its own clock by it
export const snapshot = (ctx) => ({ seq: ctx.seq, now: ctx.clock(), state: boardView(ctx.board) });
export const message = (ctx) => `data: ${JSON.stringify(snapshot(ctx))}\n\n`;
export const broadcast = (ctx) => {
  const m = message(ctx);
  for (const c of ctx.clients) {
    // a client that never reads would make the write buffer grow without bound: drop it
    if (c.writableLength > MAX_CLIENT_BACKLOG_BYTES) {
      ctx.clients.delete(c);
      c.destroy();
      continue;
    }
    c.write(m);
  }
};

// An event the core can take: seq += 1, new board, broadcast. A throwing core leaves everything alone.
// A POSTed event always counts (even if nothing changed); an internal one (onlyIfChanged) only when it did.
export function apply(ctx, event, onlyIfChanged = false) {
  let next;
  try {
    next = ctx.reduceEvent(ctx.board, event, ctx.clock());
  } catch (e) {
    console.error('reduce failed:', e);
    return false;
  }
  if (onlyIfChanged && next === ctx.board) return true;
  const prev = ctx.board;
  ctx.seq += 1;
  ctx.board = next;
  if (next !== prev) { // the one place every event source passes through: cues follow the board change
    try { ctx.sounds?.observe(prev, next); } catch (e) { console.error('sounds failed:', e instanceof Error ? e.message : e); }
  }
  if (next !== prev) {
    try { ctx.lights?.observe(prev, next); } catch (e) { console.error('lights failed:', e instanceof Error ? e.message : e); }
  }
  if (next !== prev) {
    try { ctx.settings?.observe(prev, next); } catch (e) { console.error('settings failed:', e instanceof Error ? e.message : e); }
  }
  if (next !== prev) ctx.quietEnter?.(prev, next);
  // permission requests: drop those whose prompt is gone, then note what the bar shows now
  ctx.registry.sweep(pendingPrompts(ctx.board));
  ctx.registry.observe(shownPrompt(ctx.board) ?? shownAsk(ctx.board));
  broadcast(ctx);
  return true;
}

export function events(ctx, req, res) {
  if (ctx.clients.size >= MAX_SSE_CLIENTS) return text(res, 503, 'too many event streams', { 'retry-after': '5' });
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  res.write('retry: 1000\n\n');
  res.write(message(ctx));
  ctx.clients.add(res);
  const drop = () => ctx.clients.delete(res);
  res.on('close', drop);
  res.on('error', drop);
}

export const stateHandler = (ctx, req, res) =>
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(snapshot(ctx)));

export function startPing(ctx) {
  const timer = setInterval(() => {
    for (const c of ctx.clients) {
      if (c.writableLength > MAX_CLIENT_BACKLOG_BYTES) {
        ctx.clients.delete(c);
        c.destroy();
      } else c.write(': ping\n\n');
    }
  }, PING_MS);
  timer.unref();
  return timer;
}
