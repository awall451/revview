import test from 'node:test';
import assert from 'node:assert/strict';
import { createGestureDetector } from '../../src/input/gestures.js';
import { KEY_CODES as K } from '../../src/input/keys.js';

// Fake clock: a now counter and a timer list. advance(ms) fires due timers in time order.
// setNow(t) moves time WITHOUT firing timers (to simulate a late timer).
function fakeClock() {
  let t = 0;
  let seq = 0;
  let timers = [];
  return {
    now: () => t,
    setTimeout(fn, ms) { const h = { fn, at: t + ms, seq: seq++ }; timers.push(h); return h; },
    clearTimeout(h) { timers = timers.filter((x) => x !== h); },
    pending: () => timers.length,
    setNow(v) { t = v; },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
        if (!due) break;
        timers = timers.filter((x) => x !== due);
        t = due.at;
        due.fn();
      }
      t = end;
    },
  };
}

const B = (mods, keyName, button, hold = false, longHold = false) =>
  ({ mods, key: K[keyName], keyName, button, hold, longHold });
const bindings = [
  B([], 'F13', 'ptt'), B([], 'F14', 'read', true), B([], 'F15', 'cancel', false, true),
  B([], 'F16', 'deny'), B([], 'F22', 'back', true, true),
  B([], 'F24', 'spare'), B(['Shift'], 'F24', 'combo'),
];
const timing = { debounceMs: 30, holdMs: 400, longHoldMs: 1000 };

function setup() {
  const clock = fakeClock();
  const out = [];
  const d = createGestureDetector({ bindings, timing, clock, emit: (e) => out.push(e) });
  return { clock, out, d };
}

test('tap-on-press button fires at press, release does nothing', () => {
  const { clock, out, d } = setup();
  clock.advance(100);
  d.key(K.F13, 1);
  assert.deepEqual(out, [{ button: 'ptt', gesture: 'tap', at: 100 }]);
  clock.advance(50);
  d.key(K.F13, 0);
  clock.advance(2000);
  assert.equal(out.length, 1);
  assert.equal(clock.pending(), 0);
});

test('auto-repeat stream gives exactly one tap', () => {
  const { clock, out, d } = setup();
  d.key(K.F13, 1);
  for (let i = 0; i < 3; i++) { clock.advance(30); d.key(K.F13, 2); }
  d.key(K.F13, 0);
  assert.equal(out.length, 1);
});

test('invalid input never throws and is ignored', () => {
  const { out, d } = setup();
  d.key(K.F13, 5);
  d.key(K.F13, -1);
  d.key(K.F13, 1.5);
  d.key(1.5, 1);
  d.key('x', 1);
  d.key(undefined, 1);
  d.key(K.F13, undefined);
  d.key(K.F13, 2);
  d.key(K.F13, 0);
  assert.deepEqual(out, []);
});

test('press of key already down ignored; release of key not down ignored', () => {
  const { clock, out, d } = setup();
  d.key(K.F16, 0);
  d.key(K.F16, 1);
  d.key(K.F16, 1);
  assert.equal(out.length, 1);
  clock.advance(100);
  d.key(K.F16, 0);
  d.key(K.F16, 0);
  assert.equal(out.length, 1);
});

test('modifiers never emit', () => {
  const { out, d } = setup();
  d.key(K.LEFTSHIFT, 1);
  d.key(K.LEFTSHIFT, 0);
  d.key(K.RIGHTCTRL, 1);
  d.key(K.RIGHTCTRL, 0);
  assert.deepEqual(out, []);
});

test('debounce: press within debounceMs of last release of same key is ignored with its release', () => {
  const { clock, out, d } = setup();
  d.key(K.F13, 1);
  d.key(K.F13, 0);
  clock.advance(10);
  d.key(K.F13, 1);
  d.key(K.F13, 0);
  assert.equal(out.length, 1);
  clock.advance(30);
  d.key(K.F13, 1);
  assert.equal(out.length, 2);
});

test('debounce boundary is strict, and is per key', () => {
  const { clock, out, d } = setup();
  d.key(K.F13, 1);
  d.key(K.F13, 0);
  clock.advance(29);
  d.key(K.F16, 1);
  assert.equal(out.length, 2);
  d.key(K.F16, 0);
  clock.advance(1);
  d.key(K.F13, 1);
  assert.equal(out.length, 3);
});

test('bounced hold button: ignored press leaves no timers', () => {
  const { clock, out, d } = setup();
  d.key(K.F14, 1);
  clock.advance(100);
  d.key(K.F14, 0);
  clock.advance(10);
  d.key(K.F14, 1);
  assert.equal(clock.pending(), 0);
  clock.advance(1000);
  d.key(K.F14, 0);
  assert.deepEqual(out.map((e) => e.gesture), ['tap']);
});

test('unbound key: press and release ignored', () => {
  const { out, d } = setup();
  d.key(K.F1, 1);
  d.key(K.F1, 0);
  assert.deepEqual(out, []);
});

test('hold button: tap when released before holdMs', () => {
  const { clock, out, d } = setup();
  d.key(K.F14, 1);
  assert.deepEqual(out, []);
  clock.advance(399);
  d.key(K.F14, 0);
  assert.deepEqual(out, [{ button: 'read', gesture: 'tap', at: 399 }]);
  assert.equal(clock.pending(), 0);
  clock.advance(2000);
  assert.equal(out.length, 1);
});

test('hold button: hold fires by timer at holdMs, release emits nothing more', () => {
  const { clock, out, d } = setup();
  clock.advance(5);
  d.key(K.F14, 1);
  clock.advance(400);
  assert.deepEqual(out, [{ button: 'read', gesture: 'hold', at: 405 }]);
  clock.advance(600);
  d.key(K.F14, 0);
  assert.equal(out.length, 1);
  assert.equal(clock.pending(), 0);
});

test('longHold-only button: tap, nothing between, long-hold at longHoldMs', () => {
  let r = setup();
  r.d.key(K.F15, 1);
  r.clock.advance(100);
  r.d.key(K.F15, 0);
  assert.deepEqual(r.out.map((e) => e.gesture), ['tap']);

  r = setup();
  r.d.key(K.F15, 1);
  r.clock.advance(700);
  r.d.key(K.F15, 0);
  assert.deepEqual(r.out, []);
  assert.equal(r.clock.pending(), 0);

  r = setup();
  r.d.key(K.F15, 1);
  r.clock.advance(1000);
  assert.deepEqual(r.out, [{ button: 'cancel', gesture: 'long-hold', at: 1000 }]);
  r.d.key(K.F15, 0);
  assert.equal(r.out.length, 1);
});

test('hold and longHold: both fire in order', () => {
  const { clock, out, d } = setup();
  d.key(K.F22, 1);
  clock.advance(1050);
  d.key(K.F22, 0);
  assert.deepEqual(out.map((e) => [e.gesture, e.at]), [['hold', 400], ['long-hold', 1000]]);
});

test('late timer: release past holdMs emits the overdue gestures in order, then clears timers', () => {
  const { clock, out, d } = setup();
  d.key(K.F22, 1);
  clock.setNow(1100); // timers did not run yet
  d.key(K.F22, 0);
  assert.deepEqual(out.map((e) => e.gesture), ['hold', 'long-hold']);
  assert.equal(clock.pending(), 0);
  clock.advance(5000);
  assert.equal(out.length, 2);
});

test('late timer: hold-only released after holdMs emits hold, cancel between thresholds emits nothing', () => {
  const { clock, out, d } = setup();
  d.key(K.F14, 1);
  clock.setNow(500);
  d.key(K.F14, 0);
  assert.deepEqual(out.map((e) => e.gesture), ['hold']);
  d.key(K.F15, 1);
  clock.setNow(1200);
  d.key(K.F15, 0);
  assert.deepEqual(out.map((e) => e.gesture), ['hold']);
  clock.setNow(3000);
  d.key(K.F15, 1);
  clock.setNow(4100);
  d.key(K.F15, 0);
  assert.deepEqual(out.map((e) => e.gesture), ['hold', 'long-hold']);
});

test('reset clears timers, keys, modifiers, debounce; emits nothing', () => {
  const { clock, out, d } = setup();
  d.key(K.F14, 1);
  d.key(K.LEFTSHIFT, 1);
  d.key(K.F13, 1);
  d.key(K.F13, 0);
  out.length = 0;
  d.reset();
  assert.equal(clock.pending(), 0);
  clock.advance(2000);
  assert.deepEqual(out, []);
  d.key(K.F14, 0);
  d.key(K.LEFTSHIFT, 0);
  assert.deepEqual(out, []);
  d.key(K.F13, 1); // debounce memory gone
  assert.equal(out.length, 1);
  d.key(K.F13, 0);
  d.key(K.F24, 1); // modifier state gone
  assert.equal(out[1].button, 'spare');
});

test('reset with shift still down: later plain F24 is not a combo', () => {
  const { clock, out, d } = setup();
  d.key(K.LEFTSHIFT, 1);
  d.reset();
  clock.advance(100);
  d.key(K.F24, 1);
  assert.equal(out[0].button, 'spare');
});

test('reset after a hold keeps what was emitted', () => {
  const { clock, out, d } = setup();
  d.key(K.F14, 1);
  clock.advance(400);
  d.reset();
  d.key(K.F14, 0);
  assert.deepEqual(out.map((e) => e.gesture), ['hold']);
});

test('two keys down at once are independent', () => {
  const { clock, out, d } = setup();
  d.key(K.F14, 1);
  clock.advance(100);
  d.key(K.F15, 1);
  clock.advance(300);
  assert.deepEqual(out.map((e) => e.button), ['read']);
  clock.advance(700);
  assert.deepEqual(out.map((e) => e.button + ':' + e.gesture), ['read:hold', 'cancel:long-hold']);
  d.key(K.F14, 0);
  d.key(K.F15, 0);
  assert.equal(out.length, 2);
});

test('combos: Shift+F24 and F24 are different buttons', () => {
  const { clock, out, d } = setup();
  d.key(K.F24, 1);
  d.key(K.F24, 0);
  clock.advance(100);
  d.key(K.RIGHTSHIFT, 1);
  d.key(K.F24, 1);
  d.key(K.F24, 0);
  d.key(K.RIGHTSHIFT, 0);
  assert.deepEqual(out.map((e) => e.button), ['spare', 'combo']);
});

test('modifier pressed after the key does not matter; modifier released first does not change binding', () => {
  const { clock, out, d } = setup();
  d.key(K.F24, 1);
  d.key(K.LEFTSHIFT, 1);
  d.key(K.F24, 0);
  d.key(K.LEFTSHIFT, 0);
  assert.deepEqual(out.map((e) => e.button), ['spare']);
  clock.advance(100);
  d.key(K.LEFTSHIFT, 1);
  d.key(K.F24, 1);
  d.key(K.LEFTSHIFT, 0);
  d.key(K.F24, 0);
  assert.deepEqual(out.map((e) => e.button), ['spare', 'combo']);
});

test('binding fixed at press time for hold buttons', () => {
  const b2 = [...bindings, B(['Shift'], 'F14', 'shift-read', true)];
  const clock = fakeClock();
  const out = [];
  const d = createGestureDetector({ bindings: b2, timing, clock, emit: (e) => out.push(e) });
  d.key(K.LEFTSHIFT, 1);
  d.key(K.F14, 1);
  d.key(K.LEFTSHIFT, 0);
  clock.advance(450);
  assert.deepEqual(out.map((e) => e.button), ['shift-read']);
});

test('combo with extra modifier has no binding', () => {
  const { out, d } = setup();
  d.key(K.LEFTSHIFT, 1);
  d.key(K.LEFTCTRL, 1);
  d.key(K.F24, 1);
  d.key(K.F24, 0);
  assert.deepEqual(out, []);
});

test('left and right shift together count as one Shift kind', () => {
  const { clock, out, d } = setup();
  d.key(K.LEFTSHIFT, 1);
  d.key(K.RIGHTSHIFT, 1);
  d.key(K.F24, 1);
  assert.equal(out[0].button, 'combo');
  d.key(K.F24, 0);
  clock.advance(100);
  d.key(K.LEFTSHIFT, 0);
  d.key(K.F24, 1);
  assert.equal(out[1].button, 'combo');
});

test('bounce (press, release, press 10 ms later) gives one gesture', () => {
  const { clock, out, d } = setup();
  d.key(K.F16, 1);
  clock.advance(5);
  d.key(K.F16, 0);
  clock.advance(10);
  d.key(K.F16, 1);
  d.key(K.F16, 0);
  assert.equal(out.length, 1);
});
