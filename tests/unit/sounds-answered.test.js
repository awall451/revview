// A prompt that revview itself answered (RevviewAnswered), or whose wait ended (RevviewAskGone), gives no cue;
// the next new question in the session gives needs once. On real reduced boards.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initialBoard, reduceBoard } from '../../src/state/index.js';
import { cueClass, cueFor } from '../../src/sounds/classify.js';

const SID = '11111111-1111-4111-8111-111111111111';
const lines = (f) => fs.readFileSync(fileURLToPath(new URL(`../../fixtures/sessions/${f}`, import.meta.url)), 'utf8')
  .split('\n').filter(Boolean).map((l) => ({ ...JSON.parse(l), session_id: SID }));
const run = (events, b = initialBoard()) => events.reduce((acc, e) => reduceBoard(acc, e), b);
const MODE = { hook_event_name: 'RevviewSounds', mode: 'cues' };
const pendingOf = (b) => b.sessions[SID].pending;

// the board while the last event of the fixture is the held request (as the permission route sees it)
function upTo(file, n) {
  const ev = lines(file);
  return { board: run([MODE, ...ev.slice(0, n + 1)]), ev };
}
const answered = (b, decision = 'allow') => {
  const p = pendingOf(b).at(-1);
  return { hook_event_name: 'RevviewAnswered', session_id: SID, agent: p.agent, since: p.since, decision };
};
const gone = (b, how) => {
  const p = pendingOf(b).at(-1);
  return { hook_event_name: 'RevviewAskGone', session_id: SID, agent: p.agent, since: p.since, how };
};

const CASES = [
  ['question', 'ask-question.jsonl', 3],
  ['plan', 'plan-approve.jsonl', 8],
  ['permission prompt', 'permission-prompt.jsonl', null],
];
function board(file, n) {
  if (n !== null) return upTo(file, n);
  // permission-prompt: stop at the first PermissionRequest
  const ev = lines(file);
  const i = ev.findIndex((e) => e.hook_event_name === 'PermissionRequest');
  return { board: run([MODE, ...ev.slice(0, i + 1)]), ev };
}

for (const [name, file, n] of CASES) {
  test(`${name} answered by revview: needs while pending, then no cue; a decision of either kind`, () => {
    const { board: held } = board(file, n);
    assert.equal(cueClass(held, SID), 'needs');
    for (const decision of ['allow', 'deny']) {
      const after = reduceBoard(held, answered(held, decision));
      assert.notEqual(after, held);
      assert.equal(cueFor(held, after), null, `${decision}: no cue when the answer clears the prompt`);
      assert.notEqual(cueClass(after, SID), 'needs');
    }
  });
}

test('question answered by revview, then a new question in the same session: one needs cue', () => {
  const { board: held, ev } = upTo('ask-question.jsonl', 3);
  const after = reduceBoard(held, answered(held));
  assert.equal(cueFor(held, after), null);
  const q2 = ev[3];
  const next = run([ev[1], { ...q2, tool_use_id: 'toolu_second' }], after);
  assert.deepEqual(cueFor(after, next), { cue: 'needs', session: SID });
  // and only once: the same board again, and a note-only change, are no new cue
  assert.equal(cueFor(next, next), null);
});

test('a plan answered, then a question: one needs cue', () => {
  const { board: held } = upTo('plan-approve.jsonl', 8);
  const after = reduceBoard(held, answered(held));
  assert.equal(cueFor(held, after), null);
  const asks = lines('ask-question.jsonl');
  const next = run([asks[1], asks[2], asks[3]], after);
  assert.deepEqual(cueFor(after, next), { cue: 'needs', session: SID });
});

for (const how of ['timeout', 'closed']) {
  test(`question whose wait ended (RevviewAskGone ${how}): no cue; a later question gives one needs cue`, () => {
    const { board: held, ev } = upTo('ask-question.jsonl', 3);
    const after = reduceBoard(held, gone(held, how));
    assert.notEqual(after, held, 'the entry left the board');
    assert.equal(cueFor(held, after), null);
    assert.notEqual(cueClass(after, SID), 'needs');
    const next = run([ev[1], { ...ev[3], tool_use_id: 'toolu_second' }], after);
    assert.deepEqual(cueFor(after, next), { cue: 'needs', session: SID });
  });
}

test('plan whose wait timed out: no cue', () => {
  const { board: held } = upTo('plan-approve.jsonl', 8);
  const after = reduceBoard(held, gone(held, 'timeout'));
  assert.notEqual(after, held);
  assert.equal(cueFor(held, after), null);
});
