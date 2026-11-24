import { loadConfig, DEFAULT_CONFIG_PATH } from '../input/keymap.js';
import { BROWSER_CODES, MODIFIER_KIND } from '../input/keys.js';
import { text } from './http.js';

export const MAX_DEV_BODY_BYTES = 1024;
export const MAX_DEMO_CLIENTS = 2;
// Browser codes the demo player owns under --dev-demo (the demo's keys: scene 1-9, pause, slower, faster).
export const DEMO_CODES = Object.freeze([...Array.from({ length: 9 }, (_, i) => `Digit${i + 1}`), 'KeyP', 'BracketLeft', 'BracketRight']);

// browser codes of the bridge's bound non-modifier keys (the page prevents their default action)
export const bridgeCodes = (ctx) => {
  const cfg = ctx.devKeys ?? ctx.input ?? loadConfig(DEFAULT_CONFIG_PATH);
  const bound = new Set(cfg.bindings.map((b) => b.key));
  return Object.keys(BROWSER_CODES).filter((c) => bound.has(BROWSER_CODES[c]) && !(BROWSER_CODES[c] in MODIFIER_KIND));
};

// Dev only (registered only with devBridge): the page forwards key presses to the same detector.
export function devKey(ctx, req, res) {
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
      ctx.bridge.reset();
      return res.writeHead(204).end();
    }
    if ((b.type !== 'down' && b.type !== 'up') || typeof b.code !== 'string' || b.code.length > 32
      || (b.repeat !== undefined && typeof b.repeat !== 'boolean')) {
      return text(res, 400, 'expected {code, type: down|up|lost, repeat?}');
    }
    // dev demo: the demo's keys go to the player (GET /dev/demo), never to the bridge
    if (ctx.devDemo && DEMO_CODES.includes(b.code)) {
      if (b.type === 'down' && b.repeat !== true) {
        const msg = `data: ${JSON.stringify({ code: b.code })}\n\n`;
        for (const c of ctx.demoClients) c.write(msg);
      }
      return res.writeHead(204).end();
    }
    const code = Object.hasOwn(BROWSER_CODES, b.code) ? BROWSER_CODES[b.code] : undefined;
    if (code !== undefined) {
      ctx.lastSource = 'bridge';
      ctx.bridge.feed(code, b.type === 'up' ? 0 : b.repeat ? 2 : 1);
    }
    res.writeHead(204).end();
  });
}

// Dev only (devDemo): the demo player listens here for the demo keys typed in the page.
export function demoStream(ctx, req, res) {
  if (ctx.demoClients.size >= MAX_DEMO_CLIENTS) return text(res, 503, 'too many demo streams', { 'retry-after': '5' });
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write('retry: 1000\n\n');
  ctx.demoClients.add(res);
  const drop = () => ctx.demoClients.delete(res);
  res.on('close', drop);
  res.on('error', drop);
}
