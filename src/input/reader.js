// Device reader: finds the configured input device, reads its events, reports presence and keys,
// and retries when the device is missing or lost. See docs/BUTTONS.md section 1.
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createEventParser, EVENT_SIZE, EV_KEY, EV_SYN, SYN_DROPPED, SYN_REPORT } from './evdev.js';
import { parseProcDevices, matchDevice } from './devices.js';

const GRAB_PY = fileURLToPath(new URL('./grab.py', import.meta.url));

// Real stream. grab: the python helper holds EVIOCGRAB; otherwise a plain file or FIFO (a fake device).
export function openStream(path, { grab, spawn: spawnFn = spawn, parentPid = process.pid }) {
  const em = new EventEmitter();
  let child = null;
  let rs = null;
  let done = false;
  const end = (err) => {
    if (done) return;
    done = true;
    em.emit('end', err);
  };
  if (grab) {
    child = spawnFn('python3', [GRAB_PY, path, String(parentPid)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let errText = '';
    let ready = false;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (t) => {
      errText += t;
      if (!ready && errText.includes('revview-grab: ok\n')) {
        ready = true;
        em.emit('ready');
      }
    });
    child.stdout.on('data', (b) => { if (!done) em.emit('data', b); });
    child.on('error', (e) => end(e));
    child.on('close', (code) => end(new Error(errText.trim() || `grab helper exited ${code}`)));
  } else {
    rs = createReadStream(path);
    rs.on('open', () => em.emit('ready'));
    rs.on('data', (b) => { if (!done) em.emit('data', b); });
    rs.on('end', () => end());
    rs.on('error', (e) => end(e));
  }
  em.close = () => {
    done = true;
    if (child) child.kill('SIGTERM');
    if (rs) rs.destroy();
  };
  return em;
}

const realDeps = () => ({
  readProcDevices: () => readFile('/proc/bus/input/devices', 'utf8'),
  exists: (p) => access(p).then(() => true, () => false),
  openStream,
  setTimeout,
  clearTimeout,
  eventSize: EVENT_SIZE,
});

export function createDeviceReader({
  device, keys = [], onKey, onSync, onPresence, onLost, log = console.error, retryMs = 1000, deps = {},
}) {
  const d = { ...realDeps(), ...deps };
  let stopped = true;
  let gen = 0; // bumped on stop/start so stale async work is ignored
  let stream = null;
  let timer = null;
  let presence; // undefined until the first report
  let lastLog = null;

  const safe = (fn, ...args) => {
    try { fn?.(...args); } catch (e) { say(`callback failed: ${e?.message ?? e}`); }
  };
  function say(msg) {
    if (msg === lastLog) return;
    lastLog = msg;
    try { log(`revview input: ${msg}`); } catch { /* ignore */ }
  }
  function setPresence(p) {
    if (presence === p) return;
    presence = p;
    lastLog = null;
    safe(onPresence, p);
  }
  const MAX_BACKOFF_MS = 30000;
  let delay = retryMs; // next retry delay after an open/grab failure (doubles up to MAX_BACKOFF_MS)
  let lastPath = null; // the path of the previous attempt
  function retry(ms = retryMs) {
    if (stopped) return;
    timer = d.setTimeout(() => { timer = null; attempt(); }, ms);
    timer?.unref?.();
  }

  async function locate() {
    // An explicit path is used alone: never fall back to matching, which could grab another keyboard.
    if (device.path) return (await d.exists(device.path)) ? device.path : null;
    try {
      return matchDevice(parseProcDevices(await d.readProcDevices()), device, keys);
    } catch (e) {
      say(`cannot read device list: ${e?.message ?? e}`);
      return null;
    }
  }

  async function attempt() {
    const my = gen;
    let path = null;
    try { path = await locate(); } catch (e) { say(`lookup failed: ${e?.message ?? e}`); }
    if (stopped || my !== gen) return;
    if (!path) {
      setPresence(false);
      say('device not found');
      delay = retryMs;
      lastPath = null;
      retry();
      return;
    }
    if (path !== lastPath) delay = retryMs;
    lastPath = path;
    const parser = createEventParser({ size: d.eventSize });
    let s;
    try {
      s = d.openStream(path, { grab: device.grab });
    } catch (e) {
      safe(onLost);
      setPresence(false);
      say(`cannot open ${path}: ${e?.message ?? e}`);
      retry(delay);
      delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      return;
    }
    stream = s;
    let over = false;
    const live = () => !stopped && my === gen && !over;
    let ready = false;
    s.on('ready', () => {
      if (!live()) return;
      ready = true;
      delay = retryMs;
      setPresence(true);
    });
    let dropping = false; // after SYN_DROPPED the events up to the next SYN_REPORT are stale: skip them
    s.on('data', (buf) => {
      if (!live()) return;
      for (const ev of parser.push(buf)) {
        if (ev.type === EV_KEY) { if (!dropping) safe(onKey, ev.code, ev.value); }
        else if (ev.type === EV_SYN && ev.code === SYN_DROPPED) { dropping = true; safe(onSync, 'dropped'); }
        else if (ev.type === EV_SYN && ev.code === SYN_REPORT) dropping = false;
      }
    });
    s.on('end', (err) => {
      if (!live()) return;
      over = true;
      try { s.close(); } catch { /* ignore */ }
      stream = null;
      safe(onLost);
      setPresence(false);
      say(err ? `lost ${path}: ${err.message ?? err}` : `lost ${path}`);
      if (ready) retry(retryMs);
      else { retry(delay); delay = Math.min(delay * 2, MAX_BACKOFF_MS); }
    });
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      delay = retryMs;
      lastPath = null;
      gen++;
      attempt();
    },
    stop() {
      stopped = true;
      gen++;
      if (timer !== null) d.clearTimeout(timer);
      timer = null;
      if (stream) {
        try { stream.close(); } catch { /* ignore */ }
        stream = null;
      }
    },
  };
}
