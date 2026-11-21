import test from 'node:test';
import assert from 'node:assert/strict';
import { STATES, isState } from '../../src/state/states.js';

test('STATES lists the seven canonical names, in order, without duplicates', () => {
  assert.deepEqual([...STATES], ['working', 'waiting', 'permission', 'done', 'starting', 'offline', 'insert-key']);
  assert.equal(new Set(STATES).size, STATES.length);
});

test('STATES is frozen', () => {
  assert.ok(Object.isFrozen(STATES));
  assert.throws(() => STATES.push('x'), TypeError);
});

test('isState accepts canonical names only', () => {
  for (const s of STATES) assert.equal(isState(s), true);
  for (const bad of ['Working', 'insert_key', '', 'idle', undefined, null, 42]) {
    assert.equal(isState(bad), false);
  }
});
