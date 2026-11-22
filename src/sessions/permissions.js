// Registry of waiting PermissionRequest hook calls. A wheel button may answer
// one only if it is provably the prompt the driver has been looking at.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export const MIN_SHOWN_MS = 1500;
export const REQUEST_WAIT_MS = 540000;
export const DENY_MESSAGE = 'Denied with the wheel button.';

const key = (p) => JSON.stringify([p.session, p.agent, p.since, p.tool, p.file, p.command]);
const ident = (p) => JSON.stringify([p.session, p.agent, p.since]);

export function createPermissionRegistry({
  clock = () => performance.now(),
  minShownMs = MIN_SHOWN_MS,
  waitMs = REQUEST_WAIT_MS,
  max = 16,
  timers = { setTimeout, clearTimeout },
} = {}) {
  const reqs = new Map(); // id -> { key, ident, bound, respond, timer }
  let shownKey = null;
  let shownAt = 0;

  const finish = (id, decision) => {
    const r = reqs.get(id);
    if (!r) return;
    reqs.delete(id);
    timers.clearTimeout(r.timer);
    r.respond(decision);
  };

  return {
    add(prompt, respond) {
      if (reqs.size >= max) return null;
      const id = randomUUID();
      const bound = prompt.since !== null && prompt.since !== undefined;
      const r = { key: key(prompt), ident: ident(prompt), bound, respond };
      r.timer = timers.setTimeout(() => finish(id, null), waitMs);
      reqs.set(id, r);
      return id;
    },
    remove(id) {
      const r = reqs.get(id);
      if (!r) return;
      reqs.delete(id);
      timers.clearTimeout(r.timer);
    },
    observe(shown) {
      const k = shown ? key(shown) : null;
      if (k !== shownKey) {
        shownKey = k;
        shownAt = clock();
      }
    },
    sweep(live) {
      const set = new Set(live.map(ident));
      for (const [id, r] of [...reqs]) if (r.bound && !set.has(r.ident)) finish(id, null);
    },
    answer(kind, shown, chosen) {
      const no = (reason) => ({ ok: false, reason });
      if (kind !== 'allow' && kind !== 'deny') return no('kind');
      if (!shown) return no('no-prompt');
      if (typeof chosen !== 'string' || chosen === '' || shown.session !== chosen) return no('session');
      if (shown.since === null || shown.since === undefined) return no('unbound');
      const k = key(shown);
      if (shownKey === null || k !== shownKey || clock() - shownAt < minShownMs) return no('not-shown-long-enough');
      const hits = [];
      for (const [id, r] of reqs) if (r.bound && r.key === k) hits.push(id);
      if (hits.length === 0) return no('no-request');
      if (hits.length > 1) return no('ambiguous');
      const decision = kind === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: DENY_MESSAGE };
      finish(hits[0], decision);
      return { ok: true, id: hits[0] };
    },
    size: () => reqs.size,
    close() {
      for (const id of [...reqs.keys()]) finish(id, null);
    },
  };
}
