#!/usr/bin/env node
// Claude Code command hook for every event except PermissionRequest: posts the hook JSON (unchanged) to the
// local revview server (http://127.0.0.1:$REVVIEW_PORT/event, default 8138). After a successful post of a
// few events (session start, prompt, stop, a Bash result) it also posts a synthetic RevviewContext with the
// git toplevel and branch of the payload's cwd.
// PermissionRequest is NOT posted here: hooks/permission-request.mjs owns it through /permission, and a
// second post to /event would make a duplicate pending entry. Names that are not strings or start with
// `Revview` are not posted either (a hook must not be a way to send synthetic events).
// Failure rule: this hook never prints to stdout and always exits 0 (server down, non-2xx, hang, bad stdin),
// at the latest at REVVIEW_EVENT_WAIT_MS (default 1000, clamped to 50..3000). It never blocks Claude Code.
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';

const MAX_BODY = 1024 * 1024; // the server's MAX_BODY_BYTES
const KEEP = MAX_BODY + 64 * 1024 + 1; // an oversize body is sent as this prefix; the server marks it dropped
const port = Number(process.env.REVVIEW_PORT) || 8138;
const raw = process.env.REVVIEW_EVENT_WAIT_MS;
const asNum = Number(raw);
const waitMs = raw !== undefined && raw !== '' && Number.isFinite(asNum) ? Math.min(3000, Math.max(50, asNum)) : 1000;
const t0 = Date.now();
const left = () => Math.max(1, waitMs - (Date.now() - t0));

const bail = (why) => {
  if (why) process.stderr.write(`revview hook: ${why}\n`);
  process.exit(0);
};
// an absolute deadline for the whole run, not an idle timeout
setTimeout(() => bail('timed out'), waitMs).unref();

function post(body) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/event',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': body.length },
        agent: false,
      },
      (res) => {
        res.resume();
        res.on('error', () => resolve(false));
        res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300));
      },
    );
    req.on('error', () => resolve(false));
    req.end(body);
  });
}

function wantsContext(ev) {
  switch (ev.hook_event_name) {
    case 'SessionStart':
      return ev.source !== 'compact';
    case 'UserPromptSubmit':
    case 'Stop':
      return true;
    case 'PostToolUse':
      return ev.tool_name === 'Bash';
    default:
      return false;
  }
}

function git(cwd) {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', cwd, 'rev-parse', '--show-toplevel', '--abbrev-ref', 'HEAD'],
      { timeout: left(), env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 65536 },
      (err, stdout) => {
        const lines = String(stdout).split('\n');
        if (err || !lines[0] || !lines[1]) return resolve({ cwd, branch: null });
        resolve({ cwd: lines[0], branch: lines[1] === 'HEAD' ? null : lines[1] });
      },
    );
  });
}

async function main(body, ev) {
  if (!(await post(body))) return bail(null);
  if (wantsContext(ev) && typeof ev.cwd === 'string' && path.isAbsolute(ev.cwd) && typeof ev.session_id === 'string') {
    const c = await git(ev.cwd);
    const ctx = { hook_event_name: 'RevviewContext', session_id: ev.session_id, cwd: c.cwd, branch: c.branch };
    await post(Buffer.from(JSON.stringify(ctx)));
  }
  bail(null);
}

const chunks = [];
let size = 0;
process.stdin.on('data', (c) => {
  if (size < KEEP) chunks.push(size + c.length > KEEP ? c.subarray(0, KEEP - size) : c);
  size += c.length; // keep draining stdin, discard the rest
});
process.stdin.on('error', () => bail('stdin error'));
process.stdin.on('end', () => {
  const body = Buffer.concat(chunks);
  if (size > MAX_BODY) {
    // cannot be validated; the server sees an oversize body and marks the session dropped
    const head = body.subarray(0, 65536).toString('utf8');
    const m = /"hook_event_name"\s*:\s*"([^"\\]*)"/.exec(head);
    if (m && (m[1] === 'PermissionRequest' || m[1].startsWith('Revview'))) return bail(null);
    return post(body).then(() => bail(null));
  }
  let ev;
  try {
    ev = JSON.parse(body.toString('utf8'));
  } catch {
    return bail('stdin is not JSON');
  }
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return bail('stdin is not a JSON object');
  const name = ev.hook_event_name;
  if (typeof name !== 'string' || name === 'PermissionRequest' || name.startsWith('Revview')) return bail(null);
  main(body, ev).catch(() => bail('failed'));
});
