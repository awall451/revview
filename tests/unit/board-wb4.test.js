import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialBoard, reduceBoard, boardView, shownPrompt, sessionOrder, homeKey, selectedKey, MAX_SESSIONS,
} from '../../src/state/index.js';

const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const S = (id) => ({ session_id: id, cwd: `/w/${id.toLowerCase()}` });
const BASH = { tool_name: 'Bash', tool_input: { command: 'npm test' } };
const start = (id) => ev('SessionStart', S(id));
const work = (id) => ev('UserPromptSubmit', S(id));
const stop = (id) => ev('Stop', S(id));
const ask = (id) => ev('PermissionRequest', { ...S(id), ...BASH });
const end = (id) => ev('SessionEnd', S(id));
const nav = (button, gesture = 'tap') => ev('RevviewNav', { button, gesture });
const select = (id) => ev('RevviewSelect', { session_id: id });
const three = () => run([start('A'), start('B'), start('C')]);

test('order: by born then id, never the anonymous session', () => {
  const b = run([start('C'), start('A'), ev('UserPromptSubmit', {}), start('B')]);
  assert.deepEqual(sessionOrder(b), ['C', 'A', 'B']);
  assert.equal(b.sessions.C.born, 1);
  const later = run([work('C'), work('A')], b);
  assert.equal(later.sessions.C.born, 1);
  assert.deepEqual(sessionOrder(later), ['C', 'A', 'B']);
});

test('left/right wrap in both directions over 3 sessions', () => {
  let b = run([select('A')], three());
  assert.equal(b.selected, 'A');
  const seen = [];
  for (let i = 0; i < 4; i += 1) { b = reduceBoard(b, nav('right')); seen.push(b.selected); }
  assert.deepEqual(seen, ['B', 'C', 'A', 'B']);
  const back = [];
  for (let i = 0; i < 4; i += 1) { b = reduceBoard(b, nav('left')); back.push(b.selected); }
  assert.deepEqual(back, ['A', 'C', 'B', 'A']);
  assert.equal(b.focus, 'A');
  assert.equal(boardView(b).position, null); // owned === null
});

test('nothing selected: left/right start from the shown session', () => {
  const b = three(); // shown by the old heuristics
  assert.equal(b.selected, null);
  const order = sessionOrder(b);
  const i = order.indexOf(b.focus);
  assert.equal(reduceBoard(b, nav('right')).selected, order[(i + 1) % 3]);
  assert.equal(reduceBoard(b, nav('left')).selected, order[(i + 2) % 3]);
  assert.equal(reduceBoard(initialBoard(), nav('left')).selected, null);
  assert.equal(reduceBoard(run([start('A')]), nav('right')).selected, 'A');
});

test('other sessions never move selected; elsewhere counts prompts, others counts sessions', () => {
  let b = run([select('A')], three());
  b = run([work('A'), work('B'), ask('B')], b);
  assert.equal(b.selected, 'A');
  assert.equal(b.focus, 'A');
  const v = boardView(b);
  assert.equal(v.view, 'working');
  assert.equal(v.others, 2);
  assert.equal(v.elsewhere, 1);
  assert.equal(shownPrompt(b), null);
});

test('selected null: the old heuristics still apply (a prompt pre-empts)', () => {
  const b = run([start('A'), work('A'), start('B'), work('B'), ask('B')]);
  assert.equal(b.selected, null);
  assert.equal(b.focus, 'B');
  assert.equal(boardView(b).view, 'permission');
  assert.equal(boardView(b).elsewhere, 0);
});

test('home: permission > waiting > done > working', () => {
  const b = run([start('W'), work('W'), start('D'), work('D'), stop('D'), start('L'), start('P'), work('P'), ask('P')]);
  assert.equal(homeKey(b), 'P');
  assert.equal(homeKey(run([end('P')], b)), 'L');
  assert.equal(homeKey(run([end('P'), end('L')], b)), 'D');
  assert.equal(homeKey(run([end('P'), end('L'), end('D')], b)), 'W');
  assert.equal(homeKey(initialBoard()), null);
  assert.equal(homeKey(run([ev('UserPromptSubmit', {})])), null);
});

test('home: oldest ask first among prompts, smallest touched among equals', () => {
  let b = run([start('A'), work('A'), start('B'), work('B'), ask('B'), ask('A')]);
  assert.equal(homeKey(b), 'B'); // B asked first
  b = run([start('A'), work('A'), start('B'), work('B')]);
  assert.equal(homeKey(b), 'A'); // both working, A touched earlier
  b = run([ev('PreToolUse', { ...S('A'), ...BASH, tool_use_id: 't1' })], b);
  assert.equal(homeKey(b), 'B');
  assert.equal(homeKey(run([start('X'), start('Y')])), 'X');
});

test('SessionEnd of the selected falls to the neediest; of another keeps selected', () => {
  let b = run([select('A'), work('B'), work('C'), ask('C')], three());
  assert.equal(b.selected, 'A');
  assert.equal(selectedKey(run([end('B')], b)), 'A');
  const after = run([end('A')], b);
  assert.equal(after.selected, homeKey(after));
  assert.equal(after.selected, 'C');
  assert.equal(after.focus, 'C');
  b = run([end('B'), end('C'), end('A')], b);
  assert.equal(b.selected, null);
  assert.equal(selectedKey(b), null);
});

test('capSessions keeps the selected session past the cap', () => {
  let b = run(Array.from({ length: MAX_SESSIONS }, (_, i) => start(`s${i}`)));
  b = run([select('s0')], b);
  for (let i = 0; i < 5; i += 1) b = run([start(`n${i}`), work(`n${i}`)], b);
  assert.ok(Object.keys(b.sessions).includes('s0'));
  assert.equal(Object.keys(b.sessions).length, MAX_SESSIONS);
  assert.equal(b.selected, 's0');
});

test('RevviewSelect of an unknown id sets want; the first event of that session selects it', () => {
  let b = run([select('A')], run([start('A')]));
  assert.equal(b.selected, 'A');
  b = reduceBoard(b, select('N'));
  assert.equal(b.want, 'N');
  assert.equal(b.selected, 'A');
  assert.equal(reduceBoard(b, select('N')), b);
  b = run([work('A')], b);
  assert.equal(b.want, 'N');
  b = run([start('N')], b);
  assert.equal(b.selected, 'N');
  assert.equal(b.want, null);
  assert.equal(b.focus, 'N');
  b = reduceBoard(reduceBoard(b, select('Z')), select('A'));
  assert.equal(b.want, null);
  assert.equal(b.selected, 'A');
});

test('want protects its session from the cap', () => {
  const b = run([select('N')], run(Array.from({ length: MAX_SESSIONS }, (_, i) => start(`s${i}`))));
  const c = run([start('N')], b);
  assert.equal(c.selected, 'N');
  assert.ok(Object.keys(c.sessions).includes('N'));
  assert.equal(Object.keys(c.sessions).length, MAX_SESSIONS);
});

test('RevviewStarting clears selected and nav, keeps the choice as want; owned and projects stay', () => {
  let b = run([ev('RevviewOwned', { ids: ['A'] }), ev('RevviewProjects', { paths: ['/p'] }), select('A'), select('N'), nav('menu')], three());
  b = reduceBoard(b, ev('RevviewStarting'));
  assert.equal(b.selected, null);
  assert.equal(b.want, 'N'); // the newest intention (a session revview started) wins over the old selection
  assert.equal(b.nav, null);
  assert.deepEqual(b.owned, ['A']);
  assert.deepEqual(b.projects, ['/p']);
  assert.equal(reduceBoard(b, ev('RevviewStarting')), b);
  // without a pending start the selection itself is kept as want and comes back with its session's events
  let c = run([select('A'), ev('RevviewStarting')], three());
  assert.equal(c.selected, null);
  assert.equal(c.want, 'A');
  c = run([start('B'), start('A')], c);
  assert.equal(c.selected, 'A');
  assert.equal(boardView(c).position, null); // owned null here: no position
});

const P = ['/p/one', '/p/two', '/p/three'];
const withP = (b) => reduceBoard(b, ev('RevviewProjects', { paths: P }));

test('nav: normal view opening, row = shown session index', () => {
  let b = run([select('B')], three());
  const { tick } = b;
  for (const k of ['up', 'down', 'press']) {
    const o = reduceBoard(b, nav(k));
    assert.deepEqual(o.nav, { kind: 'list', row: 1, id: 'B' }, k);
    assert.equal(o.tick, tick);
    assert.equal(o.sessions, b.sessions);
  }
  assert.deepEqual(reduceBoard(initialBoard(), nav('up')).nav, { kind: 'list', row: 0 }); // no sessions: no id
  assert.deepEqual(reduceBoard(b, nav('menu')).nav, { kind: 'menu', row: 0 });
  for (const [k, g] of [['push-to-talk', 'tap'], ['cancel', 'tap'], ['deny', 'tap'], ['back', 'tap'], ['spare', 'tap'], ['up', 'hold'], ['press', 'long-hold'], ['menu', 'hold']]) {
    assert.equal(reduceBoard(b, nav(k, g)), b, `${k} ${g}`);
  }
  assert.equal(reduceBoard(b, nav('timeout', 'hold')), b);
  b = reduceBoard(b, nav('menu'));
  assert.equal(reduceBoard(b, nav('timeout', 'hold')).nav, null);
});

test('nav list: clamp, press chooses, back closes, back hold goes home, menu opens the menu', () => {
  const base = run([select('A'), work('B'), work('C'), ask('C')], three()); // home = C
  let b = reduceBoard(base, nav('press'));
  assert.deepEqual(b.nav, { kind: 'list', row: 0, id: 'A' });
  assert.equal(reduceBoard(b, nav('up')), b); // clamp at the top
  b = reduceBoard(b, nav('down'));
  b = reduceBoard(b, nav('down'));
  assert.equal(b.nav.row, 2);
  assert.equal(reduceBoard(b, nav('down')), b); // clamp at the bottom
  const chosen = reduceBoard(b, nav('press'));
  assert.equal(chosen.selected, 'C');
  assert.equal(chosen.nav, null);
  b = reduceBoard(b, nav('up'));
  assert.equal(reduceBoard(b, nav('press')).selected, 'B');
  assert.equal(reduceBoard(b, nav('back')).nav, null);
  assert.equal(reduceBoard(b, nav('back')).selected, 'A');
  const home = reduceBoard(b, nav('back', 'hold'));
  assert.equal(home.selected, 'C');
  assert.equal(home.nav, null);
  assert.deepEqual(reduceBoard(b, nav('menu')).nav, { kind: 'menu', row: 0 });
  for (const [k, g] of [['push-to-talk', 'tap'], ['deny', 'tap'], ['cancel', 'tap'], ['left', 'tap'], ['right', 'tap'], ['spare', 'tap'], ['press', 'hold']]) {
    assert.equal(reduceBoard(b, nav(k, g)), b, `${k} ${g}`);
  }
});

test('nav menu, new, projects, settings', () => {
  let b = withP(three());
  b = reduceBoard(b, nav('menu'));
  assert.deepEqual(b.nav, { kind: 'menu', row: 0 });
  assert.equal(reduceBoard(b, nav('up')), b);
  assert.equal(reduceBoard(b, nav('menu')).nav, null);
  assert.equal(reduceBoard(b, nav('back')).nav, null);
  const down1 = reduceBoard(b, nav('down'));
  const down2 = reduceBoard(down1, nav('down'));
  assert.equal(down2.nav.row, 2);
  assert.equal(reduceBoard(down2, nav('down')), down2);
  const kinds = [reduceBoard(b, nav('press')), reduceBoard(down1, nav('press')), reduceBoard(down2, nav('press'))];
  assert.deepEqual(kinds.map((x) => x.nav), [{ kind: 'new', row: 0 }, { kind: 'projects', row: 0 }, { kind: 'settings', row: 0 }]);
  kinds.forEach((x, i) => {
    assert.deepEqual(reduceBoard(x, nav('back')).nav, { kind: 'menu', row: i });
    assert.equal(reduceBoard(x, nav('menu')).nav, null);
    const h = reduceBoard(x, nav('back', 'hold'));
    assert.equal(h.nav, null);
    assert.equal(h.selected, 'A'); // home of three waiting sessions: the oldest
    assert.equal(reduceBoard(x, nav('timeout')).nav, null);
  });
  const [nw, pr, st] = kinds;
  let s1 = nw;
  for (let i = 0; i < 6; i += 1) s1 = reduceBoard(s1, nav('down'));
  assert.equal(s1.nav.row, 2); // 3 projects
  assert.equal(reduceBoard(pr, nav('up')), pr);
  let s2 = st;
  for (let i = 0; i < 6; i += 1) s2 = reduceBoard(s2, nav('down'));
  assert.equal(s2.nav.row, 3); // 4 settings rows
  assert.equal(reduceBoard(nw, nav('press')).nav, null);
  assert.equal(reduceBoard(pr, nav('press')), pr);
  assert.equal(reduceBoard(st, nav('press')), st);
});

test('shownPrompt is null while a list or menu is open, back when it closes', () => {
  let b = run([select('A'), work('A'), ask('A')], run([start('A')]));
  assert.notEqual(shownPrompt(b), null);
  const open = reduceBoard(b, nav('menu'));
  assert.equal(shownPrompt(open), null);
  assert.equal(boardView(open).view, 'permission');
  b = reduceBoard(open, nav('timeout'));
  assert.notEqual(shownPrompt(b), null);
  assert.equal(shownPrompt(reduceBoard(b, nav('up'))), null);
});

test('voice: null, no-session, none, here, not-owned', () => {
  let b = run([start('A'), start('B')]);
  assert.equal(boardView(b).voice, null);
  assert.equal(boardView(b).position, null);
  b = reduceBoard(b, ev('RevviewOwned', { ids: [] }));
  assert.equal(boardView(b).voice, 'no-session');
  b = reduceBoard(b, ev('RevviewOwned', { ids: ['A'] }));
  assert.equal(boardView(b).voice, 'none');
  b = reduceBoard(b, select('A'));
  assert.equal(boardView(b).voice, 'here');
  b = reduceBoard(b, select('B'));
  assert.equal(boardView(b).voice, 'not-owned');
  assert.equal(boardView(initialBoard()).voice, null);
  assert.equal(boardView(reduceBoard(initialBoard(), ev('RevviewOwned', { ids: ['x'] }))).voice, 'none');
});

test('position and elsewhere', () => {
  let b = reduceBoard(three(), ev('RevviewOwned', { ids: ['A'] }));
  b = reduceBoard(b, select('B'));
  assert.deepEqual(boardView(b).position, { index: 2, count: 3 });
  b = run([work('C'), ask('C')], b);
  assert.equal(boardView(b).elsewhere, 1);
  assert.equal(boardView(reduceBoard(initialBoard(), ev('RevviewOwned', { ids: ['A'] }))).position, null);
});

test('nav rows content', () => {
  let b = run([start('A'), start('B'), start('C'), work('A'), work('B'), work('C'), ask('A'),
    ev('RevviewOwned', { ids: ['A'] }), ev('RevviewProjects', { paths: ['/p/x'] }), select('B')]);
  b = reduceBoard(b, nav('press'));
  const v = boardView(b);
  assert.equal(v.nav.kind, 'list');
  assert.equal(v.nav.row, 1);
  assert.equal(v.nav.rows.length, 3);
  assert.deepEqual(v.nav.rows[0], { label: 'a', word: 'PERMISSION', state: 'permission', target: false, voice: true });
  assert.deepEqual(v.nav.rows[1], { label: 'b', word: 'WORKING', state: 'working', target: true, voice: false });
  assert.deepEqual(v.nav.rows[2], { label: 'c', word: 'WORKING', state: 'working', target: false, voice: false });
  const closed = reduceBoard(b, nav('timeout'));
  const unk = boardView(reduceBoard(run([ev('SessionStart', { session_id: 'Z' })]), nav('up')));
  assert.deepEqual(unk.nav.rows[0], { label: '', word: 'WAITING', state: 'waiting', target: false, voice: null });
  const menu = boardView(reduceBoard(closed, nav('menu')));
  assert.deepEqual(menu.nav, { kind: 'menu', row: 0, rows: [{ label: 'New session' }, { label: 'Projects' }, { label: 'Settings' }] });
  assert.deepEqual(boardView({ ...b, nav: { kind: 'projects', row: 5 } }).nav, { kind: 'projects', row: 0, rows: [{ label: '/p/x' }] });
  assert.deepEqual(boardView({ ...initialBoard(), nav: { kind: 'new', row: 3 } }).nav, { kind: 'new', row: 0, rows: [] });
  assert.deepEqual(boardView({ ...b, nav: { kind: 'settings', row: 0 } }).nav.rows.map((r) => r.label), [
    'Voice: needs tap mode (/voice tap in Claude Code)', 'Wheel buttons: not known', 'Sessions: 3 on the bar, 1 started by revview', 'Projects: 1 in the config file',
  ]);
  assert.equal(boardView({ ...b, buttons: true, nav: { kind: 'settings', row: 0 } }).nav.rows[1].label, 'Wheel buttons: found');
  assert.equal(boardView({ ...b, buttons: false, nav: { kind: 'settings', row: 0 } }).nav.rows[1].label, 'Wheel buttons: not found');
  assert.equal(boardView({ ...initialBoard(), nav: { kind: 'settings', row: 0 } }).nav.rows[2].label, 'Sessions: 0 on the bar, 0 started by revview');
  assert.equal(boardView(initialBoard()).nav, null);
});

test('rows shrinking while a view is open: clamped on use', () => {
  let b = reduceBoard(three(), nav('press'));
  b = reduceBoard(reduceBoard(b, nav('down')), nav('down'));
  assert.equal(b.nav.row, 2);
  b = { ...b, nav: { kind: 'list', row: 2 } }; // an older board: a list without a highlighted id falls back to the row
  b = run([end('B'), end('C')], b);
  assert.equal(boardView(b).nav.row, 0);
  assert.equal(reduceBoard(b, nav('press')).selected, 'A');
});

test('malformed internal events leave the same board reference', () => {
  const b = reduceBoard(run([start('A')]), select('A'));
  const bad = [
    ev('RevviewSelect'), ev('RevviewSelect', { session_id: '' }), ev('RevviewSelect', { session_id: 5 }),
    ev('RevviewOwned'), ev('RevviewOwned', { ids: 'A' }), ev('RevviewOwned', { ids: [''] }), ev('RevviewOwned', { ids: [1] }),
    ev('RevviewOwned', { ids: Array.from({ length: 65 }, (_, i) => `i${i}`) }), ev('RevviewOwned', { ids: ['x'.repeat(201)] }),
    ev('RevviewProjects'), ev('RevviewProjects', { paths: 'x' }), ev('RevviewProjects', { paths: [1] }),
    ev('RevviewProjects', { paths: Array.from({ length: 33 }, () => 'p') }), ev('RevviewProjects', { paths: ['p'.repeat(4097)] }),
    ev('RevviewNav'), ev('RevviewNav', { button: 'left' }), ev('RevviewNav', { button: 'left', gesture: 'x' }),
    ev('RevviewNav', { button: 'nope', gesture: 'tap' }), ev('RevviewNav', { button: 5, gesture: 'tap' }),
  ];
  for (const e of bad) assert.equal(reduceBoard(b, e), b, JSON.stringify(e).slice(0, 60));
  const o = reduceBoard(b, ev('RevviewOwned', { ids: ['A', 'B', 'A'] }));
  assert.deepEqual(o.owned, ['A', 'B']);
  assert.equal(reduceBoard(o, ev('RevviewOwned', { ids: ['B', 'A'] })), o);
  const p = reduceBoard(b, ev('RevviewProjects', { paths: ['a'] }));
  assert.equal(reduceBoard(p, ev('RevviewProjects', { paths: ['a'] })), p);
  assert.equal(reduceBoard(b, select('A')), b);
});

test('garbage in the new board fields is replaced, never throws', () => {
  const good = three();
  const junk = [
    { selected: 5 }, { want: 5 }, { owned: 'x' }, { owned: [1] }, { nav: 'list' }, { nav: { kind: 'zz', row: 0 } },
    { nav: { kind: 'list', row: -1 } }, { nav: { kind: 'list', row: 1.5 } }, { projects: null }, { projects: [1] },
    { sessions: { ...good.sessions, A: { ...good.sessions.A, born: 'x' } } },
  ];
  for (const j of junk) {
    const bad = { ...good, ...j };
    assert.doesNotThrow(() => {
      boardView(bad); shownPrompt(bad); sessionOrder(bad); homeKey(bad); selectedKey(bad);
    });
    assert.deepEqual(boardView(bad), boardView(initialBoard()));
    assert.deepEqual(reduceBoard(bad, nav('left')), initialBoard());
  }
  assert.equal(selectedKey({ ...good, selected: 'ghost' }), null);
});

test('moving around a list or menu keeps a pending want; choosing a session drops it', () => {
  let b = run([start('a1'), ev('RevviewSelect', { session_id: 'a1' }), ev('RevviewSelect', { session_id: 'new1' })]);
  assert.equal(b.want, 'new1');
  for (const button of ['menu', 'down', 'up', 'back']) b = reduceBoard(b, ev('RevviewNav', { button, gesture: 'tap' }));
  assert.equal(b.want, 'new1');
  b = reduceBoard(b, start('new1'));
  assert.equal(b.selected, 'new1');
  b = run([ev('RevviewSelect', { session_id: 'new2' }), ev('RevviewNav', { button: 'left', gesture: 'tap' })], b);
  assert.equal(b.selected, 'a1');
  assert.equal(b.want, null);
});

test('list highlight follows its session: a session above ending does not change what press selects', () => {
  let b = run([start('alpha'), start('xray'), start('yankee'), select('alpha'), work('alpha'), work('yankee'), stop('xray')]);
  b = reduceBoard(b, nav('press'));
  assert.deepEqual(b.nav, { kind: 'list', row: 0, id: 'alpha' });
  b = reduceBoard(b, nav('down'));
  assert.equal(b.nav.id, 'xray');
  b = reduceBoard(b, end('alpha'));
  assert.equal(b.nav.id, 'xray');
  assert.equal(b.nav.row, 0);
  assert.equal(boardView(b).nav.row, 0);
  assert.equal(reduceBoard(b, nav('press')).selected, 'xray');
  assert.equal(reduceBoard(reduceBoard(b, nav('down')), nav('press')).selected, 'yankee');
});

test('highlighted session ends: the list closes, the note is set, the selection is not changed by it', () => {
  let b = run([select('A')], three());
  b = reduceBoard(reduceBoard(b, nav('press')), nav('down'));
  assert.equal(b.nav.id, 'B');
  b = reduceBoard(b, end('B'));
  assert.equal(b.nav, null);
  assert.equal(b.selected, 'A');
  assert.equal(boardView(b).note, 'Highlighted session ended: list closed');
  const c = reduceBoard(b, nav('right')); // a gesture clears the note
  assert.equal(boardView(c).note, null);
});

test('RevviewNote: 1..120 chars only; cleared by a nav gesture and by RevviewSelect; a board without note is valid', () => {
  const b = run([start('A')]);
  const noted = reduceBoard(b, ev('RevviewNote', { note: 'hello' }));
  assert.equal(boardView(noted).note, 'hello');
  for (const note of ['', 'x'.repeat(121), 5, null, undefined]) assert.equal(reduceBoard(b, ev('RevviewNote', { note })), b);
  assert.equal(boardView(reduceBoard(b, ev('RevviewNote', { note: 'x'.repeat(120) }))).note.length, 120);
  assert.equal(boardView(reduceBoard(noted, nav('up'))).note, null);
  assert.equal(boardView(reduceBoard(noted, nav('timeout', 'hold'))).note, null);
  assert.equal(boardView(reduceBoard(noted, select('A'))).note, null);
  const old = { ...noted };
  delete old.note;
  assert.equal(boardView(old).note, null);
  assert.equal(boardView(reduceBoard(old, start('B'))).view, 'waiting');
});

test('RevviewProjects changing the list closes an open New session / Projects view', () => {
  for (const kind of ['new', 'projects']) {
    const b = { ...withP(run([start('A')])), nav: { kind, row: 0 } };
    assert.equal(reduceBoard(b, ev('RevviewProjects', { paths: P })), b);
    assert.equal(reduceBoard(b, ev('RevviewProjects', { paths: ['/q'] })).nav, null);
  }
});

// ---- placeholders for owned sessions (QA r4-01, r4-03, r4-08)
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const owned = (ids, names) => ev('RevviewOwned', names === undefined ? { ids } : { ids, names });

test('placeholders: an owned UUID session not on the board appears, quiet, UNKNOWN, named', () => {
  const b = run([owned([U1, U2], ['alpha', null])]);
  assert.deepEqual(sessionOrder(b), [U1, U2]);
  assert.equal(b.sessions[U1].quiet, true);
  assert.equal(b.sessions[U1].state.repo, 'alpha');
  assert.equal(b.sessions[U2].state.repo, null);
  const v = boardView(run([owned([U1], ['alpha']), select(U1)]));
  assert.equal(v.view, 'unknown');
  assert.equal(v.note, 'No events from this session yet');
  assert.equal(v.voice, 'here');
  const l = boardView(run([owned([U1, U2], ['alpha', null]), nav('press')]));
  assert.deepEqual(l.nav.rows.map((r) => [r.label, r.word]), [['alpha', 'UNKNOWN'], ['', 'UNKNOWN']]);
});

test('placeholders: not for non-UUID ids, bad names are null, names trimmed to 64', () => {
  const b = run([owned(['A', U1, U2, U3], ['x', 'bad\nname', 'y'.repeat(201), 'z'.repeat(100)])]);
  assert.deepEqual(sessionOrder(b), [U1, U2, U3]);
  assert.equal(b.sessions[U1].state.repo, null);
  assert.equal(b.sessions[U2].state.repo, null);
  assert.equal(b.sessions[U3].state.repo, 'z'.repeat(64));
});

test('placeholders: same board when nothing changes; come back after RevviewStarting; not for ended', () => {
  const b = run([owned([U1], ['a'])]);
  assert.equal(reduceBoard(b, owned([U1], ['a'])), b);
  const c = run([ev('RevviewStarting'), owned([U1], ['a'])], b);
  assert.deepEqual(sessionOrder(c), [U1]);
  // an end of a session whose window is no longer owned is remembered: no placeholder for it
  const d = run([owned([U1]), start(U1), owned([]), end(U1), owned([U1])]);
  assert.deepEqual(sessionOrder(d), []);
  // an end of a session whose window is still owned is not (docs/DECISIONS.md, core hardening): it is back
  const e = run([owned([U1]), start(U1), end(U1), owned([U1])]);
  assert.deepEqual(sessionOrder(e), [U1]);
});

test('placeholders: removed when no longer owned; a real session is kept', () => {
  const b = run([owned([U1, U2]), start(U2), owned([])]);
  assert.deepEqual(sessionOrder(b), [U2]);
});

test('placeholders: the first hook event replaces it: normal session, same born, no quiet', () => {
  const p = run([owned([U1, U2])]);
  const b = reduceBoard(p, start(U2));
  assert.equal(b.sessions[U2].quiet, undefined);
  assert.equal(b.sessions[U2].born, p.sessions[U2].born);
  assert.equal(b.sessions[U1].quiet, true);
  assert.deepEqual(sessionOrder(b), [U1, U2]);
});

test('placeholders: a pending want becomes the selection when the owned list arrives', () => {
  const b = run([select(U1), owned([U1])]);
  assert.equal(selectedKey(b), U1);
  assert.equal(b.want, null);
});

test('capSessions: sessions not owned go before owned ones', () => {
  const ids = Array.from({ length: 6 }, (_, i) => `${String(i + 1).repeat(8)}-1111-4111-8111-111111111111`);
  let b = run([start('h1'), work('h1'), start('h2'), start('h3')]);
  b = run([owned(ids)], b);
  assert.equal(Object.keys(b.sessions).length, MAX_SESSIONS);
  assert.ok(ids.every((id) => b.sessions[id]), 'all owned kept');
  assert.equal(Object.keys(b.sessions).filter((k) => !ids.includes(k)).length, 2);
});

test('owned placeholders keep the owned order in the list (born), not the id order', () => {
  const late = 'ffffffff-0000-4000-8000-000000000001';
  const early = '00000000-0000-4000-8000-000000000002';
  const b = run([ev('RevviewOwned', { ids: [late, early], names: ['first', 'second'] })]);
  assert.deepEqual(sessionOrder(b), [late, early]);
  const after = run([start(early), start(late)], b);
  assert.deepEqual(sessionOrder(after), [late, early], 'a first hook event keeps the place');
});
