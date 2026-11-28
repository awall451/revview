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

test('without a clock a TaskCreate after an all-completed list continues the list; a restart at "1" is not guessed', () => {
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

// fixtures/sessions/task-progress (README there): real sessions, replayed with the recorded times where there are any
const REC = (f) => new URL(`../../fixtures/sessions/task-progress/${f}`, import.meta.url);
const lines = (f) => fs.readFileSync(REC(f), 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
// the distinct tasks values of the replay, and the value right after each PostToolUse of TaskCreate
function replay(name, timed) {
  const evs = lines(`${name}.jsonl`);
  const ms = timed ? lines(`${name}.times.jsonl`).map((t) => t.ms) : null;
  if (ms) assert.equal(ms.length, evs.length);
  let b = initialBoard();
  const seen = [];
  const afterCreate = [];
  evs.forEach((e, i) => {
    b = ms ? reduceBoard(b, e, 1_800_000_000_000 + ms[i]) : reduceBoard(b, e);
    const t = tasks(b);
    const k = t === null ? 'null' : `${t.done}/${t.total}`;
    if (seen.at(-1) !== k) seen.push(k);
    if (e.hook_event_name === 'PostToolUse' && e.tool_name === 'TaskCreate') afterCreate.push(k);
  });
  return { seen, afterCreate };
}

test('recorded: a list across /compact (SessionStart compact) keeps its count, the same ids go on', () => {
  const { seen } = replay('compact-haiku', false);
  assert.deepEqual(seen, ['null', '0/1', '0/2', '0/3', '1/3', '2/3', '3/3', 'null']); // the session's end removes it
});

test('recorded: a deleted task leaves the total (2/2 as on Claude\'s screen); a second list after 12 s starts at 0/1', () => {
  const { seen, afterCreate } = replay('delete-two-lists-haiku', true);
  assert.deepEqual(seen, ['null', '0/1', '0/2', '0/3', '0/2', '1/2', '2/2', '0/1', '0/2', '1/2', '2/2', 'null']);
  assert.deepEqual(afterCreate, ['0/1', '0/2', '0/3', '0/1', '0/2']);
  // the sonnet recording (no times): the delete is the same; without a clock the second list continues (running total)
  const s = replay('delete-two-lists-sonnet', false);
  assert.deepEqual(s.seen, ['null', '0/1', '0/2', '0/3', '0/2', '1/2', '2/2', '2/3', '2/4', '3/4', '4/4', 'null']);
});

test('recorded: a task added 0.2 s after the last completion joins the list (3/3); one added a turn later starts anew (1/1)', () => {
  for (const name of ['add-after-done-haiku', 'add-after-done-sonnet']) {
    const { seen, afterCreate } = replay(name, true);
    assert.deepEqual(seen, ['null', '0/1', '0/2', '1/2', '2/2', '2/3', '3/3', '0/1', '1/1', 'null'], name);
    assert.deepEqual(afterCreate, ['0/1', '0/2', '2/3', '0/1'], name);
  }
});

test('recorded without CLAUDE_CODE_ENABLE_TODO_TOOLS (haiku and sonnet 5.5): no task tool, no list', () => {
  for (const name of ['no-switch-haiku', 'no-switch-sonnet']) {
    const evs = lines(`${name}.jsonl`);
    assert.equal(evs.some((e) => /^Task(Create|Update)$/.test(e.tool_name ?? '') || e.hook_event_name === 'TaskCreated'), false, name);
    assert.deepEqual(replay(name, false).seen, ['null'], name);
  }
});

test('the 5 s rule: a create 4.999 s after the list became all completed continues it, at 5 s it starts a new list', () => {
  const t0 = 1_000_000;
  const done = [[create('1'), t0], [create('2'), t0 + 10], [update('1', 'completed'), t0 + 20], [update('2', 'completed'), t0 + 30]];
  const base = done.reduce((x, [e, at]) => reduceBoard(x, e, at), initialBoard());
  assert.deepEqual(tasks(base), { done: 2, total: 2 });
  assert.deepEqual(tasks(reduceBoard(base, create('3'), t0 + 30 + 4999)), { done: 2, total: 3 });
  assert.deepEqual(tasks(reduceBoard(base, create('3'), t0 + 30 + 5000)), { done: 0, total: 1 });
  // the time counts from the moment the whole list became completed, not from later events
  const later = reduceBoard(base, update('2', 'completed'), t0 + 4000);
  assert.deepEqual(tasks(reduceBoard(later, create('3'), t0 + 30 + 5000)), { done: 0, total: 1 });
  const del = reduceBoard(base, update('1', 'deleted'), t0 + 4000);
  assert.deepEqual(tasks(del), { done: 1, total: 1 });
  assert.deepEqual(tasks(reduceBoard(del, create('3'), t0 + 30 + 5000)), { done: 0, total: 1 });
  // a list with work left never restarts, however long it waits
  const open = reduceBoard(base, create('3'), t0 + 100);
  assert.deepEqual(tasks(reduceBoard(open, create('4'), t0 + 60_000)), { done: 2, total: 4 });
  // a reopened task clears the mark: the list is not all completed any more
  const re = reduceBoard(reduceBoard(base, update('2', 'in_progress'), t0 + 1000), update('2', 'completed'), t0 + 9000);
  assert.deepEqual(tasks(reduceBoard(re, create('3'), t0 + 13_000)), { done: 2, total: 3 });
  assert.deepEqual(tasks(reduceBoard(re, create('3'), t0 + 14_000)), { done: 0, total: 1 });
  // a jump (not the next id) is still partial, also after the 5 s
  assert.equal(tasks(reduceBoard(base, create('5'), t0 + 60_000)), null);
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
