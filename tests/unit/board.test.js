import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  initialBoard, reduceBoard, boardView, replayView, MAX_SESSIONS,
} from '../../src/state/index.js';

const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const view = (events, b) => boardView(run(events, b));
const A = { session_id: 'A', cwd: '/w/alpha' };
const B = { session_id: 'B', cwd: '/w/beta' };
const BASH = { tool_name: 'Bash', tool_input: { command: 'npm test' } };

test('fresh board is unknown; RevviewStarting -> starting and clears sessions; SessionStart -> waiting', () => {
  assert.equal(boardView(initialBoard()).view, 'unknown');
  assert.equal(boardView(initialBoard()).activity, 'unknown');
  const b = run([ev('SessionStart', A), ev('UserPromptSubmit', A)]);
  assert.equal(boardView(b).view, 'working');
  const s = reduceBoard(b, ev('RevviewStarting'));
  assert.equal(boardView(s).view, 'starting');
  assert.deepEqual(s.sessions, {});
  assert.equal(boardView(run([ev('SessionStart', A)])).view, 'waiting');
});

test('initialBoard shape', () => {
  assert.deepEqual(initialBoard(), {
    phase: 'unknown', offline: false, locked: false, context: { repo: null, branch: null },
    sessions: {}, ended: [], tick: 0, focus: null, spokenTo: null, buttons: null,
    selected: null, want: null, owned: null, nav: null, projects: [],
  });
});

test('boardView always has exactly the same keys', () => {
  const keys = Object.keys(boardView(initialBoard())).sort();
  assert.deepEqual(keys, ['activity', 'branch', 'buttons', 'command', 'diff', 'diffIncomplete', 'elsewhere', 'file', 'locked', 'nav',
    'offline', 'others', 'output', 'outputLines', 'position', 'repo', 'tool', 'view', 'voice']);
  const b = run([ev('SessionStart', A), ev('PreToolUse', { ...A, ...BASH })]);
  assert.deepEqual(Object.keys(boardView(b)).sort(), keys);
});

test('two sessions: permission beats waiting/working; repo does not switch', () => {
  let b = run([
    ev('SessionStart', A), ev('UserPromptSubmit', A),
    ev('PermissionRequest', { ...A, ...BASH }),
    ev('SessionStart', B), ev('Notification', { ...B, notification_type: 'idle_prompt' }),
  ]);
  let v = boardView(b);
  assert.equal(v.view, 'permission');
  assert.equal(v.command, 'npm test');
  assert.equal(v.others, 1);
  assert.equal(v.repo, 'alpha');
  b = run([ev('UserPromptSubmit', A)], b);
  b = run([ev('Stop', B)], b);
  v = boardView(b);
  assert.equal(v.view, 'working');
  assert.equal(v.repo, 'alpha');
});

test('tie on priority picks the most recently touched', () => {
  const v = view([ev('UserPromptSubmit', A), ev('UserPromptSubmit', B)]);
  assert.equal(v.repo, 'beta');
});

test('subagent events share the session and create no second one', () => {
  const b = run([ev('SessionStart', A), ev('UserPromptSubmit', A),
    ev('PreToolUse', { ...A, agent_id: 'x', agent_type: 'Explore', ...BASH }), ev('SubagentStop', { ...A, agent_id: 'x' })]);
  assert.equal(boardView(b).others, 0);
  assert.equal(Object.keys(b.sessions).length, 1);
});

test('SessionEnd: only session -> ended, repo kept; two sessions -> other shown; late events ignored; restart', () => {
  const one = run([ev('SessionStart', A), ev('UserPromptSubmit', A), ev('SessionEnd', A)]);
  let v = boardView(one);
  assert.equal(v.view, 'ended');
  assert.equal(v.repo, 'alpha');
  const late = reduceBoard(one, ev('Notification', { ...A, notification_type: 'idle_prompt' }));
  assert.equal(late, one);
  const again = reduceBoard(one, ev('SessionStart', A));
  assert.equal(boardView(again).view, 'waiting');
  assert.deepEqual(again.ended, []);

  const two = run([ev('SessionStart', A), ev('SessionStart', B), ev('UserPromptSubmit', B), ev('SessionEnd', B)]);
  v = boardView(two);
  assert.equal(v.view, 'waiting');
  assert.equal(v.repo, 'alpha');
  assert.equal(v.others, 0);
});

test('late Post after Stop keeps done, updates fields; unknown id ignored; Pre after Stop -> working', () => {
  const edit = {
    tool_name: 'Edit', tool_input: { file_path: '/w/alpha/a.js', old_string: 'a', new_string: 'b\nc' },
  };
  let b = run([ev('SessionStart', A), ev('UserPromptSubmit', A),
    ev('PreToolUse', { ...A, ...BASH, tool_use_id: 'X' }),
    ev('PreToolUse', { ...A, ...edit, tool_use_id: 'Y' }), ev('Stop', A)]);
  assert.deepEqual(b.sessions.A.open, ['X', 'Y']);
  b = reduceBoard(b, ev('PostToolUse', { ...A, ...BASH, tool_use_id: 'X', tool_response: { stdout: '2 passed' } }));
  let v = boardView(b);
  assert.equal(v.view, 'done');
  assert.equal(v.output, '2 passed');
  b = reduceBoard(b, ev('PostToolUse', { ...A, ...edit, tool_use_id: 'Y', tool_response: {} }));
  v = boardView(b);
  assert.equal(v.view, 'done');
  assert.deepEqual(v.diff, { added: 2, removed: 1 });
  assert.deepEqual(b.sessions.A.open, []);
  assert.equal(reduceBoard(b, ev('PostToolUse', { ...A, ...BASH, tool_use_id: 'Z' })), b);
  assert.equal(reduceBoard(b, ev('PermissionDenied', A)), b);
  assert.equal(boardView(reduceBoard(b, ev('PreToolUse', { ...A, ...BASH, tool_use_id: 'W' }))).view, 'working');
});

test('RevviewDropped marks the session, UserPromptSubmit resets; without id marks the sessions in a turn', () => {
  let b = run([ev('SessionStart', A), ev('SessionStart', B), ev('RevviewDropped', A)]);
  assert.equal(b.sessions.A.dropped, true);
  assert.equal(b.sessions.B.dropped, false);
  b = reduceBoard(b, ev('UserPromptSubmit', A));
  assert.equal(b.sessions.A.dropped, false);
  b = reduceBoard(reduceBoard(b, ev('UserPromptSubmit', B)), ev('RevviewDropped'));
  assert.ok(b.sessions.A.dropped && b.sessions.B.dropped);
  assert.equal(boardView(b).diffIncomplete, true);
  const empty = initialBoard();
  assert.equal(reduceBoard(empty, ev('RevviewDropped')), empty);
});

test('an injected task-notification prompt keeps the open tools and the dropped mark', () => {
  let b = run([ev('SessionStart', A), ev('UserPromptSubmit', A), ev('PreToolUse', { ...A, ...BASH, tool_use_id: 't1' }),
    ev('RevviewDropped', A)]);
  b = reduceBoard(b, ev('UserPromptSubmit', { ...A, prompt: '<task-notification>\n<task-id>x</task-id>' }));
  assert.deepEqual(b.sessions.A.open, ['t1']);
  assert.equal(b.sessions.A.dropped, true);
  b = reduceBoard(b, ev('UserPromptSubmit', { ...A, prompt: 'next' }));
  assert.deepEqual(b.sessions.A.open, []);
  assert.equal(b.sessions.A.dropped, false);
});

test('RevviewContext goes to a live session, else to the board', () => {
  let b = run([ev('SessionStart', A), ev('RevviewContext', { session_id: 'A', cwd: '/w/alpha', branch: 'dev' })]);
  assert.equal(boardView(b).branch, 'dev');
  assert.equal(b.context.branch, null);
  b = run([ev('RevviewContext', { cwd: '/x/gamma', branch: 'main' })]);
  assert.deepEqual(b.context, { repo: 'gamma', branch: 'main' });
  assert.equal(boardView(b).repo, 'gamma');
});

test('overlays', () => {
  const b = run([ev('SessionStart', A), ev('RevviewNetwork', { online: false })]);
  assert.equal(boardView(b).view, 'offline');
  assert.equal(boardView(reduceBoard(b, ev('RevviewDataLock', { locked: true }))).view, 'insert-key');
  assert.equal(reduceBoard(b, ev('RevviewNetwork', { online: 'x' })), b);
});

test('MAX_SESSIONS drops the least recently touched', () => {
  const events = [];
  for (let i = 0; i < MAX_SESSIONS; i += 1) events.push(ev('UserPromptSubmit', { session_id: `s${i}` })); // all working
  events.push(ev('PreToolUse', { session_id: 's0', ...BASH, tool_use_id: 't0' })); // touches s0 (still working)
  events.push(ev('UserPromptSubmit', { session_id: 'new' }));
  const b = run(events);
  assert.equal(Object.keys(b.sessions).length, MAX_SESSIONS);
  assert.ok(!('s1' in b.sessions));
  assert.ok('s0' in b.sessions && 'new' in b.sessions);
});

test('the cap never drops a session at NEEDS PERMISSION, even the oldest', () => {
  const events = [
    ev('SessionStart', { session_id: 'P' }), ev('UserPromptSubmit', { session_id: 'P' }),
    ev('PermissionRequest', { session_id: 'P', tool_name: 'Bash', tool_input: { command: 'rm x' } }),
  ];
  for (let i = 0; i < MAX_SESSIONS; i += 1) events.push(ev('UserPromptSubmit', { session_id: `s${i}` }));
  const b = run(events);
  assert.ok('P' in b.sessions, 'permission session kept');
  assert.equal(Object.keys(b.sessions).length, MAX_SESSIONS);
  assert.ok(!('s0' in b.sessions), 'the oldest non-permission one went instead');
  assert.equal(boardView(b).view, 'permission');
});

test('the cap drops the session that needs the driver least first', () => {
  const events = [ev('SessionStart', { session_id: 'W' })]; // waiting, oldest
  events.push(ev('SessionStart', { session_id: 'D' }), ev('UserPromptSubmit', { session_id: 'D' }), ev('Stop', { session_id: 'D' }));
  for (let i = 0; i < MAX_SESSIONS - 2; i += 1) events.push(ev('UserPromptSubmit', { session_id: `s${i}` }));
  events.push(ev('UserPromptSubmit', { session_id: 'new' }));
  const b = run(events);
  assert.ok(!('D' in b.sessions), 'done goes before older waiting/working');
  assert.ok('W' in b.sessions && 'new' in b.sessions && 's0' in b.sessions);
});

test('when every other session needs permission the newcomer is admitted and the cap is exceeded', () => {
  const events = [];
  for (let i = 0; i < MAX_SESSIONS; i += 1) {
    const session_id = `p${i}`;
    events.push(ev('UserPromptSubmit', { session_id }), ev('PermissionRequest', { session_id, tool_name: 'Bash' }));
  }
  events.push(ev('UserPromptSubmit', { session_id: 'new' }));
  const b = run(events);
  assert.equal(Object.keys(b.sessions).length, MAX_SESSIONS + 1);
  assert.ok('new' in b.sessions);
  assert.equal(boardView(b).view, 'permission');
});

test('an event without session_id goes to the only live session; the anonymous bucket is never counted', () => {
  const b = run([ev('SessionStart', A), ev('UserPromptSubmit'), ev('PreToolUse', { ...BASH, tool_use_id: 't' })]);
  assert.deepEqual(Object.keys(b.sessions), ['A']);
  assert.equal(boardView(b).view, 'working');
  assert.equal(boardView(b).others, 0);
  // two live sessions: an id-less event cannot be placed, it goes to '' and is not an "other"
  const two = run([ev('SessionStart', A), ev('SessionStart', B), ev('Stop')]);
  assert.equal(boardView(two).others, 1);
  // QA round 2: a working session now takes the focus from an idle one, so the anonymous working one is shown
  // and the two real sessions are both "others" (was 1 under the old waiting > working priority)
  assert.equal(boardView(run([ev('SessionStart', A), ev('SessionStart', B), ev('UserPromptSubmit')])).others, 2);
  // id-less SessionEnd ends the only live session
  assert.equal(boardView(run([ev('SessionStart', A), ev('SessionEnd')])).view, 'ended');
});

test('a late PostToolUse of a diff tool that cannot be placed marks the diff as a lower bound', () => {
  const base = [ev('SessionStart', A), ev('UserPromptSubmit', A), ev('Stop', A)];
  const edit = { ...A, tool_name: 'Edit', tool_input: { old_string: 'a', new_string: 'b' } };
  const late = run([...base, ev('PostToolUse', edit)]);
  assert.equal(boardView(late).diffIncomplete, true);
  assert.equal(boardView(late).view, 'done');
  assert.deepEqual(boardView(late).diff, { added: 0, removed: 0 });
  assert.equal(boardView(run([...base, ev('PostToolUse', { ...edit, tool_use_id: 'zz' })])).diffIncomplete, true);
  // a tool that never counts a diff changes nothing; the next prompt resets the mark
  const bash = run([...base, ev('PostToolUse', { ...A, ...BASH })]);
  assert.equal(boardView(bash).diffIncomplete, false);
  assert.equal(boardView(run([...base, ev('PostToolUse', edit), ev('UserPromptSubmit', A)])).diffIncomplete, false);
});

test('ended ids are remembered for 256 sessions; beyond that a late event resurrects (documented limit)', () => {
  const events = [];
  for (let i = 0; i < 257; i += 1) events.push(ev('SessionStart', { session_id: `e${i}` }), ev('SessionEnd', { session_id: `e${i}` }));
  const b = run(events);
  assert.equal(b.ended.length, 256);
  assert.equal(Object.keys(run([ev('UserPromptSubmit', { session_id: 'e256' })], b).sessions).length, 0);
  assert.equal(Object.keys(run([ev('UserPromptSubmit', { session_id: 'e0' })], b).sessions).length, 1);
});

test('__proto__ and constructor session ids are safe', () => {
  const b = run([ev('SessionStart', { session_id: '__proto__' }), ev('UserPromptSubmit', { session_id: '__proto__' }),
    ev('SessionStart', { session_id: 'constructor' })]);
  assert.equal(Object.getPrototypeOf(b.sessions), Object.prototype);
  assert.equal({}.activity, undefined);
  assert.equal(Object.keys(b.sessions).length, 2);
  assert.equal(Object.hasOwn(b.sessions, '__proto__'), true);
  assert.equal(boardView(b).others, 1);
  const e = reduceBoard(b, ev('SessionEnd', { session_id: '__proto__' }));
  assert.equal(Object.keys(e.sessions).length, 1);
  assert.equal(Object.hasOwn(e.sessions, '__proto__'), false);
});

test('events without a usable session_id use one anonymous session', () => {
  assert.equal(view([ev('SessionStart'), ev('UserPromptSubmit', { session_id: 42 })]).view, 'working');
});

test('same reference for ignored events; no session for ignored events', () => {
  const b = run([ev('SessionStart', A)]);
  for (const e of [ev('SubagentStop', B), ev('Whatever', B), ev('PreCompact', A), null, 1, [], 'x', {}, { hook_event_name: 3 }]) {
    assert.equal(reduceBoard(b, e), b);
  }
  assert.equal(Object.keys(reduceBoard(b, ev('SubagentStop', B)).sessions).length, 1);
  assert.equal(reduceBoard(b, ev('SessionStart', A)), b);
});

test('never throws on garbage', () => {
  const junk = [null, undefined, 1, 'x', [], {}, { hook_event_name: 'SessionStart', session_id: {} },
    { hook_event_name: 'PreToolUse', session_id: ['a'], tool_use_id: 5, tool_name: 'Bash', tool_input: 5 },
    { hook_event_name: 'RevviewDropped', session_id: 7 }, { hook_event_name: 'SessionEnd', session_id: null }];
  for (const j of junk) {
    assert.doesNotThrow(() => reduceBoard(initialBoard(), j));
    assert.doesNotThrow(() => reduceBoard(j, ev('SessionStart', A)));
    assert.doesNotThrow(() => boardView(j));
  }
  assert.equal(reduceBoard('bad', ev('SessionStart', A)).sessions.A.state.activity, 'waiting');
  assert.equal(boardView(null).view, 'unknown');
});

test('replayView of every recording ends in ended', () => {
  const dir = new URL('../../fixtures/sessions/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    const events = fs.readFileSync(new URL(f, dir), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    const out = replayView(events);
    assert.equal(out.length, events.length);
    assert.equal(out.at(-1).view, 'ended', f);
  }
});

// Review findings on the board (late permission, idle during an open tool, unknown ids, malformed boards).
const PRE = (id) => ev('PreToolUse', { ...A, ...BASH, tool_use_id: id });
const POST = (id) => ev('PostToolUse', { ...A, ...BASH, tool_use_id: id, tool_response: { stdout: 'ok\n' } });

test('a permission event after Stop (late hook) does not bring NEEDS PERMISSION back', () => {
  const b = run([ev('SessionStart', A), ev('UserPromptSubmit', A), PRE('t1'), POST('t1'), ev('Stop', A)]);
  assert.equal(reduceBoard(b, ev('Notification', { ...A, notification_type: 'permission_prompt' })), b);
  assert.equal(reduceBoard(b, ev('PermissionRequest', { ...A, ...BASH })), b);
  // a new turn can still ask for permission
  const t = run([ev('UserPromptSubmit', A), PRE('t2'), ev('Notification', { ...A, notification_type: 'permission_prompt' })], b);
  assert.equal(boardView(t).view, 'permission');
});

test('idle_prompt while a tool is still open (unanswered prompt) does not freeze the turn at waiting', () => {
  const b = run([ev('SessionStart', A), ev('UserPromptSubmit', A), PRE('t1'),
    ev('Notification', { ...A, notification_type: 'permission_prompt' }),
    ev('Notification', { ...A, notification_type: 'idle_prompt' })]);
  // idle_prompt is only sent when no dialog is open (Claude Code 2.1.330: isDialogOnScreen, not loading), so a
  // main-thread prompt still pending was dismissed with Esc: the bar says waiting again
  assert.equal(boardView(b).view, 'waiting');
  assert.deepEqual(b.sessions.A.pending, []);
  assert.equal(boardView(reduceBoard(b, POST('t1'))).view, 'working');
});

test('waiting after Stop with no open tool still ignores late Posts and permission events', () => {
  const b = run([ev('SessionStart', A), ev('UserPromptSubmit', A), PRE('t1'), POST('t1'), ev('Stop', A),
    ev('Notification', { ...A, notification_type: 'idle_prompt' })]);
  assert.equal(boardView(b).view, 'waiting');
  assert.equal(reduceBoard(b, POST('t1')), b);
  assert.equal(reduceBoard(b, ev('Notification', { ...A, notification_type: 'permission_prompt' })), b);
});

test('an id-less RevviewDropped marks only sessions in a turn, else only the shown one (QA 11)', () => {
  // A works, B is waiting at its prompt, C is done: the lost Edit/Write can only come from A
  let b = run([ev('SessionStart', B), ev('SessionStart', { session_id: 'C' }), ev('UserPromptSubmit', { session_id: 'C' }),
    ev('Stop', { session_id: 'C' }), ev('SessionStart', A), ev('UserPromptSubmit', A)]);
  b = reduceBoard(b, ev('RevviewDropped'));
  assert.equal(b.sessions.A.dropped, true);
  assert.equal(b.sessions.B.dropped, false);
  assert.equal(b.sessions.C.dropped, false);
  // nobody in a turn: the shown (focus) session only, never nothing and never everyone
  let c = run([ev('SessionStart', B), ev('SessionStart', A), ev('UserPromptSubmit', A), ev('Stop', A)]);
  c = reduceBoard(c, ev('RevviewDropped'));
  assert.equal(c.sessions.A.dropped, true);
  assert.equal(c.sessions.B.dropped, false);
});

test('RevviewDropped with an id the board does not know marks nothing', () => {
  const b = run([ev('SessionStart', A), ev('UserPromptSubmit', A)]);
  assert.equal(reduceBoard(b, ev('RevviewDropped', { session_id: 'nobody' })), b);
});

test('SessionEnd without a session_id does not block later id-less events', () => {
  const b = run([ev('SessionStart'), ev('SessionEnd'), ev('UserPromptSubmit')]);
  assert.equal(boardView(b).view, 'working');
});

test('a malformed board is replaced, never throws', () => {
  const ctx = { repo: null, branch: null };
  const base = { phase: 'x', offline: false, locked: false, context: ctx, ended: [], tick: 0 };
  const bad = [
    { ...base, context: {}, sessions: { q: {} } },
    { ...base, sessions: { q: { state: null, open: [], touched: 1, dropped: false } } },
    { ...base, sessions: { q: { state: { activity: 'done', diff: { added: 0, removed: 0 } }, open: 'no', touched: 1, dropped: false } } },
  ];
  for (const b of bad) {
    assert.doesNotThrow(() => boardView(b));
    assert.equal(boardView(b).view, 'unknown');
    assert.doesNotThrow(() => reduceBoard(b, ev('SessionStart', A)));
    assert.equal(boardView(reduceBoard(b, ev('SessionStart', A))).view, 'waiting');
  }
});

test('RevviewInput sets buttons (null unknown, true, false); invalid or repeated values keep the reference', () => {
  const b0 = initialBoard();
  assert.equal(b0.buttons, null);
  assert.equal(boardView(b0).buttons, 'unknown');
  const up = reduceBoard(b0, ev('RevviewInput', { present: true }));
  assert.equal(up.buttons, true);
  assert.equal(boardView(up).buttons, 'present');
  assert.equal(reduceBoard(up, ev('RevviewInput', { present: true })), up);
  const down = reduceBoard(up, ev('RevviewInput', { present: false }));
  assert.equal(down.buttons, false);
  assert.equal(boardView(down).buttons, 'missing');
  assert.equal(reduceBoard(down, ev('RevviewInput', { present: false })), down);
  for (const present of ['true', 1, 0, null, undefined, {}, []]) {
    assert.equal(reduceBoard(down, ev('RevviewInput', { present })), down);
    assert.equal(reduceBoard(b0, ev('RevviewInput', { present })), b0);
  }
  assert.equal(reduceBoard(b0, ev('RevviewInput')), b0);
});

test('hardware presence survives RevviewStarting and shows with any shown session', () => {
  const b = run([ev('SessionStart', A), ev('RevviewInput', { present: false })]);
  assert.equal(boardView(b).buttons, 'missing');
  assert.equal(boardView(reduceBoard(b, ev('RevviewStarting'))).buttons, 'missing');
  assert.equal(reduceBoard(b, ev('RevviewStarting')).buttons, false);
  const c = run([ev('RevviewInput', { present: true }), ev('RevviewStarting'), ev('SessionStart', A)]);
  assert.equal(boardView(c).buttons, 'present');
});

test('RevviewButton gestures are ignored: same reference, no session', () => {
  const b0 = initialBoard();
  const g = ev('RevviewButton', { button: 'left', gesture: 'press' });
  assert.equal(reduceBoard(b0, g), b0);
  assert.equal(reduceBoard(b0, { ...g, session_id: 'A' }), b0);
  const b = run([ev('SessionStart', A), ev('UserPromptSubmit', A)]);
  assert.equal(reduceBoard(b, g), b);
  assert.equal(reduceBoard(b, { ...g, session_id: 'Z' }), b);
  assert.deepEqual(Object.keys(reduceBoard(b0, { ...g, session_id: 'Z' }).sessions), []);
  const up = reduceBoard(b0, ev('RevviewInput', { present: true }));
  assert.equal(reduceBoard(up, g), up);
});

test('a board with a bad buttons field is replaced', () => {
  const b = { ...initialBoard(), buttons: 'yes' };
  assert.equal(boardView(b).buttons, 'unknown');
  const noField = { ...initialBoard() };
  delete noField.buttons;
  assert.equal(boardView(noField).buttons, 'unknown');
  assert.equal(reduceBoard(b, ev('RevviewInput', { present: true })).buttons, true);
});

// QA round 2: focus, pending permission prompts per session, branch context, unseen SessionEnd.
const S = (id, cwd) => ({ session_id: id, cwd });
const start = (id, cwd) => [ev('SessionStart', S(id, cwd)), ev('UserPromptSubmit', S(id, cwd))];
const REV = '/home/user/src/revview';
const OTHER = '/home/user/src/other-project';

test('QA 01: a second, idle session does not hide the working one', () => {
  const b = run([
    ...start('aaaa-1111', REV),
    ev('PreToolUse', { ...S('aaaa-1111', REV), tool_name: 'Grep', tool_input: { pattern: 'listen' }, tool_use_id: 'a-s1', agent_id: 'agent-x1' }),
    ev('SessionStart', S('bbbb-2222', OTHER)),
  ]);
  const v = boardView(b);
  assert.equal(v.view, 'working');
  assert.equal(v.repo, 'revview');
  assert.equal(v.others, 1);
});

test('QA 01: the session the driver just spoke to is shown, not the idle ones', () => {
  const idle = { notification_type: 'idle_prompt' };
  const NOTES = '/home/user/src/notes';
  const b = run([
    ...start('A', REV), ev('Stop', S('A', REV)), ev('Notification', { ...S('A', REV), ...idle }),
    ...start('B', OTHER), ev('Stop', S('B', OTHER)), ev('Notification', { ...S('B', OTHER), ...idle }),
    ev('SessionStart', S('C', NOTES)), ev('UserPromptSubmit', { ...S('C', NOTES), prompt: 'summarise' }),
    ev('PreToolUse', { ...S('C', NOTES), tool_name: 'Write', tool_input: { file_path: `${NOTES}/summary.md`, content: 'x' }, tool_use_id: 'w1' }),
  ]);
  const v = boardView(b);
  assert.equal(v.view, 'working');
  assert.equal(v.file, 'summary.md');
  assert.equal(v.repo, 'notes');
  assert.equal(b.focus, 'C');
});

test('QA 04: two working sessions do not alternate on screen; focus follows the need', () => {
  let b = run([...start('A', REV), ...start('B', OTHER)]);
  const seen = new Set();
  for (let i = 0; i < 3; i += 1) {
    b = run([ev('PreToolUse', { ...S('A', REV), tool_name: 'Edit', tool_input: { file_path: `${REV}/a.js`, old_string: 'a', new_string: 'b' }, tool_use_id: `a${i}` })], b);
    seen.add(boardView(b).repo);
    b = run([ev('PreToolUse', { ...S('B', OTHER), tool_name: 'Bash', tool_input: { command: 'cargo build' }, tool_use_id: `b${i}` })], b);
    seen.add(boardView(b).repo);
  }
  assert.deepEqual([...seen], ['other-project']);
  // B finishes: a done focus stays until it goes idle
  b = run([ev('Stop', S('B', OTHER))], b);
  assert.equal(boardView(b).repo, 'other-project');
  b = run([ev('Notification', { ...S('B', OTHER), notification_type: 'idle_prompt' })], b);
  assert.equal(boardView(b).repo, 'revview');
  assert.equal(boardView(b).view, 'working');
  // A rests too: nobody is working, focus stays
  b = run([ev('Stop', S('A', REV)), ev('Notification', { ...S('A', REV), notification_type: 'idle_prompt' })], b);
  assert.equal(boardView(b).repo, 'revview');
  // B is prompted again: the driver spoke to it
  b = run([ev('UserPromptSubmit', S('B', OTHER))], b);
  assert.equal(boardView(b).repo, 'other-project');
});

const SUB = (id, name, extra) => ev(name, { ...S('k1', REV), agent_id: id, ...extra });
const psql = { tool_name: 'Bash', tool_input: { command: 'psql -f migrate.sql' } };
function qa02() {
  return run([
    ...start('k1', REV),
    ev('PreToolUse', { ...S('k1', REV), tool_name: 'Task', tool_use_id: 'T1' }),
    ev('PreToolUse', { ...S('k1', REV), tool_name: 'Task', tool_use_id: 'T2' }),
    SUB('agent-a1', 'PreToolUse', { ...psql, tool_use_id: 'b1' }),
    SUB('agent-a1', 'PermissionRequest', psql),
    ev('Notification', { ...S('k1', REV), notification_type: 'permission_prompt' }),
    SUB('agent-a2', 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: `${REV}/docs/DESIGN.md` }, tool_use_id: 'r1' }),
    SUB('agent-a2', 'PreToolUse', { tool_name: 'Edit', tool_input: { file_path: `${REV}/x.js`, old_string: 'a', new_string: 'b' }, tool_use_id: 'e1' }),
  ]);
}

test('QA 02: a subagent permission prompt stays while a parallel subagent works, until it is answered', () => {
  const b = qa02();
  assert.equal(b.sessions.k1.pending.length, 1);
  assert.equal(b.sessions.k1.pending[0].tuid, 'b1');
  assert.equal(b.sessions.k1.state.activity, 'working');
  const v = boardView(b);
  assert.equal(v.view, 'permission');
  assert.equal(v.activity, 'permission');
  assert.equal(v.command, 'psql -f migrate.sql');
  assert.equal(v.tool, 'Bash');
  const ok = reduceBoard(b, SUB('agent-a1', 'PostToolUse', { ...psql, tool_use_id: 'b1', tool_response: { stdout: 'done' } }));
  assert.equal(boardView(ok).view, 'working');
  assert.deepEqual(ok.sessions.k1.pending, []);
});

test('QA 02: the prompt is also answered by PermissionDenied or PostToolUseFailure with the tool_use_id', () => {
  const b = qa02();
  assert.equal(boardView(reduceBoard(b, SUB('agent-a1', 'PermissionDenied', { ...psql, tool_use_id: 'b1' }))).view, 'working');
  assert.equal(boardView(reduceBoard(b, SUB('agent-a1', 'PostToolUseFailure', { ...psql, tool_use_id: 'b1', error: 'x' }))).view, 'working');
  // another agent's Post does not answer it
  assert.equal(boardView(reduceBoard(b, SUB('agent-a2', 'PostToolUse', { tool_name: 'Read', tool_use_id: 'r1' }))).view, 'permission');
});

test('QA 02: SubagentStop clears the prompt of that subagent', () => {
  const b = qa02();
  const e = reduceBoard(b, SUB('agent-a1', 'SubagentStop', {}));
  assert.notEqual(e, b);
  assert.equal(boardView(e).view, 'working');
  assert.equal(e.sessions.k1.pre.some((p) => p.agent === 'agent-a1'), false);
  assert.equal(reduceBoard(e, SUB('agent-a1', 'SubagentStop', {})), e);
});

test('QA 02: main Stop keeps a prompt of a subagent still listed as running, clears it otherwise', () => {
  const b = qa02();
  const running = reduceBoard(b, ev('Stop', { ...S('k1', REV), background_tasks: [{ id: 'agent-a1', type: 'subagent', status: 'running' }] }));
  assert.equal(boardView(running).view, 'permission');
  const none = reduceBoard(b, ev('Stop', { ...S('k1', REV), background_tasks: [] }));
  assert.equal(boardView(none).view, 'done');
  // without a background_tasks list no subagent runs (as reducer.js): its prompt is cleared too
  const noList = reduceBoard(b, ev('Stop', S('k1', REV)));
  assert.equal(boardView(noList).view, 'done');
  assert.deepEqual(noList.sessions.k1.pending, []);
});

test('QA 02: a main-thread prompt is cleared by the next driver prompt, not by a task-notification', () => {
  const b = run([...start('A', REV), ev('PreToolUse', { ...S('A', REV), ...BASH, tool_use_id: 't1' }),
    ev('PermissionRequest', { ...S('A', REV), ...BASH })]);
  assert.equal(boardView(b).view, 'permission');
  assert.equal(b.sessions.A.pending[0].tuid, 't1');
  const inj = reduceBoard(b, ev('UserPromptSubmit', { ...S('A', REV), prompt: '<task-notification>\n<task-id>x</task-id>' }));
  assert.equal(boardView(inj).view, 'permission');
  const drv = reduceBoard(b, ev('UserPromptSubmit', { ...S('A', REV), prompt: 'next' }));
  assert.equal(boardView(drv).view, 'working');
  assert.deepEqual(drv.sessions.A.pending, []);
});

test('QA 02: a late permission_prompt Notification while a prompt is pending changes nothing; PermissionRequest twice neither', () => {
  const b = qa02();
  assert.equal(reduceBoard(b, ev('Notification', { ...S('k1', REV), notification_type: 'permission_prompt' })), b);
  assert.equal(reduceBoard(b, SUB('agent-a1', 'PermissionRequest', psql)), b);
});

test('QA 02: a subagent PermissionRequest after the main Stop is not late', () => {
  const b = run([...start('k1', REV), SUB('agent-a1', 'PreToolUse', { ...psql, tool_use_id: 'b1' }),
    ev('Stop', { ...S('k1', REV), background_tasks: [{ id: 'agent-a1', type: 'subagent', status: 'running' }] }),
    SUB('agent-a1', 'PermissionRequest', psql)]);
  assert.equal(boardView(b).view, 'permission');
});

test('a permission in session B while A is focus pre-empts; after it is answered the bar returns to A, the one spoken to', () => {
  let b = run([...start('A', REV), ...start('B', OTHER)]);
  b = run([ev('UserPromptSubmit', S('A', REV))], b);
  assert.equal(b.focus, 'A');
  b = run([ev('PreToolUse', { ...S('B', OTHER), ...BASH, tool_use_id: 'x1' }), ev('PermissionRequest', { ...S('B', OTHER), ...BASH })], b);
  assert.equal(b.focus, 'B');
  assert.equal(boardView(b).view, 'permission');
  assert.equal(boardView(b).repo, 'other-project');
  b = run([ev('PostToolUse', { ...S('B', OTHER), ...BASH, tool_use_id: 'x1' })], b);
  assert.equal(b.focus, 'A');
  assert.equal(boardView(b).view, 'working');
});

const ask = (id, cwd, tuid, extra = BASH) => [ev('PreToolUse', { ...S(id, cwd), ...extra, tool_use_id: tuid }), ev('PermissionRequest', { ...S(id, cwd), ...extra })];

test('after a prompt is answered the bar goes back to the session the driver last spoke to', () => {
  let b = run([ev('SessionStart', S('A', REV)), ev('SessionStart', S('B', OTHER)),
    ev('UserPromptSubmit', S('A', REV)), ev('UserPromptSubmit', S('B', OTHER))]);
  assert.equal(b.focus, 'B');
  b = run(ask('A', REV, 'a1'), b);
  assert.equal(b.focus, 'A');
  assert.equal(boardView(b).view, 'permission');
  b = run([ev('PostToolUse', { ...S('A', REV), ...BASH, tool_use_id: 'a1' }), ev('Stop', S('A', REV))], b);
  assert.equal(b.focus, 'B');
  assert.equal(boardView(b).repo, 'other-project');
  assert.equal(boardView(b).view, 'working');
});

test('A keeps working after approval: the bar is back on B, and A events do not move it', () => {
  let b = run([ev('SessionStart', S('A', REV)), ev('SessionStart', S('B', OTHER)),
    ev('UserPromptSubmit', S('A', REV)), ev('UserPromptSubmit', S('B', OTHER)), ...ask('A', REV, 'a1')]);
  b = run([ev('PostToolUse', { ...S('A', REV), ...BASH, tool_use_id: 'a1' })], b);
  assert.equal(b.focus, 'B');
  b = run([ev('PreToolUse', { ...S('A', REV), tool_name: 'Read', tool_input: {}, tool_use_id: 'a2' })], b);
  assert.equal(b.focus, 'B');
});

test('an injected task-notification prompt does not change who the driver spoke to', () => {
  let b = run([ev('SessionStart', S('A', REV)), ev('SessionStart', S('B', OTHER)),
    ev('UserPromptSubmit', S('A', REV)), ev('UserPromptSubmit', S('B', OTHER))]);
  b = run([ev('UserPromptSubmit', { ...S('A', REV), prompt: '<task-notification>\n<task-id>x</task-id>' })], b);
  assert.equal(b.spokenTo, 'B');
  b = run(ask('A', REV, 'a1'), b);
  b = run([ev('PostToolUse', { ...S('A', REV), ...BASH, tool_use_id: 'a1' })], b);
  assert.equal(b.focus, 'B');
});

test('a spoken-to session that ended is not restored', () => {
  let b = run([ev('SessionStart', S('A', REV)), ev('SessionStart', S('B', OTHER)),
    ev('UserPromptSubmit', S('A', REV)), ev('UserPromptSubmit', S('B', OTHER)), ...ask('A', REV, 'a1')]);
  b = run([ev('SessionEnd', S('B', OTHER)), ev('PostToolUse', { ...S('A', REV), ...BASH, tool_use_id: 'a1' })], b);
  assert.equal(b.focus, 'A');
  assert.equal(b.spokenTo, null);
});

test('a subagent prompt is cleared by a Stop without a background_tasks list', () => {
  const sub = (name, x) => ev(name, { ...S('k1', REV), agent_id: 'ag1', ...x });
  const b = run([...start('k1', REV), sub('PreToolUse', { ...BASH, tool_use_id: 's1' }), sub('PermissionRequest', BASH)]);
  assert.equal(boardView(b).view, 'permission');
  assert.notEqual(boardView(reduceBoard(b, ev('Stop', S('k1', REV)))).view, 'permission');
});

test('a prompt is tied to the one open call that fits, never to the wrong one', () => {
  const rm = { tool_name: 'Bash', tool_input: { command: 'rm x' } };
  const ls = { tool_name: 'Bash', tool_input: { command: 'ls' } };
  const base = [...start('A', REV), ev('PreToolUse', { ...S('A', REV), ...rm, tool_use_id: 't2' }),
    ev('PreToolUse', { ...S('A', REV), ...ls, tool_use_id: 't1' })];
  let b = run([...base, ev('PermissionRequest', { ...S('A', REV), ...rm })]);
  assert.equal(b.sessions.A.pending[0].tuid, 't2');
  // the other call finishing does not answer it
  b = run([ev('PostToolUse', { ...S('A', REV), ...ls, tool_use_id: 't1' })], b);
  assert.equal(boardView(b).view, 'permission');
  assert.equal(boardView(run([ev('PostToolUse', { ...S('A', REV), ...rm, tool_use_id: 't2' })], b)).view, 'working');
  // two open calls that both fit (no input on the request): no id, so another call's Post cannot clear it
  const amb = run([...base, ev('PermissionRequest', { ...S('A', REV), tool_name: 'Bash' })]);
  assert.equal(amb.sessions.A.pending[0].tuid, null);
});

test('the cap does not drop the focus session when another victim exists', () => {
  // F is the focus and the least recently touched working session; the older-need rule alone would drop it
  const events = [ev('UserPromptSubmit', { session_id: 'F' })];
  for (let i = 0; i < MAX_SESSIONS - 1; i += 1) events.push(ev('SessionStart', { session_id: `s${i}` })); // waiting
  const b0 = run(events);
  assert.equal(b0.focus, 'F');
  assert.equal(Object.keys(b0.sessions).length, MAX_SESSIONS);
  // a newcomer that waits: the victim is among the waiting ones (need 3) only if F is protected; F is working (need 2)
  const b = reduceBoard(b0, ev('SessionStart', { session_id: 'new' }));
  assert.ok('F' in b.sessions, 'focus kept');
  assert.ok(!('s0' in b.sessions));
});

test('QA 05: the branch of an ended session in another repo is not shown', () => {
  const o = { session_id: 'B', cwd: OTHER };
  let b = run([
    ev('SessionStart', S('A', REV)), ev('RevviewContext', { ...S('A', REV), branch: 'fix/refund-flow' }),
    ev('SessionEnd', S('A', REV)), ev('RevviewStarting'), ev('SessionStart', o),
  ]);
  assert.equal(boardView(b).repo, 'other-project');
  assert.equal(boardView(b).branch, null);
  b = run([ev('UserPromptSubmit', { ...o, prompt: 'x' })], b);
  assert.equal(boardView(b).branch, null);
  // a session-less context for the same repo still gives the session the branch
  b = run([ev('RevviewContext', { cwd: OTHER, branch: 'dev' })], b);
  assert.equal(boardView(b).branch, 'dev');
});

test('QA 07: a SessionEnd of a session the board never saw does not claim that Claude exited', () => {
  const u = run([ev('SessionEnd', S('u1', REV))]);
  assert.equal(boardView(u).view, 'unknown');
  assert.deepEqual(u.ended, ['u1']);
  const s = run([ev('RevviewStarting'), ev('SessionEnd', S('zz', REV))]);
  assert.equal(boardView(s).view, 'starting');
  assert.equal(reduceBoard(s, ev('SessionEnd', S('zz', REV))), s);
  assert.equal(boardView(run([ev('SessionStart', A), ev('SessionEnd', A)])).view, 'ended');
});
