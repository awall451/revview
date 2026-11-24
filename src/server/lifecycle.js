import fs from 'node:fs';

export const LAUNCH_LIMIT_MS = 30000;
// a compaction took 5-7 s in the recordings and 1-2 min in long sessions; this bounds a lost end event
export const COMPACT_LIMIT_MS = 180000;

// The server's lifecycle: the project marks and the owned-sessions poll, the launch and compaction timers,
// the runner the actions get. Per-server state is in the closure and on ctx (launchTimers, compactTimers, clearT:
// close() reads them there); nothing at module level.
// Sets ctx.compactSync, ctx.launchTimers, ctx.compactTimers, ctx.clearT.
export function createLifecycle(ctx, { projects, timers, launchLimitMs, compactLimitMs }) {
  const { sessions, dataLock } = ctx;
  // owned = the sessions revview itself started (the runner's windows); null without a runner (the old look)
  // project folders that do not exist are marked in the New session rows; re-checked on the owned poll (no timer of its own)
  let missingKey = null;
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  function applyProjects() {
    const missing = projects.filter((p) => !isDir(p));
    const k = JSON.stringify(missing);
    if (k === missingKey) return;
    missingKey = k;
    ctx.apply({ hook_event_name: 'RevviewProjects', paths: projects, missing }, true);
  }
  let lastOwned = new Map(); // id -> name of the windows the last listing had (only to log the ones that vanish)
  // One refresh at a time: a caller that comes while one runs shares a single later run (it then sees what changed
  // meanwhile), so a slow or hung tmux never piles up one pending refresh per poll.
  let ownedRun = null;
  let ownedAgain = null;
  function refreshOwned() {
    if (!ownedRun) {
      ownedRun = refreshOwnedOnce().finally(() => { ownedRun = null; });
      return ownedRun;
    }
    ownedAgain ??= ownedRun.then(() => { ownedAgain = null; return refreshOwned(); });
    return ownedAgain;
  }
  async function refreshOwnedOnce() {
    applyProjects();
    if (!sessions) return;
    try {
      // Claude windows that exited stay until read here (remain-on-exit): the last screen lines go to the log (the
      // journal under the user unit; untrusted text, at most 20 lines) and the last non-empty one to the bar
      for (const r of (await sessions.reap?.()) ?? []) {
        lastOwned.delete(r.id); // its end is logged below: not a second "disappeared" line
        console.error(`owned sessions: Claude of session ${r.id}${r.name ? ` (${r.name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')})` : ''} ended${r.status === null ? '' : ` with status ${r.status}`}; ${r.lines.length === 0 ? 'its screen was empty' : `last ${r.lines.length} screen line(s):`}`);
        for (const l of r.lines) console.error(`  | ${l}`);
        if (!ctx.closed) ctx.apply({ hook_event_name: 'RevviewEndReason', session_id: r.id, text: [...r.lines].reverse().find((l) => l.trim() !== '') ?? '' }, true);
      }
      const list = await sessions.list();
      const now = new Map(list.map((x) => [x.id, x.name]));
      for (const [id, name] of lastOwned) {
        if (!now.has(id)) console.error(`owned sessions: window of session ${id}${typeof name === 'string' && name !== '' ? ` (${name})` : ''} disappeared (Claude exited or the window was closed)`);
      }
      lastOwned = now;
      if (!ctx.closed) ctx.apply({ hook_event_name: 'RevviewOwned', ids: list.map((x) => x.id), names: list.map((x) => x.name) }, true);
    } catch (e) {
      console.error('owned sessions: list failed:', e instanceof Error ? e.message : e);
    }
  }
  // while the data is locked no Claude session may start (the key-on one waits, New session is refused)
  const guarded = sessions && dataLock ? {
    ...sessions,
    start: async (...a) => {
      if (ctx.dataMonitor?.check() ?? true) throw new Error('data is locked: insert the key stick');
      return sessions.start(...a);
    },
  } : sessions;
  // a session revview just started shows STARTING until its first hook, but at most launchLimitMs
  const setT = timers?.setTimeout ?? setTimeout;
  const clearT = timers?.clearTimeout ?? clearTimeout;
  const launchTimers = new Map();
  function launched(id, keyon = false) {
    if (ctx.closed || typeof id !== 'string') return;
    ctx.apply({ hook_event_name: 'RevviewLaunching', session_id: id, ...(keyon ? { keyon: true } : {}) }, true);
    if (launchTimers.has(id)) clearT(launchTimers.get(id));
    const t = setT(() => {
      launchTimers.delete(id);
      if (!ctx.closed) ctx.apply({ hook_event_name: 'RevviewLaunchExpired', session_id: id }, true);
    }, launchLimitMs);
    t?.unref?.();
    launchTimers.set(id, t);
  }
  // a PreCompact marks the session as compacting; the mark ends with the next event, or after compactLimitMs
  const compactTimers = new Map();
  function compactStarted(id) {
    if (ctx.closed) return;
    if (compactTimers.has(id)) clearT(compactTimers.get(id));
    const t = setT(() => {
      compactTimers.delete(id);
      if (!ctx.closed) ctx.apply({ hook_event_name: 'RevviewCompactExpired', session_id: id }, true);
    }, compactLimitMs);
    t?.unref?.();
    compactTimers.set(id, t);
  }
  // after every posted event: arm the timer only when the board's session really is compacting, drop it otherwise
  function compactSync(id, started) {
    const on = ctx.board.sessions?.[id]?.state?.compacting === true;
    if (on && started) compactStarted(id);
    else if (!on && compactTimers.has(id)) {
      clearT(compactTimers.get(id));
      compactTimers.delete(id);
    }
  }
  const marked = sessions ? {
    ...guarded,
    start: async (...a) => {
      const r = await guarded.start(...a);
      launched(r?.id);
      return r;
    },
  } : guarded;
  ctx.compactSync = compactSync;
  ctx.launchTimers = launchTimers;
  ctx.compactTimers = compactTimers;
  ctx.clearT = clearT;
  return { applyProjects, refreshOwned, launched, runner: marked };
}
