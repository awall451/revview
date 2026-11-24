import path from 'node:path';
import { KEYON_ENDED_NOTE } from '../state/index.js';

// Key-on: after the server listens, make sure there is a session. No windows (tmux died with the power) ->
// start one per dir; exactly one (a service restart) -> select it; several -> select none. Never throws.
// Whatever happens the boot STARTING ends (live.bootDone, after any select: a select clears the note), so the bar's
// buttons work; a failure leaves a short note. If it takes longer than bootLimitMs the STARTING ends with a note and
// the start goes on (a later success still selects the session; a later bootDone is a no-op).
export async function bootSessions({ runner, live, dirs = [], log = () => {}, timers = { setTimeout, clearTimeout }, bootLimitMs = 60000 }) {
  const timer = timers.setTimeout(() => live.bootDone?.('Key-on session is slow to start: see the server log'), bootLimitMs);
  timer?.unref?.();
  let id = null;
  let note;
  let noteKind; // absent = plain (see NOTE_RULES in src/state/board.js)
  try {
    const existing = await runner.list();
    if (existing.length > 0) {
      if (existing.length === 1) {
        live.select(existing[0].id);
        id = existing[0].id;
      }
    } else if (dirs.length === 0) {
      note = 'No session yet: open the menu for New session';
      noteKind = 'no-session';
    } else {
      const relative = dirs.find((d) => !path.isAbsolute(d));
      if (relative !== undefined) {
        log(`boot sessions: REVVIEW_START must be an absolute folder, got ${relative}`);
        note = 'Key-on session not started: start folder must be an absolute path';
      } else {
        let last = null;
        for (const dir of dirs) {
          last = (await runner.start({ cwd: dir })).id;
          live.launched?.(last, true);
        }
        await live.refreshOwned();
        live.select(last);
        id = last;
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // tmux says the window or its whole server is gone: Claude exited at once (sign-in expired, a broken update)
    const gone = /no server running|can't find (window|pane|session)|no such (window|session)|server exited/i.test(msg);
    log(gone ? `boot sessions: Claude exited at once, its window disappeared before it could be set up (${msg})` : `boot sessions: ${msg}`);
    note = msg.startsWith('cwd is not an existing directory')
      ? 'Key-on session not started: start folder missing'
      : gone ? KEYON_ENDED_NOTE
        : 'Key-on session not started: see the server log';
    // the Claude that exited at once leaves an ended note (a push-to-talk tap with no session clears it)
    if (gone && !msg.startsWith('cwd is not an existing directory')) noteKind = 'ended';
  }
  timers.clearTimeout(timer);
  live.bootDone?.(note, noteKind);
  return id;
}

// Key-on with a data lock: the boot session waits for the unlock; never blocks the caller, never throws.
export function bootAfterUnlock({ live, runner, dirs = [], log = () => {}, timers, bootLimitMs }) {
  return live.whenUnlocked().then(() => {
    log('boot: data unlocked, starting the key-on session');
    return bootSessions({ runner, live, dirs, log, timers, bootLimitMs });
  });
}

// The TCP probe target of --netmon from REVVIEW_NETMON_HOST (host or host:port). A bad value is logged and the
// default is used: a typo in the environment must not stop the bar.
export function netmonTarget(value, log = () => {}) {
  const fallback = { host: 'api.anthropic.com', port: 443 };
  if (!value) return fallback;
  const m = /^([A-Za-z0-9._-]+)(?::(\d{1,5}))?$/.exec(value);
  if (!m || (m[2] !== undefined && (Number(m[2]) < 1 || Number(m[2]) > 65535))) {
    log(`REVVIEW_NETMON_HOST must be host or host:port, got ${value}; using api.anthropic.com:443`);
    return fallback;
  }
  return { host: m[1], port: m[2] === undefined ? 443 : Number(m[2]) };
}

// SIGTERM/SIGINT: close the server (which stops the grab helper), then exit 0.
export function installShutdown(server, proc = process) {
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    Promise.resolve().then(() => server.close()).catch(() => {}).finally(() => proc.exit(0));
  };
  proc.on('SIGTERM', stop);
  proc.on('SIGINT', stop);
}
