/* global navigator */
// The glance view: renders a reducer state (see src/state/README.md) as a state band, a row for tool and file, a command area and an output area.
import { mmToPx } from './panel.js';
import { TYPE_MM } from './type.js';
import { middleEllipsis, fitWhere, fitPrefix, formatCount } from './fit.js';

const LABELS = {
  working: 'WORKING',
  waiting: 'WAITING FOR ME',
  permission: 'NEEDS PERMISSION',
  done: 'DONE',
  starting: 'STARTING',
  offline: 'OFFLINE',
  'insert-key': 'INSERT KEY',
  unknown: 'UNKNOWN',
  ended: 'CLAUDE EXITED',
  'no-link': 'NO LINK',
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
  // question mark: stroked hook and a dot
  unknown: '<path d="M6.5 8.5C6.5 5 9 3 12 3s5.5 2 5.5 5c0 2.5-1.8 3.7-3.4 4.8-1.3.9-2.1 1.8-2.1 3.7" fill="none" stroke="currentColor" stroke-width="3.5"/><circle cx="12" cy="21" r="2.4" fill="currentColor"/>',
  // power-off symbol: open arc and a vertical bar
  ended: '<path d="M6.54 6.49A8.5 8.5 0 1 0 17.46 6.49" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M12 1.5V12.5" fill="none" stroke="currentColor" stroke-width="3.5"/>',
  // broken chain link: two half links with a gap
  'no-link': '<path d="M10.5 5.5H8a6.5 6.5 0 0 0 0 13h2.5" fill="none" stroke="currentColor" stroke-width="3"/><path d="M13.5 5.5H16a6.5 6.5 0 0 1 0 13h-2.5" fill="none" stroke="currentColor" stroke-width="3"/>',
  none: '<rect x="2.5" y="2.5" width="19" height="19" fill="currentColor"/>',
};

// Views that show fixed notes instead of tool, file and command.
const NOTES = {
  starting: ['Not ready for voice yet', ''],
  'insert-key': ['Data locked', 'Insert the key stick to unlock'],
  unknown: ["Not known until Claude's next step", 'Push-to-talk may still work'],
  ended: ['No Claude Code session running', 'Voice input goes nowhere'],
  'no-link': ['Display lost the revview server', 'Claude may still be running'],
};
// permission: the turn total would read as the size of the requested edit (QA r3-03)
const NO_DIFF = new Set(['permission', 'starting', 'insert-key', 'unknown', 'ended', 'no-link']);
const NO_OTHERS = new Set(['starting', 'insert-key', 'unknown', 'no-link']);

// First note of OFFLINE: what Claude is doing, worded for each activity (QA 14: "Claude: claude exited").
function offlineNote(activity) {
  const a = str(activity);
  if (a === 'ended') return 'Claude exited';
  if (a === 'unknown' || a === '' || a === 'no-link' || a === 'none') return 'Claude: not known';
  return `Claude: ${(Object.hasOwn(LABELS, a) ? LABELS[a] : a).toLowerCase()}`;
}

const $ = (id) => document.getElementById(id);
const str = (v) => (typeof v === 'string' ? v : '');
const ids = ['band', 'shape', 'state-word', 'others', 'where', 'buttons-tag', 'tool', 'file', 'note1', 'note2', 'diff', 'diff-approx', 'diff-added',
  'diff-removed', 'session', 'cmdbox', 'command', 'out1', 'out2', 'out3', 'offline-note'];
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
  s.setProperty('--detail-font', px(TYPE_MM.detail, el.out3));
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

// The command wraps over at most MAX_ROWS minus the output rows shown (3 to 6 rows of 40 px; the rows below the
// band are 7 in all); longer text is cut at its end with an ellipsis. Needs layout: call with the command box shown.
// The row height is the computed line-height of #command (40 px from view.css), read at run time.
// The displayed text has a U+2060 WORD JOINER after each '-' that is followed by a non-space, so a line breaks
// at spaces and not after "--" (QA r3-09); a token longer than a row still breaks inside (overflow-wrap).
// data-full and the cut itself work on the plain text.
const MAX_ROWS = 6;
const WORD_JOINER = '\u2060';
const noBreakAfterHyphen = (t) => t.replace(/-(?=\S)/gu, `-${WORD_JOINER}`);
function fitCommand(full, outRows) {
  const c = el.command;
  c.dataset.full = full;
  const rowPx = parseFloat(getComputedStyle(c).lineHeight) || 40;
  const fits = (t) => {
    c.textContent = noBreakAfterHyphen(t);
    return c.offsetHeight <= (MAX_ROWS - outRows) * rowPx;
  };
  c.textContent = noBreakAfterHyphen(fitPrefix(full, fits));
}

// Up to the last 3 output lines, oldest first. outputLines is used only when it agrees with `output`
// (an array of strings whose last element is `output`); otherwise `output` alone.
function outputLines(s) {
  const o = str(s.output);
  const a = s.outputLines;
  const ok = Array.isArray(a) && a.every((x) => typeof x === 'string') && a.at(-1) === o;
  return (ok ? a : [o]).filter((x) => x !== '').slice(-3);
}

function cleanState(s) {
  if (!s || typeof s !== 'object' || typeof s.view !== 'string' || !Object.hasOwn(LABELS, s.view) || s.view === 'none') {
    return { view: 'none' };
  }
  return s;
}

export function render(input) {
  const s = cleanState(input);
  const view = s.view;
  const note = Object.hasOwn(NOTES, view) || view === 'offline';

  el.shape.innerHTML = SHAPES[view];
  el.shape.dataset.shape = view;
  set(el['state-word'], LABELS[view]);
  document.body.dataset.view = view;

  // everything below starts empty; only what applies is filled in
  for (const k of ['tool', 'file', 'note1', 'note2', 'command', 'out1', 'out2', 'out3', 'offline-note']) set(el[k], '');
  el.cmdbox.hidden = true;
  el.diff.hidden = true;

  const where = view === 'no-link' ? '' : [str(s.repo), str(s.branch)].filter(Boolean).join(' · ');
  const others = Number.isInteger(s.others) && s.others > 0 && !NO_OTHERS.has(view) ? s.others : 0;
  const activity = offlineNote(s.activity);
  const added = s.diff && typeof s.diff === 'object' ? s.diff.added : 0;
  const removed = s.diff && typeof s.diff === 'object' ? s.diff.removed : 0;
  const approx = s.diffIncomplete === true;
  const showDiff = (added > 0 || removed > 0 || approx) && !NO_DIFF.has(view);
  let file = '';
  let outRows = 0;

  if (note) {
    if (Object.hasOwn(NOTES, view)) {
      set(el.note1, NOTES[view][0]);
      set(el.note2, NOTES[view][1]);
    } else { set(el.note1, activity); set(el.note2, 'No network: voice input will not work'); }
  } else {
    set(el.tool, str(s.tool));
    file = str(s.file);
    el.cmdbox.hidden = !str(s.command);
    outRows = outputLines(s).reverse().map((line, i) => set(el[`out${3 - i}`], line)).length;
    // NEEDS PERMISSION while offline: a secondary row at the bottom (it takes one of the command's rows)
    if (view === 'permission' && s.offline === true) { set(el['offline-note'], 'No network: voice input will not work'); outRows += 1; }
  }
  if (showDiff) {
    // a lower bound of zero says nothing ("at least nothing"): show it as unknown, never as +0 −0 (QA 11)
    const unknown = approx && !(added > 0) && !(removed > 0);
    el['diff-approx'].textContent = approx && !unknown ? '≥' : '';
    el['diff-added'].textContent = unknown ? '+?' : `+${formatCount(added)}`;
    el['diff-removed'].textContent = unknown ? '−?' : `−${formatCount(removed)}`;
    const full = `+${Number.isFinite(added) ? added : 0} −${Number.isFinite(removed) ? removed : 0}`;
    el.diff.dataset.full = unknown ? 'diff unknown (an event was too large to read)' : approx ? `at least ${full}` : full;
    el.diff.hidden = false;
  } else {
    el.diff.dataset.full = '';
  }

  // the "more sessions" hint never shrinks; it is placed before #where, which gives way first
  // two digits do not fit next to NEEDS PERMISSION: from 10 on it reads "9+" (data-full has the real number)
  set(el.others, others > 9 ? '9+' : others ? `+${others}` : '');
  el.others.dataset.full = others ? `${others} more Claude session${others === 1 ? '' : 's'}` : '';
  // with the longest word (NEEDS PERMISSION) the hint does not fit inside the band's padding: tighten it
  // the "NO BUTTONS" tag (only when the wheel buttons are known to be missing; not while starting, not on NO LINK)
  // sits at the band's right end; it never shrinks, so the room it takes is not available to the hint
  el['buttons-tag'].hidden = !(s.buttons === 'missing' && view !== 'starting' && view !== 'no-link');
  el.band.classList.remove('tight');
  const tagPx = el['buttons-tag'].hidden ? 0 : el['buttons-tag'].offsetWidth + 24;
  if (others && el.others.getBoundingClientRect().right > el.band.clientWidth - 24 - tagPx) el.band.classList.add('tight');

  // fitting needs layout, so it comes after the fields are in place
  if (!el.cmdbox.hidden) fitCommand(str(s.command), outRows);
  fitFile(file);
  set(el.where, where);
  el.where.hidden = false;
  if (where) {
    const w = el.where;
    if (str(s.branch) && w.scrollWidth > w.clientWidth) {
      const cut = fitWhere(str(s.repo), str(s.branch), (c) => {
        w.textContent = c;
        return w.scrollWidth <= w.clientWidth;
      });
      if (cut !== null) w.textContent = cut;
      else {
        // no cut of the branch fits. Keep the full text (the CSS end cut shows a few letters of the branch)
        // only when at least 2 of them stay readable; otherwise the repo alone, never a bare "repo ·…" (QA 13)
        w.textContent = `${str(s.repo)} · ${Array.from(str(s.branch)).slice(0, 2).join('')}…`;
        w.textContent = !str(s.repo) || w.scrollWidth <= w.clientWidth ? where : str(s.repo);
      }
    }
    const charPx = 0.6 * parseFloat(getComputedStyle(el.where).fontSize);
    // a stub like "rev…" says nothing: show it only with room for about 8 characters
    if (el.where.scrollWidth > el.where.clientWidth && el.where.clientWidth < 8 * charPx) el.where.hidden = true;
  } else {
    el.where.hidden = true;
  }
  // QA 03: with other sessions open, the repo must still say which one needs the driver. When the band has
  // no room for it (long state word + hint), it goes to the right end of row A.
  el.session.hidden = true;
  set(el.session, '');
  if (others && el.where.hidden && str(s.repo) && !note) {
    set(el.session, str(s.repo));
    el.session.hidden = false;
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

// Live: the server pushes {seq, state} on /events. A dead link shows "no link", never a stale state.
function live() {
  const down = () => {
    root.dataset.link = 'down';
    delete root.dataset.seq;
    render({ view: 'no-link' });
  };
  // A page that was loaded while the server was away comes from the service worker's cache and may have old
  // scripts: it never saw the link up before it went down, so it reloads once when the link first comes up.
  let everUp = false;
  let loadedDown = false;
  const connect = () => {
    const es = new EventSource('/events');
    es.onopen = () => {
      root.dataset.link = 'up';
      if (loadedDown && !everUp) { everUp = true; location.reload(); return; }
      everUp = true;
    };
    es.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      render(msg.state);
      if (Number.isInteger(msg.seq)) root.dataset.seq = String(msg.seq);
    };
    es.onerror = () => {
      if (!everUp) loadedDown = true;
      down();
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        setTimeout(connect, 1000);
      }
    };
  };
  root.dataset.link = 'connecting';
  // nothing is known until the first message: NO LINK, never STARTING (only RevviewStarting makes that)
  render({ view: 'no-link' });
  connect();
  // lets a reload of this page survive a server that is away (QA 08); the page works without it
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
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
  // dev only: without ?devkeys=1 the page attaches no key listener at all
  if (query.get('devkeys') === '1') import('./devkeys.js').then((m) => m.startDevKeys());
}
