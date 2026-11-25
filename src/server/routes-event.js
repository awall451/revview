import { selectedKey } from '../state/index.js';
import { text } from './http.js';

export const MAX_BODY_BYTES = 1024 * 1024;
const PREFIX_BYTES = 64 * 1024; // of an oversize body, kept to tell whether it was a hook event
const PREFIX_WAIT_MS = 2000; // how long to wait for a prefix when only Content-Length was over the limit
const SESSION_ID_RE = /"session_id"\s*:\s*"([^"\\]{1,200})"/;
const EVENT_NAME_RE = /"hook_event_name"\s*:\s*"([A-Za-z]{1,64})"/;
const TOOL_NAME_RE = /"tool_name"\s*:\s*"([^"\\]{1,200})"/;
const DIFF_TOOLS = ['Edit', 'Write', 'MultiEdit']; // the only tools whose PostToolUse counts diff (src/state/diff.js)
const BUTTON_RE = /^[a-z][a-z0-9-]{0,31}$/;
const GESTURES = ['tap', 'hold', 'long-hold'];
// made only by revview itself (the actions, the boot path): no POST may forge them, not even under --dev-bridge
const INTERNAL_EVENTS = ['RevviewInterrupted', 'RevviewAnswered', 'RevviewSelect', 'RevviewNav', 'RevviewOwned', 'RevviewProjects', 'RevviewNote', 'RevviewBootBegin', 'RevviewBootDone', 'RevviewLaunching', 'RevviewLaunchExpired', 'RevviewNoSessionPress', 'RevviewCompactExpired', 'RevviewEndReason', 'RevviewThermal', 'RevviewSounds'];

// A body over the limit that still looks like a hook event means an event was lost (QA issue 11).
export function noteDropped(ctx, prefix) {
  // Only a lost PostToolUse of a diff tool makes +N -N wrong; any other lost event (a huge Read or Bash
  // output, a PreToolUse) changes no count, so it is not marked. Claude Code writes session_id first and
  // tool_name before tool_input, so they are in the prefix (and the first match is the real field).
  const head = prefix.toString('utf8');
  const name = EVENT_NAME_RE.exec(head);
  if (!name || name[1] !== 'PostToolUse') return;
  const tool = TOOL_NAME_RE.exec(head);
  if (tool && !DIFF_TOOLS.includes(tool[1])) return;
  const m = SESSION_ID_RE.exec(head);
  ctx.apply(m ? { hook_event_name: 'RevviewDropped', session_id: m[1] } : { hook_event_name: 'RevviewDropped' }, true);
}

export function readBody(ctx, req, res, done) {
  const declared = Number(req.headers['content-length']);
  let size = 0;
  let kept = 0;
  const chunks = [];
  const prefix = []; // first PREFIX_BYTES of the body, for an oversize one
  let finished = false;
  let timer = null;
  const keep = (c) => {
    if (kept >= PREFIX_BYTES) return;
    const part = c.subarray(0, PREFIX_BYTES - kept);
    prefix.push(part);
    kept += part.length;
  };
  const tooBig = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    req.removeAllListeners('data');
    req.removeAllListeners('end');
    chunks.length = 0;
    res.on('finish', () => req.socket.destroy());
    text(res, 413, 'body too large (max 1 MiB)', { connection: 'close' });
    noteDropped(ctx, Buffer.concat(prefix));
  };
  if (declared > MAX_BODY_BYTES) {
    // nothing counted yet: wait briefly for up to 64 KiB so the prefix can be looked at
    timer = setTimeout(tooBig, PREFIX_WAIT_MS);
    req.on('data', (c) => {
      if (finished) return;
      keep(c);
      if (kept >= PREFIX_BYTES) tooBig();
    });
    req.on('end', tooBig);
    return;
  }
  req.on('data', (c) => {
    if (finished) return;
    keep(c);
    size += c.length;
    if (size > MAX_BODY_BYTES) return tooBig();
    chunks.push(c);
  });
  req.on('end', () => {
    if (finished) return;
    finished = true;
    done(Buffer.concat(chunks).toString('utf8'));
  });
}

export function postEvent(ctx, req, res) {
  readBody(ctx, req, res, (body) => {
    let event;
    try {
      event = JSON.parse(body);
    } catch {
      return text(res, 400, body.trim() === '' ? 'empty body' : 'malformed JSON');
    }
    if (event === null || typeof event !== 'object' || Array.isArray(event)) {
      return text(res, 400, 'body must be a JSON object');
    }
    // Gestures and presence come only from the in-process reader (or the dev bridge): a local process
    // without an Origin header must not be able to forge a press or the NO BUTTONS state.
    if (!ctx.devBridge && (event.hook_event_name === 'RevviewButton' || event.hook_event_name === 'RevviewInput')) {
      return text(res, 403, `${event.hook_event_name} is not accepted over HTTP (dev bridge only)`);
    }
    // internal only: it makes a screen state from a key revview sent itself, so no POST may forge it
    if (INTERNAL_EVENTS.includes(event.hook_event_name)) {
      return text(res, 403, `${event.hook_event_name} is internal and not accepted over HTTP`);
    }
    // with a data lock the mount table decides: a posted RevviewDataLock is only a poke to re-read it
    if (ctx.dataLock && event.hook_event_name === 'RevviewDataLock') {
      ctx.dataMonitor?.check();
      return res.writeHead(204).end();
    }
    // with --netmon the probe decides: a posted RevviewNetwork is only a poke to probe again
    if (ctx.monitor && event.hook_event_name === 'RevviewNetwork') {
      ctx.monitor.check();
      return res.writeHead(204).end();
    }
    // the server makes these states itself (--boot, --data-lock, --netmon): outside the dev bridge nothing may post them
    // (a posted RevviewStarting with no session would stay on screen, a posted RevviewDataLock without --data-lock
    // would show INSERT KEY while New session still starts, a posted RevviewNetwork without --netmon would show OFFLINE
    // with nothing to bring it back)
    if (!ctx.devBridge && ['RevviewStarting', 'RevviewDataLock', 'RevviewNetwork'].includes(event.hook_event_name)) {
      return text(res, 403, `${event.hook_event_name} is not accepted over HTTP (dev bridge only)`);
    }
    if (!ctx.apply(event)) return text(res, 500, 'state core failed; event ignored');
    if (typeof event.session_id === 'string') ctx.compactSync(event.session_id, event.hook_event_name === 'PreCompact');
    try {
      ctx.readAloud?.onEvent(event, ctx.board, selectedKey(ctx.board));
    } catch (e) {
      console.error('read aloud failed:', e instanceof Error ? e.message : e);
    }
    if (event.hook_event_name === 'RevviewButton' && typeof event.button === 'string'
      && BUTTON_RE.test(event.button) && GESTURES.includes(event.gesture)) {
      ctx.acceptGesture({ button: event.button, gesture: event.gesture, source: 'post' });
    }
    res.writeHead(204).end();
  });
}
