// Registry of waiting PermissionRequest hook calls. A wheel button may answer
// one only if it is provably the prompt the driver has been looking at.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { optionLabel } from '../state/ask.js';

export const MIN_SHOWN_MS = 1500;
export const REQUEST_WAIT_MS = 540000;
export const DENY_MESSAGE = 'Denied with the wheel button.';
export const PLAN_DENY_MESSAGE = 'Not yet: keep planning. Denied with the wheel button.';

const no = (reason) => ({ ok: false, reason });

// An AskUserQuestion answer built from the request's own input: the exact option label, never the bar's text.
function questionDecision(input, { choice, label }) {
  if (input === null || input === undefined || typeof input !== 'object') return no('no-input');
  if (!Number.isInteger(choice)) return no('choice');
  const qs = input.questions;
  if (!Array.isArray(qs) || qs.length !== 1 || qs[0] === null || typeof qs[0] !== 'object') return no('not-one-question');
  const q = qs[0];
  if (q.multiSelect === true) return no('multi-select');
  const opt = Array.isArray(q.options) ? q.options[choice] : undefined;
  if (choice < 0 || typeof opt?.label !== 'string' || opt.label === '') return no('choice');
  if (typeof q.question !== 'string' || q.question === '') return no('choice');
  // every option must be one the bar shows: an option the bar dropped (no label, a blank one) would shift the bar's
  // positions against the request's, and the highlighted index would name another option
  if (!q.options.every((o) => o !== null && typeof o === 'object' && typeof o.label === 'string' && optionLabel(o.label) !== null)) return no('label-changed');
  if (optionLabel(opt.label) !== label) return no('label-changed');
  return { ok: true, decision: { behavior: 'allow', updatedInput: { questions: qs, answers: { [q.question]: opt.label } } } };
}

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

  function findHit(shown, chosen) {
    if (!shown) return no('no-prompt');
    if (typeof chosen !== 'string' || chosen === '' || shown.session !== chosen) return no('session');
    if (shown.since === null || shown.since === undefined) return no('unbound');
    const k = key(shown);
    if (shownKey === null || k !== shownKey) return no('not-shown-long-enough');
    if (clock() - shownAt < minShownMs) return no('too-early'); // the bar shows it, but not for long enough yet
    const hits = [];
    for (const [id, r] of reqs) if (r.bound && r.key === k) hits.push(id);
    if (hits.length === 0) return no('no-request');
    if (hits.length > 1) return no('ambiguous');
    return { ok: true, id: hits[0] };
  }

  return {
    add(prompt, respond, input = null) {
      if (reqs.size >= max) return null;
      const id = randomUUID();
      const bound = prompt.since !== null && prompt.since !== undefined;
      const r = { key: key(prompt), ident: ident(prompt), bound, respond, input };
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
    // the guards shared by answer() and check(): is this the one held request for the prompt the driver is looking at
    check(shown, chosen) {
      return findHit(shown, chosen);
    },
    answer(kind, shown, chosen, opts = {}) {
      if (kind !== 'allow' && kind !== 'deny') return no('kind');
      const hit = findHit(shown, chosen);
      if (!hit.ok) return hit;
      const input = reqs.get(hit.id).input;
      let decision;
      if (kind === 'deny') {
        decision = { behavior: 'deny', message: opts.plan === true ? PLAN_DENY_MESSAGE : DENY_MESSAGE };
      } else if (opts.choice !== undefined && opts.choice !== null) {
        const d = questionDecision(input, opts);
        if (!d.ok) return d;
        decision = d.decision;
      } else if (input !== null && input !== undefined) {
        return no('needs-choice'); // a bare allow must never answer a question with no answer
      } else {
        decision = { behavior: 'allow' };
      }
      finish(hit.id, decision);
      return { ok: true, id: hit.id };
    },
    size: () => reqs.size,
    close() {
      for (const id of [...reqs.keys()]) finish(id, null);
    },
  };
}
