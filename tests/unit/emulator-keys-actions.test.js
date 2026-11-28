// The drift test for the key sheet (emulator/keys-sheet.js): for EVERY key of the laptop map and every gesture the map gives it,
// the key goes through the REAL input layer (loadConfig + createInputPipeline, a fake clock) and the emitted gesture through the
// REAL createActions(...).handle on a board where it does something. What happened (a key sent, an answer, speech, a change of the
// board) is reduced to an effect string by observe() from what the fakes recorded and how the real board reducer moved, never
// from the table; that effect must equal the table's `does` (`asks` on a CLAUDE ASKS board, `inList` with a list open), and the
// sheet row must carry the table's text. So a label that no longer tells the truth, a key without a label and a label without
// a key all fail here. Fakes only; no real timers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/input/keymap.js';
import { createInputPipeline } from '../../src/input/index.js';
import { createActions } from '../../src/sessions/index.js';
import { initialBoard, reduceBoard, sessionOrder, homeKey, selectedKey, shownAsk } from '../../src/state/index.js';

const MAP = fileURLToPath(new URL('../../config/buttons.laptop.json', import.meta.url));
const SCENES = fileURLToPath(new URL('../../emulator/demo/scenes.js', import.meta.url));
const { buildSheet, buildPages, TABLE, LABELS, EFFECTS } = await import('../../emulator/keys-sheet.js');
const map = JSON.parse(fs.readFileSync(MAP, 'utf8'));
const config = loadConfig(MAP);

// ---- the input layer: a key -> the gesture the real pipeline emits
function fakeClock() {
  let t = 0;
  let seq = 0;
  let timers = [];
  return {
    now: () => t,
    setTimeout(fn, ms) { const h = { fn, at: t + ms, seq: seq++ }; timers.push(h); return h; },
    clearTimeout(h) { timers = timers.filter((x) => x !== h); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
        if (!due) break;
        timers = timers.filter((x) => x !== due);
        t = due.at;
        due.fn();
      }
      t = end;
    },
  };
}
const GESTURE = { tap: 'tap', hold: 'hold', longHold: 'long-hold' };
const HELD_MS = { tap: 50, hold: config.timing.holdMs + 200, longHold: config.timing.longHoldMs + 200 };

function press(binding, kind) {
  const clock = fakeClock();
  const out = [];
  const p = createInputPipeline({ config, clock, onGesture: (g) => out.push(g) });
  p.feed(binding.key, 1);
  clock.advance(HELD_MS[kind]);
  p.feed(binding.key, 0);
  clock.advance(200);
  assert.equal(out.length, 1, `${binding.keyName}: one gesture for a ${kind}`);
  return out[0];
}

// ---- boards
const SID = (c) => `00000000-0000-4000-8000-00000000000${c}`;
const ev = (id, name, extra = {}) => ({ session_id: id, hook_event_name: name, ...extra });
const feed = (b, events) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const working = (id) => [ev(id, 'UserPromptSubmit', { prompt: 'x' })];
const permission = (id) => [
  ev(id, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'ls' } }),
  ev(id, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } }),
];
const select = (id) => ({ hook_event_name: 'RevviewSelect', session_id: id });
const navTap = (button) => ({ hook_event_name: 'RevviewNav', button, gesture: 'tap' });

// one session whose permission prompt is shown: Enter / N answer it, Esc / Ctrl+C go to Claude
const permissionBoard = () => feed(initialBoard(), [...working(SID(1)), ...permission(SID(1)), select(SID(1))]);
// one working session: Space is push-to-talk (on a prompt it says "Answer the prompt first")
const workingBoard = () => feed(initialBoard(), [...working(SID(1)), select(SID(1))]);
// four sessions, the fourth waiting on a permission (so it is the home)
function listBoard(selected = 2) {
  let b = initialBoard();
  for (const c of [1, 2, 3, 4]) b = feed(b, working(SID(c)));
  b = feed(b, permission(SID(4)));
  return feed(b, [select(SID(selected))]);
}

// ---- the real actions on fakes
function rig(board, { answerResult = { ok: true } } = {}) {
  const st = { board, sent: [], answers: [], speaks: 0, stops: 0, applied: [] };
  const runner = {
    target: async (id) => ({ id, window: '@1' }),
    send: async (k, id) => { st.sent.push(k); return { sent: true, id, window: '@1' }; },
    capture: async () => ({ ok: false, reason: 'no capture' }),
  };
  const registry = {
    answer: (kind, shown, chosen, opts) => { st.answers.push({ kind, opts }); return answerResult; },
    check: () => ({ ok: true }),
  };
  const readAloud = {
    speakFor: async () => { st.speaks += 1; return { spoken: true }; },
    stop: async () => { st.stops += 1; },
  };
  const timers = { setTimeout: () => ({ unref() {} }), clearTimeout() {} };
  st.actions = createActions({
    runner, registry, readAloud, timers, clock: () => 0,
    getBoard: () => st.board,
    apply: (e) => { st.applied.push(e); st.board = reduceBoard(st.board, e); },
  });
  return st;
}

// What happened, from what the fakes recorded and how the real board moved. Never read from the table.
function observe(before, st, { asks = false } = {}) {
  const after = st.board;
  if (st.sent.length > 0) return `send:${st.sent.join(',')}`;
  if (st.answers.length > 0) {
    const kind = st.answers[0].kind;
    if (!asks) return kind;
    return kind === 'allow' ? 'answer' : 'cancel';
  }
  if (st.speaks > 0) return 'read-aloud';
  if (st.stops > 0) return 'read-aloud-stop';
  if (asks) {
    const d = shownAsk(after).choice - shownAsk(before).choice;
    if (d !== 0) return d < 0 ? 'choice-up' : 'choice-down';
  }
  if (after.look !== before.look) return 'look-toggle';
  const a = selectedKey(after);
  const bf = selectedKey(before);
  if (before.nav !== null && after.nav === null) return a !== bf ? 'choose' : 'close';
  if (before.nav === null && after.nav !== null) return `${after.nav.kind}-open`;
  if (a !== bf) {
    const order = sessionOrder(after);
    const d = order.indexOf(a) - order.indexOf(bf);
    if (a === homeKey(after) && Math.abs(d) > 1) return 'home';
    return d === -1 ? 'session-prev' : d === 1 ? 'session-next' : `session-jump:${d}`;
  }
  return 'nothing';
}

// the board each button's gesture is tried on (a board where it does something)
const BOARD = {
  up: listBoard, down: listBoard, left: () => listBoard(2), right: () => listBoard(2), press: permissionBoard,
  back: () => listBoard(1), 'push-to-talk': workingBoard, 'read-aloud': workingBoard, cancel: permissionBoard,
  deny: permissionBoard, menu: workingBoard,
};
// back tap needs a list open to do something; back hold goes home from anywhere
const boardFor = (button, kind) => {
  const b = BOARD[button]();
  return button === 'back' && kind === 'tap' ? feed(b, [navTap('up')]) : b;
};

async function drive(binding, kind, board, opts) {
  const g = press(binding, kind);
  assert.deepEqual([g.button, g.gesture], [binding.button, GESTURE[kind]], `${binding.keyName}: the input layer emits ${binding.button} ${GESTURE[kind]}`);
  const st = rig(board, opts);
  const before = st.board;
  await st.actions.handle({ button: g.button, gesture: g.gesture, source: 'bridge', dropped: false });
  return { st, before };
}

const rows = [];
for (const b of config.bindings) {
  rows.push([b, 'tap']);
  if (b.hold) rows.push([b, 'hold']);
  if (b.longHold) rows.push([b, 'longHold']);
}

// every problem between the map's buttons and a table: a key with no entry, an entry with no key
function coverage(buttons, table) {
  const problems = [];
  for (const b of buttons) {
    const t = table[b.button];
    if (!t?.tap) problems.push(`no label for ${b.button} tap`);
    for (const k of ['hold', 'longHold']) {
      if (b[k] && !t?.[k]) problems.push(`no label for ${b.button} ${k}`);
      if (!b[k] && t?.[k]) problems.push(`label for ${b.button} ${k}, which the map does not give`);
    }
  }
  const names = new Set(buttons.map((b) => b.button));
  for (const name of Object.keys(table)) if (!names.has(name)) problems.push(`label for ${name}, which no key gives`);
  return problems;
}

test('the table and the laptop map cover each other, in both directions', () => {
  assert.deepEqual(coverage(map.buttons, TABLE), []);
  assert.deepEqual(Object.keys(LABELS).sort(), Object.keys(TABLE).sort());
  assert.deepEqual(Object.keys(EFFECTS).sort(), Object.keys(TABLE).sort());
  // every (button, gesture) of the map is driven below
  assert.equal(rows.length, map.buttons.length + map.buttons.filter((b) => b.hold).length + map.buttons.filter((b) => b.longHold).length);
});

test('a made-up extra label, a made-up extra key and a made-up extra gesture are found', () => {
  assert.match(coverage(map.buttons, { ...TABLE, ghost: { tap: { text: 'x', does: 'x' } } }).join('\n'), /label for ghost, which no key gives/);
  assert.match(coverage([...map.buttons, { key: 'Q', button: 'ghost' }], TABLE).join('\n'), /no label for ghost tap/);
  assert.match(coverage(map.buttons, { ...TABLE, up: { ...TABLE.up, hold: { text: 'x', does: 'x' } } }).join('\n'), /label for up hold, which the map does not give/);
  assert.match(coverage(map.buttons.map((b) => (b.button === 'up' ? { ...b, longHold: true } : b)), TABLE).join('\n'), /no label for up longHold/);
});

test('the sheet itself refuses a label without a key', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ka-'));
  try {
    const p = path.join(dir, 'm.json');
    fs.writeFileSync(p, JSON.stringify({ ...map, buttons: map.buttons.filter((b) => b.button !== 'menu') }));
    await assert.rejects(buildSheet({ mapPath: p, scenesPath: SCENES }), /label for menu, which no key of the map gives/);
    fs.writeFileSync(p, JSON.stringify({ ...map, buttons: map.buttons.map((b) => (b.button === 'menu' ? { ...b, hold: undefined } : b)) }));
    await assert.rejects(buildSheet({ mapPath: p, scenesPath: SCENES }), /menu hold, which the map does not give/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const sheetLines = (await buildSheet({ mapPath: MAP, scenesPath: SCENES })).split('\n');

for (const [binding, kind] of rows) {
  test(`${binding.key} (${binding.button} ${kind}): the real code does what the table says, and the sheet says it`, async () => {
    const entry = TABLE[binding.button]?.[kind];
    assert.ok(entry, 'a table entry');
    const { st, before } = await drive(binding, kind, boardFor(binding.button, kind));
    assert.notEqual(observe(before, st), 'nothing', `${binding.button} ${kind} does something on its board`);
    assert.equal(observe(before, st), entry.does, `${binding.button} ${kind}`);
    const row = sheetLines.find((l) => l.startsWith(String(binding.keyName).padEnd(10)) && l.split(/\s+/)[1] === binding.button);
    assert.ok(row?.includes(entry.text), `the sheet row has "${entry.text}"`);
  });
}

// ---- press with a list open chooses the highlighted session
test('press with a list open: chooses the highlighted row (the table says so)', async () => {
  const binding = config.bindings.find((b) => b.button === 'press');
  // the list is open on the second session; one Down moves the highlight to the third
  const board = feed(listBoard(2), [navTap('up'), navTap('down')]);
  const { st, before } = await drive(binding, 'tap', board);
  assert.equal(observe(before, st), TABLE.press.tap.inList);
  assert.equal(selectedKey(st.board), SID(3));
  assert.deepEqual([st.sent, st.answers], [[], []], 'nothing reaches Claude');
});

// ---- CLAUDE ASKS
const load = (name) => fs.readFileSync(new URL(`../../fixtures/sessions/${name}.jsonl`, import.meta.url), 'utf8')
  .split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
const ASKQ = load('ask-question');
const AID = ASKQ[0].session_id;
const askBoard = (pre = []) => feed(feed(initialBoard(), ASKQ.slice(0, 4)), [select(AID), ...pre]);

test('the ask fixture is a pick ask the buttons can answer', () => {
  assert.equal(shownAsk(askBoard()).answer, 'pick');
  assert.ok(shownAsk(askBoard()).ask.options.length >= 3);
});

const withAsks = Object.entries(TABLE).flatMap(([b, g]) => Object.values(g).filter((e) => e.asks).map((e) => [b, e]));
test('the table has ASKS effects for up, down, press and deny', () => {
  assert.deepEqual(withAsks.map(([b]) => b).sort(), ['deny', 'down', 'press', 'up']);
});

for (const [button, entry] of withAsks) {
  test(`${button} under CLAUDE ASKS: ${entry.asks} (the sheet text says ASKS)`, async () => {
    const binding = config.bindings.find((b) => b.button === button);
    // Up needs a highlight below the first choice to move; the others start at the first
    const board = askBoard(button === 'up' ? [navTap('down')] : []);
    const { st, before } = await drive(binding, 'tap', board);
    assert.equal(observe(before, st, { asks: true }), entry.asks, `${button} on an ask`);
    assert.deepEqual(st.sent, [], 'a question is never answered with a key');
    if (entry.asks === 'answer') assert.equal(st.answers[0].opts.label, shownAsk(before).ask.options[shownAsk(before).choice]);
    assert.match(entry.text, /ASKS/);
  });
}

test('the ASKS text and the `asks` effect go together, both ways; "choose" and `inList` too', () => {
  for (const [button, g] of Object.entries(TABLE)) {
    for (const [kind, e] of Object.entries(g)) {
      assert.equal(/ASKS/.test(e.text), e.asks !== undefined, `${button} ${kind}: ASKS in the text iff an asks effect`);
      assert.equal(/choose/.test(e.text), e.inList !== undefined, `${button} ${kind}: "choose" in the text iff an inList effect`);
    }
  }
});

test('several questions: Enter only says "Answer in the terminal when parked" (the sheet says terminal)', async () => {
  const twin = ASKQ[3];
  const two = { ...twin, tool_input: { questions: [...twin.tool_input.questions, ...twin.tool_input.questions] } };
  const b = feed(feed(initialBoard(), [...ASKQ.slice(0, 3), two]), [select(AID)]);
  assert.equal(shownAsk(b).answer, 'terminal');
  const binding = config.bindings.find((x) => x.button === 'press');
  const { st } = await drive(binding, 'tap', b);
  assert.deepEqual([st.sent, st.answers], [[], []]);
  assert.equal(st.board.note.text, 'Answer in the terminal when parked');
  assert.ok(sheetLines.some((l) => /ASKS: several questions, pick-any: terminal/.test(l)));
});

// ---- the sheet's pages
test('page 2 has every demo key with its scene, the pause and speed keys and the "Too early" rule', async () => {
  const [p1, p2] = await buildPages({ mapPath: MAP, scenesPath: SCENES });
  const { DEMO_KEYS } = await import('../../emulator/demo/scenes.js');
  assert.ok(DEMO_KEYS.length > 0);
  const lines = p2.split('\n');
  for (const k of DEMO_KEYS) {
    assert.ok(lines.some((l) => new RegExp(`(^|\\s)${k.key} ${k.scene}( |$)`).test(l)), `demo key ${k.key} ${k.scene}`);
  }
  assert.match(p2, /L lights \(only with --lights\)/);
  assert.match(p2, /P {2}pause/);
  assert.match(p2, /\[ {2}slower/);
  assert.match(p2, /\] {2}faster/);
  assert.match(p2, /Too early: press again/);
  assert.doesNotMatch(p1, /Too early/);
});

test('each page is at most 24 lines of 80 columns, and the sheet is the two pages joined', async () => {
  const pages = await buildPages({ mapPath: MAP, scenesPath: SCENES });
  assert.equal(pages.length, 2);
  for (const p of pages) {
    const lines = p.split('\n');
    if (lines.at(-1) === '') lines.pop();
    assert.ok(lines.length <= 24, `${lines.length} lines`);
    for (const l of lines) assert.ok(l.length <= 80, `${l.length} columns: ${l}`);
  }
  assert.equal(await buildSheet({ mapPath: MAP, scenesPath: SCENES }), `${pages[0]}\n${pages[1]}`);
  assert.match(pages[1], /^-- page 2: demo keys and rules --\n/);
});
