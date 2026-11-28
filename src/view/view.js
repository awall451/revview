/* global navigator */
// The glance view: renders a reducer state (see src/state/README.md) as a state band, a row for tool and file, a command area and an output area.
import { mmToPx } from './panel.js';
import { TYPE_MM, RANGE_MM, askFontPx } from './type.js';
import { middleEllipsis, fitWhere, fitPrefix, formatCount, formatElapsed, elapsedWords, quietMinutes } from './fit.js';

const LABELS = {
  working: 'WORKING',
  waiting: 'WAITING FOR ME',
  permission: 'NEEDS PERMISSION',
  asking: 'CLAUDE ASKS',
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
  // speech bubble with a tail at the lower left: Claude asks something
  asking: '<path d="M4 2.5h16A2.5 2.5 0 0 1 22.5 5v10a2.5 2.5 0 0 1-2.5 2.5H11l-5.5 4.5v-4.5H4A2.5 2.5 0 0 1 1.5 15V5A2.5 2.5 0 0 1 4 2.5Z" fill="currentColor"/>',
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
const NO_DIFF = new Set(['permission', 'asking', 'starting', 'insert-key', 'unknown', 'ended', 'no-link']);
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
  none: 'No session chosen: press up to open the list',
  'not-owned': 'Buttons do nothing here: not a revview session',
  'no-session': 'Push-to-talk does nothing: no revview session',
};
const MIC_STATES = { here: 1, none: 1, 'not-owned': 1, 'no-session': 1 };

// The list window: the title row and up to 6 rows fit the 7 rows below the band.
const NAV_ROWS = 6;
const NAV_TITLES = { list: 'SESSIONS', menu: 'MENU', new: 'NEW SESSION: CHOOSE A PROJECT', projects: 'PROJECTS', settings: 'SETTINGS (READ ONLY)' };
const NAV_EMPTY = { list: 'No sessions', new: 'No projects: add paths to the projects file', projects: 'No projects: add paths to the projects file' };
// chip colours: the band colour of the state (view.css has the same values per body[data-view])
// CSS variables (view.css): the day and night looks give them their colours
const CHIP = Object.fromEntries(['working', 'waiting', 'permission', 'asking', 'done', 'unknown'].map((k) => [k, `var(--chip-${k})`]));

const $ = (id) => document.getElementById(id);
const str = (v) => (typeof v === 'string' ? v : '');
const ids = ['band', 'shape', 'state-word', 'clock', 'quiet-tag', 'tasks', 'tasks-count', 'others', 'where', 'tags', 'hot-tag', 'power-tag', 'buttons-tag', 'tool', 'file', 'note1', 'note2', 'diff', 'diff-approx', 'diff-added',
  'diff-removed', 'session', 'cmdbox', 'command', 'out1', 'out2', 'out3', 'offline-note', 'voice', 'voice-mark', 'position', 'voice-note',
  'lower', 'nav', 'ask', 'ask-question', 'ask-options', 'ask-steps', 'ask-hint', 'ask-meta', 'ask-multi', 'ask-count', 'ask-more'];
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

// ---- time: the clock and the quiet mark in the band ----
// What the shown state says about time, plus the clock it is read against. Live: the server's clock is the page's clock plus
// `liveOffset` (set on every message from msg.now, against performance.now(), which a stepped wall clock does not move; with no `now` the page's own Date.now()). Static (?fixture, ?state, revviewRender): the state's own `now`.
// A tick (once a second) only repaints the clock and the quiet text, it never renders again.
const TIME_VIEWS = new Set(['working', 'permission', 'asking']);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const { performance } = globalThis;
let liveOffset = null; // server clock minus performance.now() (steady: a step of the page's wall clock changes nothing); 0 with no `now`: then Date.now() is read
let liveOwn = false;
const timeState = { view: '', since: NaN, quietSince: NaN, staticNow: NaN, clockRoom: true };

function serverNow() {
  if (liveOffset === null) return timeState.staticNow;
  return liveOwn ? Date.now() : performance.now() + liveOffset;
}

function paintTime() {
  const t = timeState;
  const now = serverNow();
  const known = Number.isFinite(now);
  const clockOn = TIME_VIEWS.has(t.view) && Number.isFinite(t.since) && known;
  if (clockOn) {
    set(el.clock, formatElapsed(now - t.since));
    el.clock.dataset.full = elapsedWords(now - t.since);
  } else {
    set(el.clock, '');
    el.clock.dataset.full = '';
  }
  el.clock.hidden = !clockOn || !t.clockRoom;
  if (clockOn && !t.clockRoom) el.clock.dataset.room = 'hidden';
  else delete el.clock.dataset.room;
  const quietOn = t.view === 'working' && Number.isFinite(t.quietSince) && known;
  el['quiet-tag'].hidden = !quietOn;
  if (quietOn) {
    const mins = quietMinutes(now - t.quietSince);
    set(el['quiet-tag'], `QUIET ${mins} MIN`);
    el['quiet-tag'].dataset.full = `No event from Claude for ${mins === '99+' ? 'over 99' : mins} min: a long command, or stuck`;
  } else {
    set(el['quiet-tag'], '');
    el['quiet-tag'].dataset.full = '';
  }
}

// The widest text the clock can show (the digits are the same width, the colon and the h differ): the room check uses it,
// so a clock that grows by a tick never pushes the marks out.
function widestClock() {
  let best = '59:59';
  let w = 0;
  for (const t of ['59:59', '23h59', '99h+']) {
    el.clock.textContent = t;
    if (el.clock.offsetWidth > w) { w = el.clock.offsetWidth; best = t; }
  }
  return best;
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

const LOOK_KEY = 'revview.look';
let liveLook = false; // live mode remembers the last look in localStorage; static mode (?fixture, ?state) ignores it
function setLook(look) {
  document.documentElement.dataset.look = look;
  if (liveLook) {
    try { localStorage.setItem(LOOK_KEY, look); } catch { /* storage may be unavailable */ }
  }
}

let lastInput = null; // the last state given to render (window.revviewLastState; the screenshot harness re-renders it in the night look)
export function render(input) {
  lastInput = input;
  const s = cleanState(input);
  const view = s.view;
  const note = Object.hasOwn(NOTES, view) || view === 'offline';

  const look = input && typeof input === 'object' ? input.look : undefined; // not part of the cleaned state
  if (look === 'day' || look === 'night') setLook(look); // any other value leaves the current look (NO LINK after a lost link keeps it)
  el.shape.innerHTML = SHAPES[view];
  el.shape.dataset.shape = view;
  set(el['state-word'], LABELS[view]);
  document.body.dataset.view = view;
  Object.assign(timeState, { view, since: finite(s.since) ? s.since : NaN, quietSince: finite(s.quietSince) ? s.quietSince : NaN, staticNow: finite(s.now) ? s.now : NaN, clockRoom: true });
  paintTime();

  // everything below starts empty; only what applies is filled in
  for (const k of ['tool', 'file', 'note1', 'note2', 'command', 'out1', 'out2', 'out3', 'offline-note', 'voice-note']) set(el[k], '');
  el.cmdbox.hidden = true;
  el.diff.hidden = true;
  // a menu or list left #lower hidden: show it first, or everything below is fitted in a box of no height (QA r11-01);
  // renderNav hides it again at the end of the same render
  el.lower.hidden = false;
  el.ask.hidden = true;
  el['ask-meta'].hidden = true;
  let askRows = 0; // rows taken below the ask block (offline note, voice note)
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
  const micWhy = voice !== 'here' ? '' : view === 'starting' ? 'Not ready for voice yet' : s.offline === true ? 'No network: push-to-talk will not work' : s.buttons === 'missing' ? 'No wheel buttons found' : '';
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
  delete el.tool.dataset.compacting;
  // a turn that ended with an API error (StopFailure): said in words, not by colour alone ("Turn failed: rate limit")
  const failedWord = (view === 'waiting' || (view === 'offline' && s.activity === 'waiting'))
    && s.failed && typeof s.failed === 'object' && typeof s.failed.error === 'string' && s.failed.error !== ''
    ? `Turn failed: ${s.failed.error.replaceAll('_', ' ')}` : '';
  // Claude is compacting its context (PreCompact seen, end not yet): said in words in the tool slot, the file slot
  // stays empty. Only over the working / waiting / done look (also under OFFLINE); the state core never sets it elsewhere.
  const compactingWord = s.compacting === true && failedWord === ''
    && (view === 'working' || view === 'waiting' || view === 'done' || (view === 'offline' && ['working', 'waiting', 'done'].includes(s.activity)))
    ? 'Compacting context' : '';
  // revview's own answer to the shown call, in words (not by colour alone): "Denied: Bash" / "Allowed: Bash"
  // (a question or a plan: "Answered" / "Question cancelled", "Plan approved" / "Kept planning")
  const ANSWER_WORDS = { AskUserQuestion: ['Answered', 'Question cancelled'], ExitPlanMode: ['Plan approved', 'Kept planning'] };
  const answerWord = (tool) => {
    if (tool === '' || (s.answered !== 'deny' && s.answered !== 'allow')) return '';
    const own = Object.hasOwn(ANSWER_WORDS, tool) ? ANSWER_WORDS[tool] : null;
    if (own !== null) return own[s.answered === 'deny' ? 1 : 0];
    return `${s.answered === 'deny' ? 'Denied' : 'Allowed'}: ${tool}`;
  };
  if (note) {
    if (Object.hasOwn(NOTES, view)) {
      // no session at all: "Not known until Claude's next step" would promise a next step that cannot come (r6b-07)
      if (view === 'unknown' && voice === 'no-session') {
        set(el.note1, voiceNote);
        set(el.note2, '');
      } else {
        set(el.note1, NOTES[view][0]);
        set(el.note2, voiceNote || NOTES[view][1]);
      }
    } else {
      // OFFLINE keeps the confirmation of a button answer (Denied/Allowed) before "Claude: ..." on row A
      const word = view === 'offline' ? answerWord(str(s.tool)) : '';
      if (compactingWord !== '') {
        set(el.tool, compactingWord);
        el.tool.dataset.compacting = '1';
      } else if (word !== '') {
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
  } else if (view === 'asking') {
    // Claude asks the driver (AskUserQuestion / ExitPlanMode): the tool in row A, the ask block below it (renderAsk)
    set(el.tool, Object.hasOwn(ASK_WORDS, str(s.tool)) ? ASK_WORDS[str(s.tool)] : str(s.tool)); // plain words; the state keeps the raw tool name
    if (s.offline === true) { set(el['offline-note'], 'No network: voice input will not work'); askRows += 1; }
    // (a note the terminal hint already says is null in the state: the board hides it, QA r11-03)
    if (voiceNote) { set(el['voice-note'], voiceNote); askRows += 1; }
    // a board note is the outcome of a press (not sent, too early): white and bold, apart from the grey hint (QA r11-05)
    el['voice-note'].toggleAttribute('data-board', typeof s.note === 'string' && s.note !== '');
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
    if (compactingWord !== '') {
      set(el.tool, compactingWord);
      delete el.tool.dataset.answer;
      el.tool.dataset.compacting = '1';
    }
    file = compactingWord !== '' ? '' : str(s.file);
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

  // task progress "tasks 3/7" before the diff: where row A shows the tool, when the session has a task list
  const tk = s.tasks;
  const tasksOn = !note && tk && typeof tk === 'object' && Number.isInteger(tk.total) && Number.isInteger(tk.done) && tk.total >= 1 && tk.done >= 0 && tk.done <= tk.total;
  el.tasks.hidden = !tasksOn;
  set(el['tasks-count'], tasksOn ? `${tk.done}/${tk.total}` : '');
  el.tasks.dataset.full = tasksOn ? `${tk.done} of ${tk.total} tasks done` : '';

  // the "more sessions" hint never shrinks; it is placed before #where, which gives way first
  // two digits do not fit next to NEEDS PERMISSION: from 10 on it reads "9+" (data-full has the real number)
  // With the position ("2/3") shown, "+N" would say the same twice: the hint is then only the NUMBER of other
  // sessions that need permission, after the triangle ("▲1"; nothing when none does). Without a position: "+N" (QA r4-05).
  const showPos = voice !== null && pos !== null && others > 0;
  const cap = (n) => (n > 9 ? '9+' : `${n}`);
  if (showPos) {
    set(el.others, elsewhere ? cap(elsewhere) : '');
    el.others.dataset.full = elsewhere ? `${elsewhere} other Claude session${elsewhere === 1 ? ' needs' : 's need'} permission` : '';
  } else {
    set(el.others, others ? (others > 9 ? '9+' : `+${others}`) : '');
    el.others.dataset.full = others ? `${others} more Claude session${others === 1 ? '' : 's'}` : '';
  }
  const mark = others > 0 && elsewhere > 0;
  el.others.classList.toggle('has-mark', mark);
  if (mark) {
    // a small filled triangle (the permission shape) before the number: some of the others need permission
    el.others.insertAdjacentHTML('afterbegin', svg(TRIANGLE, 'mark'));
    if (!showPos) el.others.dataset.full += `, ${elsewhere} ${elsewhere === 1 ? 'needs' : 'need'} permission`;
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
  // the heat and supply tags (the box, not the session): any view but NO LINK, whose state is not trusted
  const HOT_FULL = 'Pi is hot: it may be throttling, Claude and the bar can be slow';
  const POWER_FULL = 'Low power: weak supply (under-voltage), the Pi may be slow';
  const showTag = (tag, on, full) => {
    tag.hidden = !on;
    tag.dataset.full = on ? full : '';
  };
  showTag(el['hot-tag'], s.hot === true && view !== 'no-link', HOT_FULL);
  showTag(el['power-tag'], s.lowPower === true && view !== 'no-link', POWER_FULL);
  el.tags.hidden = el['hot-tag'].hidden && el['power-tag'].hidden && el['buttons-tag'].hidden;
  // The group must end inside the band's padding. At the detail size HOT, LOW POWER and NO BUTTONS beside the longest
  // word and the hint do not all fit (the type size is not negotiable): the padding tightens first, then the clock goes
  // (its data-full stays), then the heat and supply marks give way, LOW POWER before HOT, never the state, the quiet mark,
  // the hint, the voice mark or NO BUTTONS.
  const tagsEnd = () => el.tags.getBoundingClientRect().right;
  const limit = () => el.band.clientWidth - (el.band.classList.contains('tight') ? 10 : 24) + 0.5;
  const shown = (n) => n.getClientRects().length > 0;
  const lastFixed = () => [el.voice, el.others, el['quiet-tag'], el.clock].find(shown);
  const layoutBand = () => {
    el.band.classList.remove('tight');
    const tagPx = el.tags.hidden ? 0 : el.tags.offsetWidth + 24;
    const last = lastFixed();
    if (last && last.getBoundingClientRect().right > el.band.clientWidth - 24 - tagPx) el.band.classList.add('tight');
    if (!el.tags.hidden && tagsEnd() > limit()) el.band.classList.add('tight');
  };
  // the time marks are measured at their widest text (a tick must never push anything out), then put back
  const timeMarks = [[el.clock, null], [el['quiet-tag'], 'QUIET 99+ MIN']].filter(([n]) => !n.hidden);
  const timeText = timeMarks.map(([n]) => n.textContent);
  for (const [n, wide] of timeMarks) n.textContent = wide ?? widestClock();
  layoutBand();
  if (!el.clock.hidden) {
    // #where's own margin and gap count once it has text; it may be empty or hidden from the last render
    const [whereText, whereHidden] = [el.where.textContent, el.where.hidden];
    el.where.hidden = false;
    el.where.textContent = 'x';
    const over = () => (el.tags.hidden ? lastFixed().getBoundingClientRect().right : tagsEnd()) > limit();
    if (over()) {
      el.clock.hidden = true;
      timeState.clockRoom = false;
      layoutBand();
    }
    el.where.textContent = whereText;
    el.where.hidden = whereHidden;
  }
  for (const tag of [el['power-tag'], el['hot-tag']]) {
    if (el.tags.hidden || tagsEnd() <= limit()) break;
    showTag(tag, false, '');
    el.tags.hidden = el['hot-tag'].hidden && el['power-tag'].hidden && el['buttons-tag'].hidden;
  }
  timeMarks.forEach(([n], i) => { n.textContent = timeText[i]; });
  paintTime();

  // fitting needs layout, so it comes after the fields are in place
  if (view === 'asking') renderAsk(s.ask, askRows);
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
    fitFile(file); // #session now takes room in row A: fit the file again
  }
  renderNav(s.nav);
  document.documentElement.dataset.rendered = view;
}

// ---- CLAUDE ASKS: the question (or the plan title) in big type, the options below, the counts in row A ----
const ASK_WORDS = { AskUserQuestion: 'Question', ExitPlanMode: 'Plan' }; // row A under CLAUDE ASKS
const ASK_NOTE = 'Claude asks: look at the terminal when parked';
const ASK_HINTS = {
  pick: 'Allow picks · Deny cancels',
  plan: 'Allow approves · Deny keeps planning',
  terminal: 'Answer in the terminal when parked · Deny cancels',
};
const ASK_LINES = 2; // the big text takes at most 2 lines
const ASK_LINE_HEIGHT = 1.1;
const isCount = (n) => Number.isInteger(n) && n > 0;
const askRow = (id, cls, text, extra) => {
  const n = document.createElement('span');
  n.id = id;
  n.className = cls;
  n.textContent = text;
  n.dataset.full = text;
  return Object.assign(n, extra);
};

function renderAsk(input, noteRows) {
  const a = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  let big = ASK_NOTE;
  let options = [];
  let steps = '';
  // who answers: the buttons pick the highlighted option ('pick'), approve a plan ('plan'), or only the terminal can ('terminal')
  const answer = a.answer === 'pick' || a.answer === 'plan' ? a.answer : 'terminal';
  let hint = ASK_HINTS[answer];
  const meta = { 'ask-multi': '', 'ask-count': '', 'ask-more': '' };
  const full = { 'ask-multi': 'More than one option can be picked', 'ask-count': '', 'ask-more': '' };
  if (a.kind === 'plan') {
    big = str(a.title) !== '' ? `Plan: ${a.title}` : 'Claude has a plan';
    if (isCount(a.steps)) steps = `${a.steps} step${a.steps === 1 ? '' : 's'}`;
  } else if (a.kind === 'question') {
    if (str(a.question) !== '') big = a.question;
    options = Array.isArray(a.options) ? a.options.filter((o) => typeof o === 'string' && o !== '').slice(0, 4) : [];
    if (a.multiSelect === true) meta['ask-multi'] = 'pick any';
    if (isCount(a.questions) && a.questions > 1) {
      meta['ask-count'] = `1 of ${a.questions}`;
      full['ask-count'] = `The call has ${a.questions} questions; this is the first`;
    }
    if (isCount(a.more)) {
      meta['ask-more'] = `+${a.more} more`;
      full['ask-more'] = `${a.more} more option${a.more === 1 ? '' : 's'} not shown`;
    }
  }
  for (const id of Object.keys(meta)) {
    set(el[id], meta[id]);
    if (meta[id] === '') el[id].dataset.full = '';
    else el[id].dataset.full = full[id];
  }
  el['ask-meta'].hidden = Object.values(meta).every((t) => t === '');
  el.ask.hidden = false;
  set(el['ask-steps'], steps);
  el['ask-options'].replaceChildren(...options.map((label, i) => {
    const cell = askRow(`ask-o${i + 1}`, 'ask-opt', '');
    cell.dataset.full = '';
    if (answer === 'pick' && a.choice === i) {
      // the highlighted choice: an inverted block with a thick frame (see view.css), not colour alone
      cell.classList.add('ask-chosen');
      cell.dataset.chosen = 'true';
    }
    cell.append(askRow(`ask-n${i + 1}`, 'ask-n', `${i + 1}`), askRow(`ask-t${i + 1}`, 'ask-t', label));
    return cell;
  }));
  // The big text: the state word's size when it fits, else the largest that does (rows below it are fixed 40 px rows).
  const lcs = getComputedStyle(el.lower);
  const inner = el.lower.clientHeight - parseFloat(lcs.paddingTop) - parseFloat(lcs.paddingBottom);
  const rowPx = parseFloat(getComputedStyle(el['ask-hint']).lineHeight) || 40;
  const rows = Math.ceil(options.length / 2) + (steps !== '' ? 1 : 0) + noteRows;
  const stateFont = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--state-font')) || 55;
  const q = el['ask-question'];
  const minPx = mmToPx(RANGE_MM.ask[0]) / capRatio(q);
  // The hint row is the first to go when, with the other rows (options, steps, the offline and voice notes), the question
  // could not keep its 4.0 mm size: those rows say what is wrong, the hint only what the buttons do.
  if ((inner - rowPx - (rows + 1) * rowPx) / ASK_LINES / ASK_LINE_HEIGHT < minPx) hint = '';
  set(el['ask-hint'], hint);
  const below = (rows + (hint !== '' ? 1 : 0)) * rowPx;
  const font = askFontPx(stateFont, (inner - rowPx - below) / ASK_LINES / ASK_LINE_HEIGHT, minPx);
  q.style.fontSize = `${font}px`;
  q.dataset.full = big;
  const limit = ASK_LINES * font * ASK_LINE_HEIGHT + 1;
  q.textContent = fitPrefix(big, (t) => {
    q.textContent = t;
    return q.getBoundingClientRect().height <= limit;
  });
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
    body.append(chip, text(`row${i}-label`, 'label', label), text(`row${i}-word`, 'word', r.quiet === true ? 'QUIET' : str(r.word)));
    if (r.target === true || r.voice === false) {
      // a session the buttons cannot drive shows the crossed mic (as the band does), never a plain one
      const off = r.voice === false;
      const mic = document.createElement('span');
      mic.className = 'row-mic';
      mic.dataset.mark = off ? 'mic-off' : 'mic';
      mic.innerHTML = svg(off ? MIC_OFF : MIC, 'mic');
      body.append(mic);
    }
  } else if ((nav.kind === 'new' || nav.kind === 'projects') && !isEmpty && str(r.label) !== '') {
    // project row: the last folder name first (bold), the rest of the path after it, dimmer (QA r5-07, r4-10)
    const full = str(r.label);
    const label = text(`row${i}-label`, 'label proj', '');
    label.dataset.full = full;
    const cut = full.length > 1 && full.endsWith('/') ? full.slice(0, -1) : full;
    const at = cut.lastIndexOf('/');
    const base = document.createElement('span');
    base.className = 'base';
    base.id = `row${i}-base`;
    base.textContent = at < 0 ? cut : cut.slice(at + 1) || cut;
    label.append(base);
    if (at >= 0 && cut.slice(0, at) !== '') {
      const dir = document.createElement('span');
      dir.className = 'dir';
      dir.id = `row${i}-dir`;
      dir.textContent = cut.slice(0, at);
      label.append(dir);
    }
    body.append(label);
    // a folder that does not exist says so in the row (choosing it is refused, see the note)
    if (r.missing === true) body.append(text(`row${i}-word`, 'word', 'MISSING'));
  } else {
    body.append(text(`row${i}-label`, 'label', str(r.label)));
  }
  return row;
}

function fitLabel(node) {
  if (node.classList.contains('proj')) {
    // the base name is never cut first: the path after it gives way (end cut); only a base that alone is too long is cut in its middle
    const base = node.querySelector('.base');
    const dir = node.querySelector('.dir');
    if (base.scrollWidth > base.clientWidth) {
      const full = base.textContent;
      base.textContent = middleEllipsis(full, (c) => {
        base.textContent = c;
        return base.scrollWidth <= base.clientWidth;
      });
    }
    if (dir && dir.scrollWidth > dir.clientWidth) {
      dir.textContent = fitPrefix(dir.textContent, (c) => {
        dir.textContent = c;
        return dir.scrollWidth <= dir.clientWidth;
      });
    }
    return;
  }
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
  // the settings screen is read only unless it shows a changeable row
  const titleText = input.kind === 'settings' && rows.some((r) => r.change === true) ? 'SETTINGS' : NAV_TITLES[input.kind];
  t.textContent = titleText;
  t.dataset.full = titleText;
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
const query = new URLSearchParams(location.search);

// Live: the server pushes {seq, now, state} on /events. A dead link shows "no link", never a stale state.
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
      // the server's clock is the page's clock plus this offset; a message without `now` leaves the page's own clock (offset 0)
      liveOwn = !finite(msg.now);
      liveOffset = liveOwn ? 0 : msg.now - performance.now();
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
  // the clock and the quiet text move once a second, with no new render
  setInterval(paintTime, 1000);
  // nothing is known until the first message: NO LINK, never STARTING (only RevviewStarting makes that)
  render({ view: 'no-link' });
  connect();
  // lets a reload of this page survive a server that is away (QA 08); the page works without it
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

document.documentElement.dataset.look = 'day';
if (!query.has('fixture') && !query.has('state')) {
  liveLook = true;
  try {
    const last = localStorage.getItem(LOOK_KEY);
    if (last === 'day' || last === 'night') document.documentElement.dataset.look = last;
  } catch { /* storage may be unavailable */ }
}
window.revviewRender = render;
window.revviewLastState = () => lastInput;
applyTypeSizes();
await document.fonts.ready;
applyTypeSizes();
if (query.has('fixture') || query.has('state')) {
  root.dataset.link = 'static';
  render(await loadStatic(query));
} else {
  live();
  // dev only: without ?devkeys=1 the page attaches no key listener at all
  if (query.get('devkeys') === '1') import('./devkeys.js').then((m) => m.startDevKeys());
  // dev only (the laptop emulator's --lights): a strip of LEDs below the 1280x400 panel
  if (query.get('lights') === '1') import('./devlights.js').then((m) => m.startDevLights());
}
