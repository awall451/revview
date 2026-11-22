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
  let chosenId = null;

  async function list() {
    let out;
    try {
      out = await run(['list-windows', '-a', '-F', '#{window_id}\t#{@revview_id}\t#{pane_current_path}\t#{window_name}']);
    } catch (e) {
      if (NO_SERVER_RE.test(errText(e))) return [];
      throw e;
    }
    const rows = [];
    for (const line of out.split('\n')) {
      if (!line) continue;
      const [window, id, cwd = '', ...rest] = line.split('\t');
      if (!WINDOW_RE.test(window) || !UUID_RE.test(id ?? '')) continue;
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
    const out = (await serverHasSession())
      ? await run(['new-window', ...common, '-t', `${SESSION}:`, '--', ...cmd])
      : await run(['new-session', ...common, '-s', SESSION, '--', ...cmd]);
    const window = out.trim();
    if (!WINDOW_RE.test(window)) throw new Error(`unexpected window id from tmux: ${JSON.stringify(window)}`);
    await run(['set-option', '-w', '-t', window, '@revview_id', id]);
    chosenId = id;
    log(`session ${id} started in ${window}`);
    return { id, window, cwd };
  }

  async function choose(id) {
    if (!(await list()).some((s) => s.id === id)) return false;
    chosenId = id;
    return true;
  }

  const chosen = () => chosenId;

  async function target() {
    if (!chosenId) return null;
    const want = chosenId;
    const hit = (await list()).find((s) => s.id === want);
    if (!hit) {
      if (chosenId === want) chosenId = null;
      log(`chosen session ${want} is gone`);
      return null;
    }
    return { id: hit.id, window: hit.window };
  }

  async function send(key) {
    if (!SEND_KEYS.includes(key)) throw new Error(`key not allowed: ${String(key)}`);
    if (!chosenId) return { sent: false, reason: 'no session chosen' };
    const t = await target();
    if (!t || !WINDOW_RE.test(t.window)) return { sent: false, reason: 'chosen session gone' };
    await run(['send-keys', '-t', t.window, key]);
    return { sent: true, id: t.id, window: t.window };
  }

  async function stop(id) {
    const hit = (await list()).find((s) => s.id === id);
    if (!hit) return false;
    await run(['kill-window', '-t', hit.window]);
    if (chosenId === id) chosenId = null;
    return true;
  }

  async function killServer() {
    try {
      await run(['kill-server']);
    } catch (e) {
      if (!NO_SERVER_RE.test(errText(e))) throw e;
    }
    chosenId = null;
  }

  return { start, list, choose, chosen, target, send, stop, killServer };
}
