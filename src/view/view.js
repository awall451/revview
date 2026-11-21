// The glance view: renders a reducer state (see src/state/README.md) as a state band and two lines.
import { mmToPx } from './panel.js';
import { TYPE_MM } from './type.js';
import { middleEllipsis, formatCount } from './fit.js';

const LABELS = {
  working: 'WORKING',
  waiting: 'WAITING FOR ME',
  permission: 'NEEDS PERMISSION',
  done: 'DONE',
  starting: 'STARTING',
  offline: 'OFFLINE',
  'insert-key': 'INSERT KEY',
  none: 'NO STATE',
};

// Shapes (viewBox 0 0 24 24, drawn in currentColor). Colour is not the only cue: each state has its own shape.
const SHAPES = {
  working: '<circle cx="12" cy="12" r="10.5" fill="currentColor"/>',
  waiting: '<rect x="3" y="2" width="6.5" height="20" fill="currentColor"/><rect x="14.5" y="2" width="6.5" height="20" fill="currentColor"/>',
  permission: '<path d="M12 1.5 23.5 22.5H.5Z" fill="currentColor"/>',
  done: '<path d="M2.5 13 9 19.5 21.5 4.5" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linejoin="miter"/>',
  starting: '<circle cx="12" cy="12" r="8.75" fill="none" stroke="currentColor" stroke-width="3.5"/>',
  offline: '<path d="M3.5 3.5 20.5 20.5M20.5 3.5 3.5 20.5" fill="none" stroke="currentColor" stroke-width="4.5"/>',
  'insert-key': '<circle cx="7" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="3"/><path d="M12 12H23M18.5 12v5M23 12v4" fill="none" stroke="currentColor" stroke-width="3"/>',
  none: '<rect x="2.5" y="2.5" width="19" height="19" fill="currentColor"/>',
};

const $ = (id) => document.getElementById(id);
const str = (v) => (typeof v === 'string' ? v : '');
const ids = ['band', 'shape', 'state-word', 'where', 'tool', 'file', 'note1', 'note2', 'diff', 'diff-added',
  'diff-removed', 'cmdbox', 'command', 'output', 'line2', 'line3'];
const el = Object.fromEntries(ids.map((id) => [id, $(id)]));

// ---- type sizes: cap height in mm -> font-size px, using the real font's cap-height ratio ----
function capRatio(node) {
  const cs = getComputedStyle(node);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} 200px ${cs.fontFamily}`;
  const r = ctx.measureText('H').actualBoundingBoxAscent / 200;
  return r > 0.3 && r < 1 ? r : 0.73;
}

function applyTypeSizes() {
  const px = (mm, node) => `${(mmToPx(mm) / capRatio(node)).toFixed(3)}px`;
  const s = document.documentElement.style;
  s.setProperty('--state-font', px(TYPE_MM.state, el['state-word']));
  s.setProperty('--detail-font', px(TYPE_MM.detail, el.output));
  s.setProperty('--mono-font', px(TYPE_MM.detail, el.command));
  s.setProperty('--diff-font', px(TYPE_MM.detail, el['diff-added']));
}

// ---- rendering ----
function set(node, text) {
  node.textContent = text;
  node.dataset.full = text;
}

function fitFile(full) {
  const f = el.file;
  f.dataset.full = full;
  f.textContent = full;
  if (f.scrollWidth <= f.clientWidth) return;
  f.textContent = middleEllipsis(full, (c) => {
    f.textContent = c;
    return f.scrollWidth <= f.clientWidth;
  });
}

function cleanState(s) {
  if (!s || typeof s !== 'object' || typeof s.view !== 'string' || !(s.view in LABELS) || s.view === 'none') {
    return { view: 'none' };
  }
  return s;
}

export function render(input) {
  const s = cleanState(input);
  const view = s.view;
  const bash = s.tool === 'Bash';
  const note = view === 'starting' || view === 'offline' || view === 'insert-key';

  el.shape.innerHTML = SHAPES[view];
  el.shape.dataset.shape = view;
  set(el['state-word'], LABELS[view]);
  document.body.dataset.view = view;

  // everything below starts empty; only what applies is filled in
  for (const k of ['tool', 'file', 'note1', 'note2', 'command', 'output']) set(el[k], '');
  el.cmdbox.hidden = true;
  el.diff.hidden = true;

  const where = [str(s.repo), str(s.branch)].filter(Boolean).join(' · ');
  const activity = (LABELS[s.activity] || str(s.activity)).toLowerCase();
  const showDiff = s.diff && (s.diff.added > 0 || s.diff.removed > 0) && view !== 'starting' && view !== 'insert-key';
  let file = '';

  if (note) {
    if (view === 'starting') set(el.note1, 'Not ready for voice yet');
    else if (view === 'insert-key') { set(el.note1, 'Data locked'); set(el.note2, 'Insert the key stick to unlock'); }
    else { set(el.note1, `Claude: ${activity}`); set(el.note2, 'No network: voice input will not work'); }
  } else if (bash) {
    el.line2.insertBefore(el.cmdbox, el.diff);
    el.cmdbox.classList.add('wide');
    set(el.command, str(s.command));
    el.cmdbox.hidden = !s.command;
    set(el.output, str(s.output));
  } else {
    set(el.tool, str(s.tool));
    file = str(s.file);
    el.line3.prepend(el.cmdbox);
    el.cmdbox.classList.remove('wide');
    set(el.command, str(s.command));
    el.cmdbox.hidden = !s.command;
    set(el.output, str(s.output));
  }
  if (showDiff) {
    const a = formatCount(s.diff.added);
    const r = formatCount(s.diff.removed);
    el['diff-added'].textContent = `+${a}`;
    el['diff-removed'].textContent = `−${r}`;
    el.diff.dataset.full = `+${s.diff.added} −${s.diff.removed}`;
    el.diff.hidden = false;
  } else {
    el.diff.dataset.full = '';
  }

  // fitting needs layout, so it comes after the fields are in place
  fitFile(file);
  set(el.where, where);
  el.where.hidden = false;
  if (where) {
    const charPx = 0.6 * parseFloat(getComputedStyle(el.where).fontSize);
    // a stub like "rev…" says nothing: show it only with room for about 8 characters
    if (el.where.scrollWidth > el.where.clientWidth && el.where.clientWidth < 8 * charPx) el.where.hidden = true;
  } else {
    el.where.hidden = true;
  }
  document.documentElement.dataset.rendered = view;
}

// ---- input ----
async function loadStatic(q) {
  try {
    if (q.has('state')) return JSON.parse(q.get('state'));
    const id = q.get('fixture');
    if (id && /^[a-z-]+$/.test(id)) {
      const r = await fetch(new URL(`../../emulator/fixtures/${id}.json`, location.href));
      if (r.ok) return await r.json();
    }
  } catch {
    // fall through to "no state"
  }
  return null;
}

const root = document.documentElement;

// Live: the server pushes {seq, state} on /events. A dead link shows "starting", never a stale state.
function live() {
  const down = () => {
    root.dataset.link = 'down';
    delete root.dataset.seq;
    render({ view: 'starting' });
  };
  const connect = () => {
    const es = new EventSource('/events');
    es.onopen = () => { root.dataset.link = 'up'; };
    es.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      render(msg.state);
      if (Number.isInteger(msg.seq)) root.dataset.seq = String(msg.seq);
    };
    es.onerror = () => {
      down();
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        setTimeout(connect, 1000);
      }
    };
  };
  root.dataset.link = 'connecting';
  render({ view: 'starting' });
  connect();
}

window.revviewRender = render;
applyTypeSizes();
await document.fonts.ready;
applyTypeSizes();
const query = new URLSearchParams(location.search);
if (query.has('fixture') || query.has('state')) {
  root.dataset.link = 'static';
  render(await loadStatic(query));
} else {
  live();
}
