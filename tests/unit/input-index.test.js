import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers';
import { startInput } from '../../src/input/index.js';
import { encodeEvent, EV_KEY, EV_SYN, SYN_REPORT, SYN_DROPPED } from '../../src/input/evdev.js';
import { KEY_CODES as K } from '../../src/input/keys.js';

const key = (code, value) => encodeEvent({ type: EV_KEY, code, value });
const syn = (code = SYN_REPORT) => encodeEvent({ type: EV_SYN, code, value: 0 });
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

function setup() {
  let t = 0;
  const timers = [];
  const clock = {
    now: () => t,
    setTimeout(fn, ms) { const h = { fn, at: t + ms }; timers.push(h); return h; },
    clearTimeout(h) { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        if (!timers.length || timers[0].at > end) break;
        const h = timers.shift();
        t = h.at;
        h.fn();
      }
      t = end;
    },
  };
  const streams = [];
  const deps = {
    readProcDevices: async () => 'I: Bus=0003 Vendor=1d50 Product=615e Version=0111\nN: Name="ZMK Dongle"\nH: Handlers=sysrq kbd event3\n',
    exists: async () => true,
    openStream: () => { const s = new EventEmitter(); s.close = () => {}; streams.push(s); return s; },
  };
  const out = [];
  const config = {
    device: { path: '/dev/input/event3', grab: true },
    timing: { debounceMs: 30, holdMs: 400, longHoldMs: 1000 },
    bindings: [{ mods: [], key: K.F14, keyName: 'F14', button: 'read', hold: true, longHold: false }],
  };
  const input = startInput({ config, onGesture: (g) => out.push(g), clock, deps, log: () => {} });
  return { clock, out, streams, input };
}

test('SYN_DROPPED resets the detector: a key held across it gives no gesture', async () => {
  const { clock, out, streams, input } = setup();
  await flush();
  const s = streams[0];
  s.emit('ready');
  s.emit('data', Buffer.concat([key(K.F14, 1), syn()]));
  clock.advance(100);
  s.emit('data', syn(SYN_DROPPED));
  clock.advance(2000); // the hold timer was cleared by the reset
  s.emit('data', Buffer.concat([key(K.F14, 0), syn()]));
  assert.deepEqual(out, []);
  input.stop();
});

test('key events between SYN_DROPPED and the next SYN_REPORT never reach the detector', async () => {
  const { clock, out, streams, input } = setup();
  await flush();
  const s = streams[0];
  s.emit('ready');
  s.emit('data', Buffer.concat([syn(SYN_DROPPED), key(K.F14, 1), syn()]));
  clock.advance(2000);
  assert.deepEqual(out, [], 'the stale press must not start a hold');
  s.emit('data', Buffer.concat([key(K.F14, 1), syn()]));
  clock.advance(500);
  assert.deepEqual(out.map((g) => g.gesture), ['hold']);
  input.stop();
});
