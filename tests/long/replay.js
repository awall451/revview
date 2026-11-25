// Long-run replay of the recorded Claude Code sessions (fixtures/sessions/*.jsonl), looped, several at once, on a
// simulated clock that runs `speedup` times faster than the wall clock. Used by tests/long/drive.js (run on request,
// see docs/LONG-DRIVE.md) and smoke-tested by tests/unit/long-replay.test.js.
//
// A recording has no timestamps, so the timing is made up and fixed: `gapSimMs` between two events of a session,
// `pauseSimMs` between the end of one session and the start of the next one of the same stream. Nothing is random:
// two runs post the same events in the same order. Every loop of a stream is a NEW session: the session id (and
// every place it appears, such as transcript_path) is rewritten, the rest of each event is the recording's.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { performance } from 'node:perf_hooks';

export const DEFAULTS = Object.freeze({ streams: 4, gapSimMs: 4000, pauseSimMs: 60000 });

// [{ name, id, events: [object] }] from a directory of *.jsonl, sorted by name. A session that does not end with
// SessionEnd gets one added (a real session that stays open forever would pile up in the board; none of the
// recordings needs this today).
export function loadSessions(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().map((f) => {
    const events = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    const id = events[0].session_id;
    if (events.at(-1).hook_event_name !== 'SessionEnd') events.push({ session_id: id, hook_event_name: 'SessionEnd', reason: 'other' });
    return { name: f.replace(/\.jsonl$/, ''), id, events };
  });
}

const hex = (n, width) => n.toString(16).padStart(width, '0').slice(-width);

// The events of session `n` of stream `s`: same recording, new session id (uuid-shaped, unique per stream and loop).
export function instance(session, stream, n) {
  const id = session.id.slice(0, 24) + hex(stream, 2) + hex(n, 10);
  return session.events.map((e) => JSON.parse(JSON.stringify(e).replaceAll(session.id, id)));
}

// POST one event to <url>/event. Resolves with the HTTP status, or 0 when the server could not be reached.
export function postEvent(url, event) {
  return new Promise((resolve) => {
    const body = JSON.stringify(event);
    const req = http.request(`${url}/event`, { method: 'POST', agent: false, timeout: 5000, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
      res.on('error', () => resolve(0));
    });
    req.on('error', () => resolve(0));
    req.on('timeout', () => req.destroy());
    req.end(body);
  });
}

// The replay. `post(event)` resolves with a status (2xx is ok, anything else is counted as failed and NOT retried:
// a hook that cannot reach the server loses its event, as on the appliance). `now()` is the wall clock in ms.
export function createReplay({ sessions, post, now = () => performance.now(), speedup, streams = DEFAULTS.streams, gapSimMs = DEFAULTS.gapSimMs, pauseSimMs = DEFAULTS.pauseSimMs }) {
  let acc = 0; // simulated ms before the last resume
  let since = null; // wall time of the last resume; null while paused
  const stats = { posted: 0, ok: 0, failed: 0, sessions: 0, bySession: {} };
  const lanes = Array.from({ length: streams }, (_, s) => ({ s, k: s % sessions.length, n: 0, events: null, i: 0, at: s * 7000, chain: Promise.resolve() }));

  const simNow = () => acc + (since === null ? 0 : (now() - since) * speedup);

  function nextEvent(lane) {
    if (lane.events === null) {
      const session = sessions[lane.k];
      lane.events = instance(session, lane.s, lane.n);
      lane.i = 0;
      stats.sessions++;
      stats.bySession[session.name] = (stats.bySession[session.name] ?? 0) + 1;
    }
    const event = lane.events[lane.i++];
    if (lane.i < lane.events.length) lane.at += gapSimMs;
    else {
      lane.events = null;
      lane.k = (lane.k + 1) % sessions.length;
      lane.n++;
      lane.at += pauseSimMs + lane.s * 5000;
    }
    return event;
  }

  function send(lane, event) {
    stats.posted++;
    // one lane posts in order; lanes do not wait for each other
    lane.chain = lane.chain.then(async () => {
      let status = 0;
      try { status = await post(event); } catch { status = 0; }
      if (status >= 200 && status < 300) stats.ok++;
      else stats.failed++;
    });
  }

  return {
    stats,
    simNow,
    running: () => since !== null,
    resume() { if (since === null) since = now(); },
    pause() { if (since !== null) { acc = simNow(); since = null; } },
    // post everything that is due on the simulated clock; returns how many events were posted
    tick() {
      if (since === null) return 0;
      const sim = simNow();
      let n = 0;
      for (const lane of lanes) while (lane.at <= sim) { send(lane, nextEvent(lane)); n++; }
      return n;
    },
    // resolves when every POST made so far has been answered
    async drain() { await Promise.all(lanes.map((l) => l.chain)); },
  };
}
