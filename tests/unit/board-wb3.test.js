import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  initialBoard, reduceBoard, boardView, pendingPrompts, shownPrompt,
} from '../../src/state/index.js';

const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const load = (f) => fs.readFileSync(new URL(`../../fixtures/${f}`, import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const A = { session_id: 'A', cwd: '/w/alpha' };
const B = { session_id: 'B', cwd: '/w/beta' };
const BASH = { tool_name: 'Bash', tool_input: { command: 'npm test' } };
const INT = (id) => ev('RevviewInterrupted', { session_id: id });
const asking = (S, tuid = 't1') => [
  ev('SessionStart', S), ev('UserPromptSubmit', S),
  ev('PreToolUse', { ...S, ...BASH, tool_use_id: tuid }), ev('PermissionRequest', { ...S, ...BASH, tool_use_id: tuid }),
];

test('Esc recording: interrupt after PreToolUse -> waiting, history kept', () => {
  const events = load('buttons/events-a-esc.jsonl');
  const idx = events.findIndex((e) => e.hook_event_name === 'PreToolUse');
  const b = run(events.slice(0, idx + 1));
  assert.equal(boardView(b).view, 'working');
  const after = reduceBoard(b, INT(events[0].session_id));
  const v = boardView(after);
  assert.equal(v.view, 'waiting');
  assert.equal(v.activity, 'waiting');
  assert.equal(v.tool, 'Bash');
  assert.ok(v.command);
  assert.equal(after.sessions[events[0].session_id].open.length, 0);
});

test('Ctrl+C recording: interrupt -> waiting', () => {
  const events = load('buttons/events-b-ctrlc-once.jsonl');
  const b = run(events);
  assert.equal(boardView(b).view, 'working');
  const v = boardView(reduceBoard(b, INT(events[0].session_id)));
  assert.equal(v.view, 'waiting');
  assert.equal(v.activity, 'waiting');
});

test('interrupt on a permission prompt rejects it', () => {
  const b = run(asking(A));
  assert.equal(boardView(b).view, 'permission');
  assert.notEqual(shownPrompt(b), null);
  const after = reduceBoard(b, INT('A'));
  assert.deepEqual(pendingPrompts(after), []);
  assert.equal(boardView(after).view, 'waiting');
  assert.equal(shownPrompt(after), null);
  assert.deepEqual(after.sessions.A.pre, []);
});

test('interrupt keeps locked / offline overlays', () => {
  const w = run([ev('SessionStart', A), ev('UserPromptSubmit', A), ev('RevviewDataLock', { locked: true })]);
  assert.equal(boardView(reduceBoard(w, INT('A'))).view, 'insert-key');
  const o = run([ev('SessionStart', A), ev('UserPromptSubmit', A), ev('RevviewNetwork', { online: false })]);
  assert.equal(boardView(reduceBoard(o, INT('A'))).view, 'offline');
  assert.equal(boardView(reduceBoard(o, INT('A'))).activity, 'waiting');
});

test('same reference for done / waiting / unknown / missing session', () => {
  const done = run([ev('SessionStart', A), ev('UserPromptSubmit', A), ev('Stop', A)]);
  assert.equal(boardView(done).view, 'done');
  assert.equal(reduceBoard(done, INT('A')), done);
  const waiting = run([ev('SessionStart', A)]);
  assert.equal(reduceBoard(waiting, INT('A')), waiting);
  const working = run([ev('SessionStart', A), ev('UserPromptSubmit', A)]);
  assert.equal(reduceBoard(working, INT('nope')), working);
  assert.equal(reduceBoard(working, ev('RevviewInterrupted')), working);
  const empty = initialBoard();
  assert.equal(reduceBoard(empty, INT('A')), empty);
});

test('two sessions: only the interrupted one changes', () => {
  const b = run([ev('SessionStart', A), ev('UserPromptSubmit', A), ev('SessionStart', B), ev('UserPromptSubmit', B)]);
  const after = reduceBoard(b, INT('A'));
  assert.equal(after.sessions.A.state.activity, 'waiting');
  assert.equal(after.sessions.B, b.sessions.B);
});

test('shownPrompt: main-thread recording', () => {
  const events = load('sessions/permission-prompt.jsonl');
  const i = events.findIndex((e) => e.hook_event_name === 'PermissionRequest');
  const p = shownPrompt(run(events.slice(0, i + 1)));
  assert.equal(p.session, events[0].session_id);
  assert.equal(p.agent, '');
  assert.equal(p.tool, 'Bash');
  assert.equal(typeof p.since, 'number');
  assert.ok(p.command);
  assert.deepEqual(Object.keys(p).sort(), ['agent', 'command', 'file', 'session', 'since', 'tool']);
});

test('shownPrompt: subagent recording carries the agent id', () => {
  const events = load('sessions/subagent-permission.jsonl');
  const i = events.findIndex((e) => e.hook_event_name === 'PermissionRequest');
  const p = shownPrompt(run(events.slice(0, i + 1)));
  assert.equal(p.agent, 'aaaa70734bf4ef278');
  assert.equal(p.tool, 'Bash');
});

test('shownPrompt: null when locked, still shown when offline', () => {
  const b = run(asking(A));
  assert.equal(shownPrompt(reduceBoard(b, ev('RevviewDataLock', { locked: true }))), null);
  const off = reduceBoard(b, ev('RevviewNetwork', { online: false }));
  assert.equal(boardView(off).view, 'permission');
  assert.equal(shownPrompt(off).session, 'A');
  assert.equal(shownPrompt(initialBoard()), null);
});

test('shownPrompt follows the session boardView shows; pendingPrompts lists all', () => {
  const b = run([...asking(A, 'a1'), ...asking(B, 'b1')]);
  const all = pendingPrompts(b);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((p) => p.session).sort(), ['A', 'B']);
  assert.notEqual(all[0].since, all[1].since);
  assert.equal(boardView(b).view, 'permission');
  const p = shownPrompt(b);
  assert.equal(p.session, b.focus);
  assert.equal(p.since, b.sessions[b.focus].pending[0].since);
  // a generic notification entry has agent null
  const n = run([ev('SessionStart', A), ev('UserPromptSubmit', A), ev('Notification', { ...A, notification_type: 'permission_prompt' })]);
  assert.equal(pendingPrompts(n)[0].agent, null);
});

test('RevviewInterrupted never creates a session', () => {
  assert.deepEqual(reduceBoard(initialBoard(), INT('ghost')).sessions, {});
});

const ANS = (id, p, decision = 'allow') => ev('RevviewAnswered', { session_id: id, agent: p.agent, since: p.since, decision });
const SUBREQ = (S) => ev('PermissionRequest', { ...S, agent_id: 'sub1', tool_name: 'Bash', tool_input: { command: 'ls' } });

test('RevviewAnswered clears exactly the answered prompt: main and subagent in one session', () => {
  const b = run([...asking(A), SUBREQ(A)]);
  const [main, sub] = pendingPrompts(b);
  assert.equal(main.agent, '');
  assert.equal(sub.agent, 'sub1');
  const one = reduceBoard(b, ANS('A', main));
  assert.deepEqual(pendingPrompts(one).map((p) => p.agent), ['sub1']);
  assert.equal(boardView(one).view, 'permission');
  assert.equal(shownPrompt(one).agent, 'sub1');
  const none = reduceBoard(one, ANS('A', sub, 'deny'));
  assert.equal(pendingPrompts(none).length, 0);
  assert.equal(boardView(none).view, 'working'); // allow or deny: working until the next hook (PostToolUse, Stop)
  const other = reduceBoard(b, ANS('A', sub));
  assert.deepEqual(pendingPrompts(other).map((p) => p.agent), ['']);
});

test('RevviewAnswered with another since, agent or session changes nothing and creates nothing', () => {
  const b = run([...asking(A), ...asking(B, 'b1')]);
  const p = pendingPrompts(b).find((x) => x.session === 'A');
  assert.equal(reduceBoard(b, ANS('A', { ...p, since: p.since + 100 })), b);
  assert.equal(reduceBoard(b, ANS('A', { ...p, agent: 'sub1' })), b);
  assert.equal(reduceBoard(b, ANS('B', p)), b); // A's since in B's session
  assert.equal(reduceBoard(b, ANS('ghost', p)), b);
  assert.equal(reduceBoard(b, ev('RevviewAnswered', { session_id: 'A' })), b);
  assert.deepEqual(Object.keys(reduceBoard(initialBoard(), ANS('ghost', p)).sessions), []);
});
