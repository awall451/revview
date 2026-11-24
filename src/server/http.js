import fs from 'node:fs';
import path from 'node:path';

export const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export const text = (res, status, msg, extra = {}) =>
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra }).end(msg + '\n');

export function serveStatic(req, res, root) {
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

export function originOk(ctx, req) {
  const allowed = [`127.0.0.1:${ctx.ownPort}`, `localhost:${ctx.ownPort}`];
  if (!allowed.includes(req.headers.host)) return false;
  const origin = req.headers.origin;
  return origin === undefined || allowed.some((a) => origin === `http://${a}`);
}
