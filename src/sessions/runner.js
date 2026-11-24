// revview's own Claude Code sessions: one window per session in a PRIVATE tmux server.
// See README.md for the safety reasoning. All tmux calls go through an injectable exec (argv, no shell).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const execFileP = promisify(execFile);
const defaultExec = (bin, args) => execFileP(bin, args, { encoding: 'utf8' });

export const SEND_KEYS = Object.freeze(['Escape', 'C-c', 'Space']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WINDOW_RE = /^@\d+$/;
const NO_SERVER_RE = /no server running|error connecting|no sessions|can't find session|No such file or directory|server exited/i;
const SESSION = 'revview';
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
} = {}) {
  const socketArgs = socket.path ? ['-S', socket.path] : ['-L', socket.name ?? 'revview'];
  const run = async (args) => {
    const r = await exec(tmux, ['-f', '/dev/null', ...socketArgs, ...args]);
    return String(r?.stdout ?? '');
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
    } catch {
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
  async function reap({ maxLines = 20 } = {}) {
    let out;
    try {
      out = await run(['list-panes', '-a', '-F', '#{window_id}\t#{pane_id}\t#{pane_dead}\t#{pane_dead_status}\t#{@revview_id}\t#{window_name}']);
    } catch (e) {
      if (NO_SERVER_RE.test(errText(e))) return [];
      throw e;
    }
    const done = [];
    for (const line of out.split('\n')) {
      const [window, pane, dead, status = '', id, ...rest] = line.split('\t');
      if (dead !== '1' || !WINDOW_RE.test(window ?? '') || !/^%\d+$/.test(pane ?? '') || !UUID_RE.test(id ?? '')) continue;
      let lines = [];
      try { lines = cleanScreen(await run(['capture-pane', '-p', '-J', '-S', '-100', '-t', pane]), maxLines); } catch (e) { log(`capture of ${id} failed: ${errText(e).trim()}`); }
      try { await run(['kill-window', '-t', window]); } catch (e) { log(`kill of ${window} failed: ${errText(e).trim()}`); }
      done.push({ id, name: rest.join('\t'), status: /^\d+$/.test(status) ? Number(status) : null, lines });
    }
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
