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

const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

// An AskUserQuestion answer: the request's own questions, one answer per question, each an exact option label.
const validAnswer = (d, input) => {
  const u = d.updatedInput;
  if (!isObj(u) || !isObj(input)) return false;
  const uk = Object.keys(u);
  if (uk.length !== 2 || !uk.includes('questions') || !uk.includes('answers')) return false;
  if (JSON.stringify(u.questions) !== JSON.stringify(input.questions) || !Array.isArray(input.questions)) return false;
  if (!isObj(u.answers)) return false;
  const names = Object.keys(u.answers);
  if (names.length === 0) return false;
  return names.every((name) => {
    const q = input.questions.find((x) => isObj(x) && x.question === name);
    return q !== undefined && typeof u.answers[name] === 'string' && Array.isArray(q.options)
      && q.options.some((o) => isObj(o) && o.label === u.answers[name]);
  });
};

const valid = (d, stdin) => {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
  const keys = Object.keys(d);
  if (d.behavior === 'allow') {
    if (keys.length === 1) return true;
    return keys.length === 2 && keys.includes('updatedInput') && isObj(stdin) && stdin.tool_name === 'AskUserQuestion'
      && validAnswer(d, stdin.tool_input);
  }
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
  let stdin;
  try {
    stdin = JSON.parse(body.toString('utf8'));
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
        if (!valid(d, stdin)) return bail('refused response');
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
