import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPermissionRegistry,
  DENY_MESSAGE,
  MIN_SHOWN_MS,
  REQUEST_WAIT_MS,
} from '../../src/sessions/permissions.js';

const P = (o = {}) => ({ session: 'sess-a', agent: null, since: 100, tool: 'Bash', file: null, command: 'ls', ...o });

function setup(opts = {}) {
  let now = 10000;
  const timers = [];
  const fake = {
    setTimeout: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (t) => {
      t.cleared = true;
    },
  };
  const reg = createPermissionRegistry({ clock: () => now, timers: fake, ...opts });
  const add = (prompt = P()) => {
    const log = [];
    const id = reg.add(prompt, (d) => log.push(d));
    return { id, log };
  };
  return { reg, add, timers, tick: (ms) => (now += ms) };
}

test('constants', () => {
  assert.equal(MIN_SHOWN_MS, 1500);
  assert.equal(REQUEST_WAIT_MS, 540000);
  assert.equal(DENY_MESSAGE, 'Denied with the wheel button.');
});

test('allow happy path', () => {
  const { reg, add, tick, timers } = setup();
  const { id, log } = add();
  assert.equal(timers[0].ms, 540000);
  reg.observe(P());
  tick(1500);
  const r = reg.answer('allow', P(), 'sess-a');
  assert.deepEqual(r, { ok: true, id });
  assert.deepEqual(log, [{ behavior: 'allow' }]);
  assert.equal(reg.size(), 0);
  assert.ok(timers[0].cleared);
});

test('deny carries the message', () => {
  const { reg, add, tick } = setup();
  const { log } = add();
  reg.observe(P());
  tick(2000);
  assert.equal(reg.answer('deny', P(), 'sess-a').ok, true);
  assert.deepEqual(log, [{ behavior: 'deny', message: DENY_MESSAGE }]);
});

test('shown too briefly refused, exact threshold ok', () => {
  const { reg, add, tick } = setup();
  const { log } = add();
  reg.observe(P());
  tick(1499);
  assert.deepEqual(reg.answer('allow', P(), 'sess-a'), { ok: false, reason: 'too-early' });
  assert.deepEqual(reg.answer('allow', P(), 'sess-a'), { ok: false, reason: 'too-early' }, 'a second fast press is refused too');
  assert.deepEqual(log, []);
  tick(1);
  assert.equal(reg.answer('allow', P(), 'sess-a').ok, true);
});

test('changed shown key resets the timer; repeated observe does not', () => {
  const { reg, add, tick } = setup();
  const { log } = add();
  reg.observe(P());
  tick(1000);
  reg.observe(P());
  tick(600);
  assert.equal(reg.answer('allow', P(), 'sess-a').ok, true);
  assert.deepEqual(log, [{ behavior: 'allow' }]);
  const b = setup();
  const x = b.add();
  b.reg.observe(P());
  b.tick(1400);
  b.reg.observe(P({ command: 'rm' }));
  b.reg.observe(P());
  b.tick(200);
  assert.equal(b.reg.answer('allow', P(), 'sess-a').ok, false);
  assert.deepEqual(x.log, []);
});

test('observe null resets', () => {
  const { reg, add, tick } = setup();
  add();
  reg.observe(P());
  tick(2000);
  reg.observe(null);
  reg.observe(P());
  tick(100);
  assert.equal(reg.answer('allow', P(), 'sess-a').ok, false);
});

test('session mismatch, null chosen, null shown refused', () => {
  const { reg, add, tick } = setup();
  const { log } = add();
  reg.observe(P());
  tick(2000);
  assert.equal(reg.answer('allow', P(), 'sess-b').ok, false);
  assert.equal(reg.answer('allow', P(), null).ok, false);
  assert.equal(reg.answer('allow', P(), '').ok, false);
  assert.equal(reg.answer('allow', null, 'sess-a').ok, false);
  assert.equal(reg.answer('maybe', P(), 'sess-a').ok, false);
  assert.deepEqual(log, []);
});

test('shown differs from the last observed prompt refused', () => {
  const { reg, add, tick } = setup();
  add();
  reg.observe(P());
  tick(2000);
  assert.equal(reg.answer('allow', P({ command: 'rm' }), 'sess-a').ok, false);
});

test('content mismatch with the request refused', () => {
  const { reg, add, tick } = setup();
  const { log } = add(P({ command: 'ls' }));
  reg.observe(P({ command: 'rm -rf x' }));
  tick(2000);
  assert.equal(reg.answer('allow', P({ command: 'rm -rf x' }), 'sess-a').ok, false);
  assert.deepEqual(log, []);
  assert.equal(reg.size(), 1);
});

test('two identical requests are ambiguous', () => {
  const { reg, add, tick } = setup();
  const a = add();
  const b = add();
  reg.observe(P());
  tick(2000);
  assert.deepEqual(reg.answer('allow', P(), 'sess-a'), { ok: false, reason: 'ambiguous' });
  assert.deepEqual(a.log, []);
  assert.deepEqual(b.log, []);
  assert.equal(reg.size(), 2);
});

test('second press does nothing and does not answer another request', () => {
  const { reg, add, tick } = setup();
  const a = add(P({ since: 100 }));
  const b = add(P({ since: 200 }));
  reg.observe(P({ since: 100 }));
  tick(2000);
  assert.equal(reg.answer('allow', P({ since: 100 }), 'sess-a').ok, true);
  assert.equal(reg.answer('allow', P({ since: 100 }), 'sess-a').ok, false);
  assert.deepEqual(a.log, [{ behavior: 'allow' }]);
  assert.deepEqual(b.log, []);
});

test('sweep responds null once for stale requests only', () => {
  const { reg, add } = setup();
  const a = add(P({ since: 100 }));
  const b = add(P({ since: 200 }));
  const c = add(P({ since: null }));
  reg.sweep([P({ since: 200 })]);
  reg.sweep([P({ since: 200 })]);
  assert.deepEqual(a.log, [null]);
  assert.deepEqual(b.log, []);
  assert.deepEqual(c.log, []);
  assert.equal(reg.size(), 2);
  reg.sweep([]);
  assert.deepEqual(b.log, [null]);
  assert.deepEqual(c.log, []);
});

test('sweep matches agent too', () => {
  const { reg, add } = setup();
  const a = add(P({ agent: 'ag1' }));
  reg.sweep([P({ agent: null })]);
  assert.deepEqual(a.log, [null]);
});

test('timeout responds null once', () => {
  const { reg, add, timers } = setup();
  const { log } = add();
  timers[0].fn();
  assert.deepEqual(log, [null]);
  assert.equal(reg.size(), 0);
  reg.close();
  assert.deepEqual(log, [null]);
});

test('remove never calls respond; later answer refused', () => {
  const { reg, add, tick, timers } = setup();
  const { id, log } = add();
  reg.observe(P());
  tick(2000);
  reg.remove(id);
  assert.ok(timers[0].cleared);
  assert.equal(reg.answer('allow', P(), 'sess-a').ok, false);
  reg.sweep([]);
  assert.deepEqual(log, []);
  assert.equal(reg.size(), 0);
});

test('max cap returns null without respond', () => {
  const { reg, add } = setup({ max: 2 });
  add();
  add();
  const c = add();
  assert.equal(c.id, null);
  assert.deepEqual(c.log, []);
  assert.equal(reg.size(), 2);
});

test('ids are random uuids and input cannot set one', () => {
  const { add } = setup();
  const a = add({ ...P(), id: 'chosen' });
  const b = add();
  assert.match(a.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a.id, 'chosen');
  assert.notEqual(a.id, b.id);
});

test('since null is never answerable', () => {
  const { reg, add, tick } = setup();
  const { log } = add(P({ since: null }));
  reg.observe(P({ since: null }));
  tick(2000);
  assert.equal(reg.answer('allow', P({ since: null }), 'sess-a').ok, false);
  assert.deepEqual(log, []);
});

test('close responds null to all once', () => {
  const { reg, add, timers } = setup();
  const a = add();
  const b = add(P({ since: 5 }));
  reg.close();
  reg.close();
  assert.deepEqual(a.log, [null]);
  assert.deepEqual(b.log, [null]);
  assert.ok(timers.every((t) => t.cleared));
  assert.equal(reg.size(), 0);
});

test('finding 2: a prompt that is not the shown one is not-shown-long-enough, never too-early', () => {
  const { reg, add, tick } = setup();
  add();
  assert.deepEqual(reg.answer('allow', P(), 'sess-a'), { ok: false, reason: 'not-shown-long-enough' }); // nothing observed yet
  reg.observe(P());
  tick(5000);
  assert.deepEqual(reg.answer('allow', P({ command: 'other' }), 'sess-a'), { ok: false, reason: 'not-shown-long-enough' }); // key mismatch
});
