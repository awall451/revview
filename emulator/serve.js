// Tiny static file server for the view and the developer page (node:http, no dependencies).
// Serves the repository root read-only, GET/HEAD only, nothing outside the root.
//   node emulator/serve.js [port]      (default 8137, or REVVIEW_PORT; prints the URLs)
// Tests call startServer() with port 0 to get a free port.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function handler(root) {
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const file = path.resolve(root, '.' + rel);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.stat(file, (err, st) => {
      const target = !err && st.isDirectory() ? path.join(file, 'index.html') : file;
      fs.readFile(target, (err2, body) => {
        if (err2) {
          res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
          return;
        }
        res.writeHead(200, {
          'content-type': TYPES[path.extname(target)] || 'application/octet-stream',
          'cache-control': 'no-store',
        });
        res.end(req.method === 'HEAD' ? undefined : body);
      });
    });
  };
}

// Resolves to {url, close()}; url has no trailing slash, e.g. http://127.0.0.1:41234
export function startServer({ port = 0, host = '127.0.0.1', root = ROOT } = {}) {
  const server = http.createServer(handler(path.resolve(root)));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const { port: p } = server.address();
      resolve({ url: `http://${host}:${p}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || process.env.REVVIEW_PORT || 8137);
  const { url } = await startServer({ port });
  console.log(`serving ${ROOT}`);
  console.log(`view:           ${url}/src/view/?fixture=working`);
  console.log(`developer page: ${url}/emulator/dev/`);
}
