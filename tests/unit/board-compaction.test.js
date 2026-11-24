// The per-session "compacting" mark: PreCompact sets it, the next Claude hook event (but the summariser's own
// SubagentStop) clears it, a limit timer bounds a lost end event. Recording: fixtures/sessions/compaction.jsonl.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initialBoard, reduceBoard, boardView, replayView, initialState, reduce } from '../../src/state/index.js';
import { startLiveServer } from '../../src/server/index.js';

const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const A = '11111111-1111-4111-8111-111111111111';
const fold = (b, ...events) => events.reduce((x, e) => reduceBoard(x, e), b);
const events = fs.readFileSync(new URL('../../fixtures/sessions/compaction.jsonl', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));

test('compaction.jsonl: the mark follows PreCompact and ends with the next event', () => {
  const v = replayView(events, initialBoard());
  const on = [4, 7, 8, 13, 14, 19, 20, 26];
  v.forEach((s, i) => assert.equal(s.compacting, on.includes(i), `after event ${i} (${events[i].hook_event_name})`));
  assert.equal(v[8].view, 'working'); // SubagentStop of the summariser keeps the mark
  assert.equal(v[19].view, 'done'); // /compact at the prompt keeps DONE
  assert.equal(v[26].view, 'working');
  assert.equal(v[27].view, 'done');
});

test('a PreCompact while a permission prompt is pending shows no compacting', () => {
  const b = fold(initialBoard(), ev('SessionStart', { session_id: A, cwd: '/w/a' }), ev('UserPromptSubmit', { session_id: A }),
    ev('PermissionRequest', { session_id: A, tool_name: 'Bash', tool_input: { command: 'ls' } }), ev('PreCompact', { session_id: A, trigger: 'auto' }));
  assert.equal(boardView(b).view, 'permission');
  assert.equal(boardView(b).compacting, false);
});

test('no session: compacting false; a PreCompact of an unknown session changes nothing', () => {
  const b = initialBoard();
  assert.equal(boardView(b).compacting, false);
  assert.equal(reduceBoard(b, ev('PreCompact', { session_id: A })), b);
});

test('RevviewCompactExpired clears the mark; elsewhere it returns the same board', () => {
  const b = fold(initialBoard(), ev('SessionStart', { session_id: A }), ev('UserPromptSubmit', { session_id: A }), ev('PreCompact', { session_id: A }));
  assert.equal(boardView(b).compacting, true);
  const c = reduceBoard(b, ev('RevviewCompactExpired', { session_id: A }));
  assert.notEqual(c, b);
  assert.equal(boardView(c).compacting, false);
  assert.equal(boardView(c).view, 'working');
  assert.equal(reduceBoard(c, ev('RevviewCompactExpired', { session_id: A })), c);
  assert.equal(reduceBoard(b, ev('RevviewCompactExpired', { session_id: B_ID })), b);
});
const B_ID = '22222222-2222-4222-8222-222222222222';

test('RevviewInterrupted clears the mark', () => {
  const b = fold(initialBoard(), ev('SessionStart', { session_id: A }), ev('UserPromptSubmit', { session_id: A }), ev('PreCompact', { session_id: A }));
  const c = reduceBoard(b, ev('RevviewInterrupted', { session_id: A }));
  assert.equal(boardView(c).view, 'waiting');
  assert.equal(boardView(c).compacting, false);
});

test('reducer: PreCompact keeps the activity; PostCompact and SessionStart compact clear the mark only', () => {
  for (const activity of ['working', 'done', 'waiting']) {
    const s0 = { ...initialState(), activity, view: activity };
    const s1 = reduce(s0, ev('PreCompact', { trigger: 'auto' }));
    assert.equal(s1.compacting, true);
    assert.equal(s1.activity, activity);
    for (const next of [ev('PostCompact', { trigger: 'auto' }), ev('SessionStart', { source: 'compact' })]) {
      const s2 = reduce(s1, next);
      assert.deepEqual(s2, { ...s0, compacting: false });
    }
    assert.equal(reduce(s1, ev('SubagentStop')), s1);
    assert.equal(reduce(s1, ev('RevviewNetwork', { online: true })), s1);
  }
});

const post = (live, body) => fetch(`${live.url}/event`, { method: 'POST', body: JSON.stringify(body) });
test('server: PreCompact starts a compactLimitMs timer that clears the mark; RevviewCompactExpired is refused', async (t) => {
  const timers = { list: [], cleared: [] };
  timers.setTimeout = (fn, ms) => { const h = { fn, ms, unref() {} }; timers.list.push(h); return h; };
  timers.clearTimeout = (h) => timers.cleared.push(h);
  const live = await startLiveServer({ port: 0, timers, compactLimitMs: 4321 });
  t.after(() => live.close());
  await post(live, ev('SessionStart', { session_id: A, cwd: '/w/a' }));
  await post(live, ev('UserPromptSubmit', { session_id: A, cwd: '/w/a' }));
  await post(live, ev('PreCompact', { session_id: A, trigger: 'auto' }));
  assert.equal(live.state().compacting, true);
  const h = timers.list.find((x) => x.ms === 4321);
  assert.ok(h);
  await post(live, ev('PreCompact', { session_id: A, trigger: 'auto' }));
  assert.ok(timers.cleared.includes(h), 'a later PreCompact restarts the timer');
  timers.list.filter((x) => x.ms === 4321).at(-1).fn();
  assert.equal(live.state().compacting, false);
  assert.equal(live.state().view, 'working');
  assert.equal((await post(live, ev('RevviewCompactExpired', { session_id: A }))).status, 403);
});

test('a /compact after a failed turn keeps the failure (PreCompact and PostCompact do not clear `failed`)', () => {
  let s = reduce(initialState(), ev('UserPromptSubmit', { prompt: 'x', session_id: A }));
  s = reduce(s, ev('StopFailure', { error: 'rate_limit', session_id: A }));
  assert.equal(s.failed.error, 'rate_limit');
  s = reduce(s, ev('PreCompact', { trigger: 'manual', session_id: A }));
  assert.equal(s.compacting, true);
  assert.equal(s.failed.error, 'rate_limit');
  s = reduce(s, ev('PostCompact', { trigger: 'manual', session_id: A }));
  assert.equal(s.compacting, false);
  assert.equal(s.failed.error, 'rate_limit');
});
