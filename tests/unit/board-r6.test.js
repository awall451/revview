// Round 6: projects whose folder is missing are marked in the New session rows (QA r5-07).
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, reduceBoard, boardView } from '../../src/state/index.js';

const ev = (name, extra = {}) => ({ hook_event_name: name, ...extra });
const P = ['/p/one', '/p/two', '/p/three'];
const withP = (extra = {}) => reduceBoard(initialBoard(), ev('RevviewProjects', { paths: P, ...extra }));
const press = (b, keys) => keys.reduce((x, k) => reduceBoard(x, ev('RevviewNav', { button: k, gesture: 'tap' })), b);

test('r5-07: new rows carry missing: true for the missing projects only', () => {
  const rows = boardView(press(withP({ missing: ['/p/two'] }), ['menu', 'press'])).nav.rows;
  assert.deepEqual(rows, [{ label: '/p/one' }, { label: '/p/two', missing: true }, { label: '/p/three' }]);
  assert.deepEqual(boardView(press(withP(), ['menu', 'press'])).nav.rows, P.map((label) => ({ label })));
});

test('r5-07: a bad missing list is refused like bad paths; one not in paths too', () => {
  const b = withP({ missing: ['/p/two'] });
  for (const missing of ['x', [1], ['/not/listed'], Array.from({ length: 33 }, () => '/p/one')]) {
    assert.equal(reduceBoard(b, ev('RevviewProjects', { paths: P, missing })), b, JSON.stringify(missing));
  }
});

test('r5-07: only a change of the missing set is a change; it does not close an open New session', () => {
  const b = press(withP({ missing: ['/p/two'] }), ['menu', 'press']);
  assert.equal(reduceBoard(b, ev('RevviewProjects', { paths: P, missing: ['/p/two'] })), b);
  const c = reduceBoard(b, ev('RevviewProjects', { paths: P, missing: [] }));
  assert.notEqual(c, b);
  assert.equal(c.nav.kind, 'new');
  assert.deepEqual(boardView(c).nav.rows.map((r) => r.missing), [undefined, undefined, undefined]);
});

test('r4-07: the "Too early" note shows on NEEDS PERMISSION, and the answer that follows clears it', () => {
  const S = { session_id: 'A', cwd: '/w/a' };
  const cmd = { tool_name: 'Bash', tool_input: { command: 'ls' } };
  let b = [ev('UserPromptSubmit', S), ev('PermissionRequest', { ...S, ...cmd }), ev('RevviewSelect', { session_id: 'A' })].reduce((x, e) => reduceBoard(x, e), initialBoard());
  b = reduceBoard(b, ev('RevviewNote', { note: 'Too early: press again' }));
  assert.equal(boardView(b).note, 'Too early: press again');
  assert.equal(boardView(b).view, 'permission');
  const p = b.sessions.A.pending[0];
  const c = reduceBoard(b, ev('RevviewAnswered', { session_id: 'A', agent: p.agent, since: p.since, decision: 'allow' }));
  assert.equal(boardView(c).note, null);
});

test('r5-07: the Projects view does not mark rows', () => {
  const b = press(withP({ missing: ['/p/two'] }), ['menu', 'down', 'press']);
  assert.equal(b.nav.kind, 'projects');
  assert.deepEqual(boardView(b).nav.rows, P.map((label) => ({ label })));
});
