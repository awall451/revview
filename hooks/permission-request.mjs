#!/usr/bin/env node
// Claude Code PermissionRequest hook: asks the local revview server whether the
// wheel buttons answered this prompt. Any other outcome prints nothing and exits 0,
// so the normal terminal dialog stays. Never allows or denies by default.
import http from 'node:http';
import { resolveWaitMs } from './wait.mjs';

const MAX_STDIN = 1024 * 1024;
const port = Number(process.env.REVVIEW_PORT) || 8138;
const waitMs = resolveWaitMs(process.env.REVVIEW_HOOK_WAIT_MS);

const bail = (why) => {
  if (why) process.stderr.write(`revview hook: ${why}\n`);
  process.exit(0);
};

const valid = (d) => {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
  const keys = Object.keys(d);
  if (d.behavior === 'allow') return keys.length === 1;
  return (
    d.behavior === 'deny' &&
    keys.length === 2 &&
    typeof d.message === 'string' &&
    d.message.length >= 1 &&
    d.message.length <= 200
  );
};

const chunks = [];
let size = 0;
let over = false;
process.stdin.on('data', (c) => {
  size += c.length;
  if (size > MAX_STDIN) over = true;
  else chunks.push(c);
});
process.stdin.on('error', () => bail('stdin error'));
process.stdin.on('end', () => {
  if (over) return bail('input too large');
  const body = Buffer.concat(chunks);
  try {
    JSON.parse(body.toString('utf8'));
  } catch {
    return bail('stdin is not JSON');
  }
  const req = http.request(
    {
      host: '127.0.0.1',
      port,
      path: '/permission',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': body.length },
      agent: false,
    },
    (res) => {
      const out = [];
      let n = 0;
      res.on('data', (c) => {
        n += c.length;
        if (n <= 65536) out.push(c);
      });
      res.on('error', () => bail('response error'));
      res.on('end', () => {
        if (res.statusCode !== 200 || n > 65536) return bail(null);
        let d;
        try {
          d = JSON.parse(Buffer.concat(out).toString('utf8'));
        } catch {
          return bail('bad response');
        }
        if (!valid(d)) return bail('refused response');
        process.stdout.write(
          JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: d } }) + '\n',
          () => process.exit(0),
        );
      });
    },
  );
  // an absolute deadline (not an idle timeout): the hook must end before Claude Code's own `timeout`
  setTimeout(() => {
    req.destroy();
    bail('timed out');
  }, waitMs).unref();
  req.on('error', () => bail('server unreachable'));
  req.end(body);
});
