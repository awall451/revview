import test from 'node:test';
import assert from 'node:assert/strict';
import { STATES, PAGE_ONLY_VIEWS, VIEWS, isState } from '../../src/state/states.js';

test('STATES lists the nine reducer names, in order, without duplicates', () => {
  assert.deepEqual([...STATES], ['working', 'waiting', 'permission', 'done', 'starting', 'offline', 'insert-key', 'unknown', 'ended']);
  assert.equal(new Set(STATES).size, STATES.length);
});

test('STATES is frozen', () => {
  assert.ok(Object.isFrozen(STATES));
  assert.throws(() => STATES.push('x'), TypeError);
});

test('PAGE_ONLY_VIEWS and VIEWS', () => {
  assert.deepEqual([...PAGE_ONLY_VIEWS], ['no-link']);
  assert.ok(Object.isFrozen(PAGE_ONLY_VIEWS) && Object.isFrozen(VIEWS));
  assert.deepEqual([...VIEWS], [...STATES, 'no-link']);
  assert.equal(isState('no-link'), false);
});

test('isState accepts canonical names only', () => {
  for (const s of STATES) assert.equal(isState(s), true);
  for (const bad of ['Working', 'insert_key', '', 'idle', undefined, null, 42]) {
    assert.equal(isState(bad), false);
  }
});
