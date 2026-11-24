// revview's own Claude Code sessions: one window per session in a PRIVATE tmux server.
// See README.md for the safety reasoning. All tmux calls go through an injectable exec (argv, no shell).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const execFileP = promisify(execFile);
const TIMEOUT_MS = 5000; // a tmux command that takes longer is killed and counts as failed (see `run`)
// timeoutMs: execFile kills the child (SIGKILL) when it runs too long
const defaultExec = (bin, args, { timeoutMs = TIMEOUT_MS } = {}) =>
  execFileP(bin, args, { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL' });

export const SEND_KEYS = Object.freeze(['Escape', 'C-c', 'Space']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WINDOW_RE = /^@\d+$/;
const NO_SERVER_RE = /no server running|error connecting|no sessions|can't find session|No such file or directory|server exited/i;
const SESSION = 'revview';
const GRACE_MS = 1500; // see `reap`
const UNSAFE_TEXT_RE = /[#\u0000-\u001f\u007f-\u009f]/;

// tmux expands formats and runs #(cmd): text with '#' or a control character must never reach it
export const isUnsafeText = (s) => UNSAFE_TEXT_RE.test(s);

// A captured screen is untrusted text: ANSI escapes and control characters go before it is logged or shown.
// Returns the last `max` lines, trailing blanks and tmux's own "Pane is dead" line dropped.
const ANSI_RE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g;
const CTRL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
export function cleanScreen(text, max = 20) {
  const lines = String(text ?? '').replace(ANSI_RE, '').replace(CTRL_RE, '').split('\n')
    .map((l) => l.replace(/\s+$/, '')).filter((l) => !/^Pane is dead \(/.test(l));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-max).map((l) => l.slice(0, 300));
}

const errText = (e) => `${e?.stderr ?? ''} ${e?.message ?? ''}`;

export function createSessionRunner({
  tmux = 'tmux',
  socket = { name: 'revview' },
  claude = ['claude'],
  exec = defaultExec,
  newId = randomUUID,
  log = () => {},
  now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  timeoutMs = TIMEOUT_MS,
} = {}) {
  const socketArgs = socket.path ? ['-S', socket.path] : ['-L', socket.name ?? 'revview'];
  // Every tmux command has a time limit: one that hangs must not stop the reap queue (and the owned list) for good.
  // A timeout is an error with timedOut set and no stderr, so no caller mistakes it for "no server" or empty output;
  // the default exec kills the child, and an injected exec that never settles is given up on a little later.
  const timedOut = (args) => Object.assign(new Error(`tmux ${args[0]} timed out after ${timeoutMs} ms`), { timedOut: true });
  const run = async (args) => {
    let timer;
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(timedOut(args)), timeoutMs + 250); });
    try {
      const r = await Promise.race([exec(tmux, ['-f', '/dev/null', ...socketArgs, ...args], { timeoutMs }), limit]);
      return String(r?.stdout ?? '');
    } catch (e) {
      if (e?.timedOut || (e?.killed && e?.signal === 'SIGKILL')) throw timedOut(args);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };

  async function list() {
    let out;
    try {
      out = await run(['list-windows', '-a', '-F', '#{window_id}\t#{@revview_id}\t#{pane_current_path}\t#{window_name}\t#{pane_dead}']);
    } catch (e) {
      if (NO_SERVER_RE.test(errText(e))) return [];
      throw e;
    }
    const rows = [];
    for (const line of out.split('\n')) {
      if (!line) continue;
      const [window, id, cwd = '', ...rest] = line.split('\t');
      if (!WINDOW_RE.test(window) || !UUID_RE.test(id ?? '')) continue;
      // the last field says whether Claude has exited (its window stays until `reap`): not a live session
      if (rest.length >= 2 && (rest[rest.length - 1] === '0' || rest[rest.length - 1] === '1')) {
        if (rest.pop() === '1') continue;
      }
      rows.push({ id, window, cwd, name: rest.join('\t') });
    }
    return rows;
  }

  async function serverHasSession() {
    try {
      await run(['has-session', '-t', `=${SESSION}`]);
      return true;
    } catch (e) {
      if (e?.timedOut) throw e; // not an answer: do not try new-session on a server that may well be there
      return false;
    }
  }

  async function start({ cwd, name } = {}) {
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('cwd must be an absolute path');
    // tmux expands formats in -c and -n and `#(cmd)` runs a shell command: refuse any text that could be one
    if (UNSAFE_TEXT_RE.test(cwd)) throw new Error('cwd must not contain "#" or control characters');
    if (name !== undefined && name !== null && (typeof name !== 'string' || UNSAFE_TEXT_RE.test(name))) {
      throw new Error('name must not contain "#" or control characters');
    }
    let st;
    try { st = fs.statSync(cwd); } catch { st = null; }
    if (!st?.isDirectory()) throw new Error(`cwd is not an existing directory: ${cwd}`);
    const id = newId();
    if (!UUID_RE.test(id)) throw new Error('session id must be a uuid');
    const winName = String(name || path.basename(cwd) || 'claude');
    const cmd = [...claude, '--session-id', id];
    const common = ['-d', '-P', '-F', '#{window_id}', '-c', cwd, '-n', winName];
    // remain-on-exit (set in the same tmux command line, before Claude can exit) keeps a window whose Claude ended,
    // so `reap` can read its last screen; reap then kills it
    const keep = [';', 'set-option', '-g', 'remain-on-exit', 'on'];
    const out = (await serverHasSession())
      ? await run(['new-window', ...common, '-t', `${SESSION}:`, '--', ...cmd, ...keep])
      : await run(['new-session', ...common, '-s', SESSION, '--', ...cmd, ...keep]);
    const window = out.trim();
    if (!WINDOW_RE.test(window)) throw new Error(`unexpected window id from tmux: ${JSON.stringify(window)}`);
    await run(['set-option', '-w', '-t', window, '@revview_id', id]);
    log(`session ${id} started in ${window}`);
    return { id, window, cwd };
  }

  // The session id always comes from the caller (the board's selection); nothing is remembered here.
  async function target(id) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
    const hit = (await list()).find((s) => s.id === id);
    if (!hit) {
      log(`session ${id} is gone`);
      return null;
    }
    return { id: hit.id, window: hit.window };
  }

  async function send(key, id) {
    if (!SEND_KEYS.includes(key)) throw new Error(`key not allowed: ${String(key)}`);
    if (typeof id !== 'string' || !UUID_RE.test(id)) return { sent: false, reason: 'no session selected' };
    const t = await target(id);
    if (!t || !WINDOW_RE.test(t.window)) return { sent: false, reason: 'selected session gone' };
    await run(['send-keys', '-t', t.window, key]);
    return { sent: true, id: t.id, window: t.window };
  }

  async function stop(id) {
    const hit = (await list()).find((s) => s.id === id);
    if (!hit) return false;
    await run(['kill-window', '-t', hit.window]);
    return true;
  }

  // Windows whose Claude has exited (kept by remain-on-exit): read the last screen lines, then kill the window, so
  // none piles up. Returns [{ id, name, status, lines }] (lines already cleaned, at most `maxLines`). One failing
  // window does not stop the others. A window revview stops itself (`stop`) is killed while alive and never shows here.
  //  - Only one reap runs at a time: a second call waits for the running one and then looks again (it finds nothing
  //    the first one took), so one ended session is never reported twice.
  //  - tmux can show pane_dead a moment before pane_dead_status is known: the status is asked again a few times, and
  //    while it is still unknown the pane is left for a later poll (a null status is reported only after GRACE_MS).
  //  - remain-on-exit is global on this private server (a per-window setting cannot be made in the same command line),
  //    so a window opened by hand has no @revview_id: such a dead window is killed (not reported), also after GRACE_MS,
  //    so that a window start() has just made and not yet tagged is never taken.
  //  - A capture that fails because the window is gone is dropped, not reported as an empty screen.
  const firstSeen = new Map(); // pane id -> time it was first seen dead
  let reapQueue = Promise.resolve();
  const reap = (opts) => {
    const p = reapQueue.then(() => reapOnce(opts));
    reapQueue = p.catch(() => {});
    return p;
  };
  async function reapOnce({ maxLines = 20 } = {}) {
    let out;
    try {
      out = await run(['list-panes', '-a', '-F', '#{window_id}\t#{pane_id}\t#{pane_dead}\t#{pane_dead_status}\t#{@revview_id}\t#{window_name}']);
    } catch (e) {
      if (NO_SERVER_RE.test(errText(e))) { firstSeen.clear(); return []; }
      throw e;
    }
    const t = now();
    const seenNow = new Set();
    const done = [];
    let nudged = false;
    for (const line of out.split('\n')) {
      const [window, pane, dead, status0 = '', id, ...rest] = line.split('\t');
      if (dead !== '1' || !WINDOW_RE.test(window ?? '') || !/^%\d+$/.test(pane ?? '')) continue;
      seenNow.add(pane);
      if (!firstSeen.has(pane)) firstSeen.set(pane, t);
      const aged = t - firstSeen.get(pane) >= GRACE_MS;
      if (!UUID_RE.test(id ?? '')) {
        if (aged) { try { await run(['kill-window', '-t', window]); } catch { /* gone already */ } }
        continue;
      }
      let status = status0;
      if (!/^\d+$/.test(status) && !nudged) {
        // tmux 3.4 can miss the SIGCHLD of a pane (seen with a pane started together with the server: 4 in 12 side by
        // side): the child stays a zombie and pane_dead_status never comes. Any other child the server waits for makes
        // its waitpid loop collect the zombie too, so one fixed, harmless child per reap (no text of ours in it).
        nudged = true;
        try { await run(['run-shell', 'true']); } catch { /* the asks below still run */ }
      }
      for (let i = 0; i < 3 && !/^\d+$/.test(status); i++) {
        await sleep(100);
        try { status = (await run(['display-message', '-p', '-t', pane, '#{pane_dead_status}'])).trim(); } catch { break; }
      }
      const known = /^\d+$/.test(status);
      if (!known && !aged) continue; // a later poll: the status may still arrive
      let lines = [];
      let captured = true;
      try { lines = cleanScreen(await run(['capture-pane', '-p', '-J', '-S', '-100', '-t', pane]), maxLines); } catch (e) { captured = false; log(`capture of ${id} failed: ${errText(e).trim()}`); }
      let killed = true;
      try { await run(['kill-window', '-t', window]); } catch (e) { killed = false; log(`kill of ${window} failed: ${errText(e).trim()}`); }
      if (!captured && !killed) continue; // the window is gone (another reaper, or by hand): nothing to report
      done.push({ id, name: rest.join('\t'), status: known ? Number(status) : null, lines });
    }
    for (const k of [...firstSeen.keys()]) if (!seenNow.has(k)) firstSeen.delete(k);
    return done;
  }

  async function killServer() {
    try {
      await run(['kill-server']);
    } catch (e) {
      if (!NO_SERVER_RE.test(errText(e))) throw e;
    }
  }

  return { start, list, target, send, stop, reap, killServer };
}
