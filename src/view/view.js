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

// The push-to-talk mark: a microphone (viewBox 0 0 24 24, currentColor). The crossed-out one has a diagonal bar with a
// gap cut in the band's colour, so it differs in shape and not only in colour.
const MIC = '<rect x="8.5" y="1.5" width="7" height="13" rx="3.5" fill="currentColor"/><path d="M4.5 11a7.5 7.5 0 0 0 15 0M12 18.5v4M7.5 22.5h9" fill="none" stroke="currentColor" stroke-width="2.4"/>';
const MIC_OFF = `${MIC}<path d="M3 3 21 21" style="stroke:var(--band)" stroke-width="8" fill="none"/><path d="M2 2 22 22" stroke="currentColor" stroke-width="3.2" fill="none"/>`;
const TRIANGLE = '<path d="M12 1.5 23.5 22.5H.5Z" fill="currentColor"/>';
const CHEVRON_UP = '<path d="M3 17 12 7l9 10" fill="none" stroke="currentColor" stroke-width="4"/>';
const CHEVRON_DOWN = '<path d="M3 7l9 10 9-10" fill="none" stroke="currentColor" stroke-width="4"/>';
const svg = (inner, cls) => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;

// Push-to-talk is not going to the shown session: the note for the bottom row (or in place of note2).
const VOICE_NOTES = {
  none: 'Push-to-talk goes nowhere: no session chosen',
  'not-owned': 'Buttons do nothing here: not a revview session',
  'no-session': 'Push-to-talk does nothing: no revview session',
};
const MIC_STATES = { here: 1, none: 1, 'not-owned': 1, 'no-session': 1 };

// The list window: the title row and up to 6 rows fit the 7 rows below the band.
const NAV_ROWS = 6;
const NAV_TITLES = { list: 'SESSIONS', menu: 'MENU', new: 'NEW SESSION: CHOOSE A PROJECT', projects: 'PROJECTS', settings: 'SETTINGS (READ ONLY)' };
const NAV_EMPTY = { list: 'No sessions', new: 'No projects: add paths to the projects file', projects: 'No projects: add paths to the projects file' };
// chip colours: the band colour of the state (view.css has the same values per body[data-view])
const CHIP = { working: '#5eb1ff', waiting: '#c8a2ff', permission: '#ffb020', done: '#4fdc7a', unknown: '#5ce1e6' };

const $ = (id) => document.getElementById(id);
const str = (v) => (typeof v === 'string' ? v : '');
const ids = ['band', 'shape', 'state-word', 'others', 'where', 'buttons-tag', 'tool', 'file', 'note1', 'note2', 'diff', 'diff-approx', 'diff-added',
  'diff-removed', 'session', 'cmdbox', 'command', 'out1', 'out2', 'out3', 'offline-note', 'voice', 'voice-mark', 'position', 'voice-note',
  'lower', 'nav'];
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
// data-full and the cut itself work on the plain text (the visible text minus U+2060 and U+200B is the command).
const MAX_ROWS = 6;
const WORD_JOINER = '\u2060';
const ZWSP = '\u200B';
const noBreakAfterHyphen = (t) => t.replace(/-(?=\S)/gu, `-${WORD_JOINER}`);
// QA r5-06: a token longer than LONG_TOKEN characters (a path, a long flag) may break after '/', '-', '_', '.', '=' or ':'
// (a ZERO WIDTH SPACE after it, when a letter or digit follows; never after '--'), so a row ends after a separator and
// not between letters ("…very-long-director / y-name"). Short tokens keep the r3-09 behaviour (a flag moves whole).
const LONG_TOKEN = 24;
const SEPARATOR = /(?<=[\p{L}\p{N}.~][/_.=:]|\/)(?=[\p{L}\p{N}])/gu;
const HYPHEN = /(?<=[\p{L}\p{N}.~]-)\u2060(?=[\p{L}\p{N}])/gu;
export const displayCommand = (t) => t.split(/(\s+)/u).map((w) => (w.length > LONG_TOKEN
  ? noBreakAfterHyphen(w).replace(HYPHEN, ZWSP).replace(SEPARATOR, ZWSP) : noBreakAfterHyphen(w))).join('');
// Rows below row A: 6. The message takes all of them but the other rows shown (outRows counts those, without the message).
function fitFailedMessage(full, otherRows) {
  const o = el.out3;
  o.dataset.wrap = '1';
  const rowPx = parseFloat(getComputedStyle(o).lineHeight) || 40;
  const fits = (t) => {
    o.textContent = displayCommand(t);
    return o.offsetHeight <= (MAX_ROWS - otherRows) * rowPx;
  };
  o.textContent = displayCommand(fitPrefix(full, fits));
}

function fitCommand(full, outRows) {
  const c = el.command;
  c.dataset.full = full;
  const rowPx = parseFloat(getComputedStyle(c).lineHeight) || 40;
  const fits = (t) => {
    c.textContent = displayCommand(t);
    return c.offsetHeight <= (MAX_ROWS - outRows) * rowPx;
  };
  c.textContent = displayCommand(fitPrefix(full, fits));
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
  for (const k of ['tool', 'file', 'note1', 'note2', 'command', 'out1', 'out2', 'out3', 'offline-note', 'voice-note']) set(el[k], '');
  el.cmdbox.hidden = true;
  el.diff.hidden = true;
  delete el.out3.dataset.wrap;

  const where = view === 'no-link' ? '' : [str(s.repo), str(s.branch)].filter(Boolean).join(' · ');
  const others = Number.isInteger(s.others) && s.others > 0 && !NO_OTHERS.has(view) ? s.others : 0;
  const activity = offlineNote(s.activity);
  // null (a server without sessions) or anything unknown: nothing new is drawn
  const voice = Object.hasOwn(MIC_STATES, s.voice) ? s.voice : null;
  // a board note (a short message from revview itself) takes the voice note's place
  const plainVoiceNote = voice !== null && Object.hasOwn(VOICE_NOTES, voice) ? VOICE_NOTES[voice] : '';
  // STARTING already says "Not ready for voice yet": no second note under it
  const voiceNote = typeof s.note === 'string' && s.note !== '' ? s.note : view === 'starting' ? '' : plainVoiceNote;
  // push-to-talk cannot usefully work (no network, no wheel buttons) although the session is the target: crossed mic too
  const micWhy = voice !== 'here' ? '' : s.offline === true ? 'No network: push-to-talk will not work' : s.buttons === 'missing' ? 'No wheel buttons found' : '';
  const pos = s.position && Number.isInteger(s.position.index) && Number.isInteger(s.position.count) && s.position.index > 0 && s.position.count > 0 ? s.position : null;
  const elsewhere = Number.isInteger(s.elsewhere) && s.elsewhere > 0 ? s.elsewhere : 0;
  const added = s.diff && typeof s.diff === 'object' ? s.diff.added : 0;
  const removed = s.diff && typeof s.diff === 'object' ? s.diff.removed : 0;
  const approx = s.diffIncomplete === true;
  const showDiff = (added > 0 || removed > 0 || approx) && !NO_DIFF.has(view);
  let file = '';
  let outRows = 0;

  delete el.tool.dataset.answer;
  delete el.tool.dataset.failed;
  // a turn that ended with an API error (StopFailure): said in words, not by colour alone ("Turn failed: rate limit")
  const failedWord = (view === 'waiting' || (view === 'offline' && s.activity === 'waiting'))
    && s.failed && typeof s.failed === 'object' && typeof s.failed.error === 'string' && s.failed.error !== ''
    ? `Turn failed: ${s.failed.error.replaceAll('_', ' ')}` : '';
  // revview's own answer to the shown call, in words (not by colour alone): "Denied: Bash" / "Allowed: Bash"
  const answerWord = (tool) => (tool !== '' && (s.answered === 'deny' || s.answered === 'allow') ? `${s.answered === 'deny' ? 'Denied' : 'Allowed'}: ${tool}` : '');
  if (note) {
    if (Object.hasOwn(NOTES, view)) {
      set(el.note1, NOTES[view][0]);
      set(el.note2, voiceNote || NOTES[view][1]);
    } else {
      // OFFLINE keeps the confirmation of a button answer (Denied/Allowed) before "Claude: ..." on row A
      const word = view === 'offline' ? answerWord(str(s.tool)) : '';
      if (word !== '') {
        set(el.tool, word);
        el.tool.dataset.answer = s.answered;
      } else if (failedWord !== '') {
        set(el.tool, failedWord);
        el.tool.dataset.failed = '1';
      }
      set(el.note1, activity);
      set(el.note2, 'No network: voice input will not work');
      if (voiceNote) set(el['voice-note'], voiceNote);
    }
  } else {
    set(el.tool, str(s.tool));
    if (answerWord(str(s.tool)) !== '') {
      set(el.tool, answerWord(str(s.tool)));
      el.tool.dataset.answer = s.answered;
    }
    if (failedWord !== '') {
      set(el.tool, failedWord);
      el.tool.dataset.failed = '1';
    }
    file = str(s.file);
    el.cmdbox.hidden = !str(s.command);
    outRows = outputLines(s).reverse().map((line, i) => set(el[`out${3 - i}`], line)).length;
    // NEEDS PERMISSION while offline: a secondary row at the bottom (it takes one of the command's rows)
    if (view === 'permission' && s.offline === true) { set(el['offline-note'], 'No network: voice input will not work'); outRows += 1; }
    if (voiceNote) { set(el['voice-note'], voiceNote); outRows += 1; }
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
  el.others.classList.toggle('has-mark', others > 0 && elsewhere > 0);
  if (others && elsewhere) {
    // a small filled triangle (the permission shape) before the number: some of the others need permission
    el.others.insertAdjacentHTML('afterbegin', svg(TRIANGLE, 'mark'));
    el.others.dataset.full += `, ${elsewhere} ${elsewhere === 1 ? 'needs' : 'need'} permission`;
  }
  // push-to-talk mark and position: never shrinks, #where gives way first
  el.voice.hidden = voice === null;
  if (voice !== null) {
    const crossed = voice !== 'here' || micWhy !== '';
    el['voice-mark'].innerHTML = crossed ? MIC_OFF : MIC;
    el['voice-mark'].dataset.mark = crossed ? 'mic-off' : 'mic';
    set(el.position, pos ? `${pos.index}/${pos.count}` : '');
    el.voice.dataset.voice = voice;
    el.voice.dataset.full = micWhy !== '' ? micWhy : voice === 'here'
      ? `Push-to-talk goes to this session${pos ? ` (${pos.index} of ${pos.count})` : ''}`
      : plainVoiceNote;
  } else {
    el.voice.dataset.full = '';
  }
  // with the longest word (NEEDS PERMISSION) the hint does not fit inside the band's padding: tighten it
  // the "NO BUTTONS" tag (only when the wheel buttons are known to be missing; not while starting, not on NO LINK)
  // sits at the band's right end; it never shrinks, so the room it takes is not available to the hint
  el['buttons-tag'].hidden = !(s.buttons === 'missing' && view !== 'starting' && view !== 'no-link');
  el.band.classList.remove('tight');
  const tagPx = el['buttons-tag'].hidden ? 0 : el['buttons-tag'].offsetWidth + 24;
  const lastFixed = voice !== null ? el.voice : el.others;
  if ((others || voice !== null) && lastFixed.getBoundingClientRect().right > el.band.clientWidth - 24 - tagPx) el.band.classList.add('tight');

  // fitting needs layout, so it comes after the fields are in place
  if (!el.cmdbox.hidden) fitCommand(str(s.command), outRows);
  // the failed turn's message wraps over the free rows (QA r5b-02), cut with an ellipsis only beyond them
  if (!note && failedWord !== '' && str(s.failed.message) !== '' && el.out3.dataset.full === str(s.failed.message)) fitFailedMessage(str(s.failed.message), outRows - 1);
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
  renderNav(s.nav);
  document.documentElement.dataset.rendered = view;
}

// ---- list and menu: the lower area is replaced by a title row and up to 6 rows ----
function navRow(r, i, nav, isEmpty) {
  const row = document.createElement('div');
  row.className = 'row';
  if (!isEmpty && i === nav.row) row.dataset.selected = 'true';
  const bar = document.createElement('span');
  bar.className = 'bar';
  const body = document.createElement('div');
  body.className = 'body';
  row.append(bar, body);
  const text = (id, cls, t) => {
    const n = document.createElement('span');
    n.id = id;
    n.className = cls;
    n.textContent = t;
    n.dataset.full = t;
    return n;
  };
  if (nav.kind === 'list' && !isEmpty) {
    const label = str(r.label) === '' ? '(no repo)' : str(r.label);
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.dataset.state = str(r.state);
    chip.style.background = CHIP[r.state] ?? CHIP.unknown;
    body.append(chip, text(`row${i}-label`, 'label', label), text(`row${i}-word`, 'word', str(r.word)));
    if (r.target === true || r.voice === false) {
      // a session the buttons cannot drive shows the crossed mic (as the band does), never a plain one
      const off = r.voice === false;
      const mic = document.createElement('span');
      mic.className = 'row-mic';
      mic.dataset.mark = off ? 'mic-off' : 'mic';
      mic.innerHTML = svg(off ? MIC_OFF : MIC, 'mic');
      body.append(mic);
    }
  } else {
    body.append(text(`row${i}-label`, 'label', str(r.label)));
  }
  return row;
}

function fitLabel(node) {
  if (node.scrollWidth <= node.clientWidth) return;
  node.textContent = middleEllipsis(node.dataset.full, (c) => {
    node.textContent = c;
    return node.scrollWidth <= node.clientWidth;
  });
}

function renderNav(input) {
  const ok = input && typeof input === 'object' && Object.hasOwn(NAV_TITLES, input.kind) && Array.isArray(input.rows)
    && input.rows.every((r) => r && typeof r === 'object');
  el.nav.hidden = !ok;
  el.lower.hidden = ok;
  el.nav.replaceChildren();
  delete el.nav.dataset.kind;
  if (!ok) return;
  const isEmpty = input.rows.length === 0;
  const rows = isEmpty ? [{ label: NAV_EMPTY[input.kind] ?? '' }] : input.rows;
  const row = Math.min(Number.isInteger(input.row) ? Math.max(0, input.row) : 0, rows.length - 1);
  const nav = { kind: input.kind, row };
  // the highlighted row stays in the window; two rows of context above it when the list is longer than the window
  const start = Math.min(Math.max(0, row - 2), Math.max(0, rows.length - NAV_ROWS));
  const end = Math.min(rows.length, start + NAV_ROWS);
  el.nav.dataset.kind = input.kind;
  const title = document.createElement('div');
  title.className = 'title';
  const t = document.createElement('span');
  t.id = 'nav-title';
  t.textContent = NAV_TITLES[input.kind];
  t.dataset.full = NAV_TITLES[input.kind];
  title.append(t);
  // more above / below: a chevron (a shape, not a colour)
  for (const [id, inner, on, n] of [['more-above', CHEVRON_UP, start > 0, start], ['more-below', CHEVRON_DOWN, end < rows.length, rows.length - end]]) {
    const m = document.createElement('span');
    m.id = id;
    m.className = 'more';
    m.hidden = !on;
    m.dataset.full = `${n} more ${id === 'more-above' ? 'above' : 'below'}`;
    m.innerHTML = svg(inner, 'chev');
    title.append(m);
  }
  el.nav.append(title);
  for (let i = start; i < end; i += 1) el.nav.append(navRow(rows[i], i, nav, isEmpty));
  for (const node of el.nav.querySelectorAll('.label')) fitLabel(node);
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
