import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initialBoard, reduceBoard, boardView } from '../../src/state/index.js';

const A = { session_id: 'A', cwd: '/w/alpha' };
let n = 0;
const post = (tool_name, tool_input, tool_response, extra = {}) => ({ hook_event_name: 'PostToolUse', ...A, tool_name, tool_input, tool_response, tool_use_id: `u${n++}`, ...extra });
const create = (id, extra) => post('TaskCreate', { subject: 's' }, { task: { id, subject: 's' } }, extra);
const update = (id, status, extra) => post('TaskUpdate', { taskId: id, status }, { success: true, taskId: id, statusChange: { to: status } }, extra);
const run = (evs, b = initialBoard()) => evs.reduce((x, e) => reduceBoard(x, e), b);
const tasks = (b) => boardView(b).tasks;

test('the recorded task list goes null, 0/1 .. 0/4, 1/4 .. 4/4', () => {
  const evs = fs.readFileSync(new URL('../../fixtures/sessions/task-list.jsonl', import.meta.url), 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
  let b = initialBoard();
  const seen = [];
  for (const e of evs) {
    b = reduceBoard(b, e);
    const t = tasks(b);
    const k = t === null ? 'null' : `${t.done}/${t.total}`;
    if (seen.at(-1) !== k) seen.push(k);
  }
  assert.equal(seen[0], 'null');
  for (const k of ['0/1', '0/2', '0/3', '0/4', '1/4', '2/4', '3/4', '4/4']) assert.ok(seen.includes(k), k);
  assert.equal(seen.filter((k) => k !== 'null').at(-1), '4/4'); // (the session's end then removes the list)
});

test('status comes from statusChange.to, else tool_input.status; deleted removes; unknown status ignored', () => {
  let b = run([create('1'), create('2'), create(3)]);
  assert.deepEqual(tasks(b), { done: 0, total: 3 });
  b = run([post('TaskUpdate', { taskId: '1', status: 'pending' }, { statusChange: { to: 'completed' } })], b);
  assert.deepEqual(tasks(b), { done: 1, total: 3 });
  b = run([post('TaskUpdate', { taskId: '2', status: 'completed' }, { success: true })], b);
  assert.deepEqual(tasks(b), { done: 2, total: 3 });
  const same = run([update('3', 'weird')], b);
  assert.deepEqual(tasks(same), { done: 2, total: 3 });
  b = run([update('3', 'deleted')], b);
  assert.deepEqual(tasks(b), { done: 2, total: 2 });
});

test('an update for an id never created marks the list partial: tasks null, also with no valid status', () => {
  let b = run([update('7', 'in_progress')]);
  assert.equal(tasks(b), null);
  b = run([create('8')], b);
  assert.equal(tasks(b), null);
  b = run([update('7', 'completed'), update('8', 'completed'), create('9')], b);
  assert.equal(tasks(b), null); // partial stays until SessionStart
  for (const st of ['weird', undefined, 'deleted']) {
    const x = run([create('1'), update('5', st)]);
    assert.equal(tasks(x), null, String(st));
  }
  assert.deepEqual(tasks(run([create('1'), update('1', 'weird')])), { done: 0, total: 1 });
});

test('a server restart mid-list: the first create seen is not "1", so nothing is shown (not 0/1)', () => {
  let b = run([create('4')]);
  assert.equal(tasks(b), null);
  b = run([create('5'), update('4', 'completed')], b);
  assert.equal(tasks(b), null);
  assert.equal(tasks(run([create(4)])), null);
  assert.equal(tasks(run([create('abc')])), null);
});

test('ids must be sequential: a gap or a jump makes the list partial; a deleted id still counts as used', () => {
  assert.equal(tasks(run([create('1'), create('3')])), null);
  assert.equal(tasks(run([create('1'), create('2'), create('2'), create('3')])).total, 3);
  const b = run([create('1'), create('2'), create('3'), update('3', 'deleted'), create('4')]);
  assert.deepEqual(tasks(b), { done: 0, total: 3 });
});

test('a TaskCreate after an all-completed list continues the list (no recording backs a "new list" reset)', () => {
  let b = run([create('1'), create('2'), update('1', 'completed'), update('2', 'completed')]);
  assert.deepEqual(tasks(b), { done: 2, total: 2 });
  b = run([create('3')], b);
  assert.deepEqual(tasks(b), { done: 2, total: 3 });
  b = run([update('3', 'completed')], b);
  assert.deepEqual(tasks(b), { done: 3, total: 3 });
  // a create that starts over at "1" is a duplicate id: ignored, the list is not guessed
  assert.deepEqual(tasks(run([create('4')], b)), { done: 3, total: 4 });
  assert.deepEqual(tasks(run([create('1')], b)), { done: 3, total: 3 });
});

test('subagent events (agent_id) are ignored for tasks', () => {
  let b = run([create('1')]);
  b = run([create('2', { agent_id: 'sub1' }), update('1', 'completed', { agent_id: 'sub1' })], b);
  assert.deepEqual(tasks(b), { done: 0, total: 1 });
});

test('SessionStart clears the list, except source compact', () => {
  let b = run([create('1')]);
  b = run([{ hook_event_name: 'SessionStart', ...A, source: 'compact' }], b);
  assert.deepEqual(tasks(b), { done: 0, total: 1 });
  b = run([{ hook_event_name: 'SessionStart', ...A, source: 'clear' }], b);
  assert.equal(tasks(b), null);
});

test('a duplicate create does not double count; the cap marks the list partial', () => {
  let b = run([create('1'), create('1')]);
  assert.deepEqual(tasks(b), { done: 0, total: 1 });
  b = run(Array.from({ length: 201 }, (_, i) => create(String(i + 10))), b);
  assert.equal(tasks(b), null);
  assert.equal(Object.keys(b.sessions.A.tasks.ids).length, 200);
});

test('ids: numbers become strings, long ids are refused', () => {
  const b = run([create(1), update('1', 'completed')]);
  assert.deepEqual(tasks(b), { done: 1, total: 1 });
  assert.equal(tasks(run([create('x'.repeat(65))])), null);
});
