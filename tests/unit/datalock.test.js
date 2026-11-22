import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMountinfo, isDataMounted, createDataLockMonitor, DEFAULT_DATA_MOUNT } from '../../src/server/datalock.js';

const D = '/srv/revview-data';
const MAPPER = `45 29 253:0 / ${D} rw,nosuid,nodev,noatime shared:30 - ext4 /dev/mapper/revview-data rw`;
const ROOT = '29 1 179:2 / / rw,relatime shared:1 - ext4 /dev/mmcblk0p2 rw';

test('default mount point', () => assert.equal(DEFAULT_DATA_MOUNT, '/srv/revview-data'));

test('parseMountinfo: fields, optional fields, escapes, bad lines', () => {
  const text = [
    ROOT,
    '50 29 0:40 / /mnt/my\\040disk\\134x rw master:1 shared:2 - vfat /dev/my\\040dev rw',
    'garbage',
    '51 29 0:41 / /x rw - tmpfs tmpfs rw',
    '52 29 0:42 / /y rw - tmpfs',
  ].join('\n');
  assert.deepEqual(parseMountinfo(text), [
    { mountPoint: '/', fstype: 'ext4', source: '/dev/mmcblk0p2' },
    { mountPoint: '/mnt/my disk\\x', fstype: 'vfat', source: '/dev/my dev' },
    { mountPoint: '/x', fstype: 'tmpfs', source: 'tmpfs' },
  ]);
  assert.deepEqual(parseMountinfo(undefined), []);
});

test('isDataMounted: mapper ext4 on the dir is mounted', () => {
  assert.equal(isDataMounted(`${ROOT}\n${MAPPER}\n`, { mountPoint: D }), true);
});

test('isDataMounted: absent, wrong source, wrong fstype, prefix path = locked', () => {
  assert.equal(isDataMounted(ROOT, { mountPoint: D }), false);
  assert.equal(isDataMounted(MAPPER.replace('revview-data rw', 'other rw'), { mountPoint: D }), false);
  assert.equal(isDataMounted(MAPPER.replace('ext4', 'xfs'), { mountPoint: D }), false);
  assert.equal(isDataMounted(MAPPER, { mountPoint: `${D}/sub` }), false);
});

test('isDataMounted: a later mount stacked on the dir (tmpfs, fuse) means locked', () => {
  assert.equal(isDataMounted(`${MAPPER}\n60 45 0:50 / ${D} rw - tmpfs tmpfs rw`, { mountPoint: D }), false);
  assert.equal(isDataMounted(`${MAPPER}\n60 45 0:50 / ${D} rw - fuse.sshfs me@host:/ rw`, { mountPoint: D }), false);
  // the real one on top of an earlier tmpfs is fine
  assert.equal(isDataMounted(`60 45 0:50 / ${D} rw - tmpfs tmpfs rw\n${MAPPER}`, { mountPoint: D }), true);
});

function fakeTimers() {
  const t = { fn: null, ms: null, cleared: false, unref: false };
  return {
    t,
    setInterval: (fn, ms) => { t.fn = fn; t.ms = ms; return { unref: () => { t.unref = true; } }; },
    clearInterval: () => { t.cleared = true; },
  };
}

test('monitor: first check, change, no change; polls unref\'d; stop', () => {
  const ft = fakeTimers();
  let text = ROOT;
  const seen = [];
  const m = createDataLockMonitor({ mountPoint: D, read: () => text, onChange: (l) => seen.push(l), setInterval: ft.setInterval, clearInterval: ft.clearInterval });
  assert.equal(ft.t.ms, 3000);
  assert.equal(ft.t.unref, true);
  assert.equal(m.locked(), null);
  assert.equal(m.check(), true);
  assert.equal(m.check(), true);
  assert.deepEqual(seen, [true]);
  text = MAPPER;
  ft.t.fn();
  assert.deepEqual(seen, [true, false]);
  assert.equal(m.locked(), false);
  ft.t.fn();
  assert.deepEqual(seen, [true, false]);
  text = `${MAPPER}\n60 45 0:50 / ${D} rw - tmpfs tmpfs rw`;
  assert.equal(m.check(), true);
  assert.deepEqual(seen, [true, false, true]);
  m.stop();
  assert.equal(ft.t.cleared, true);
  text = MAPPER;
  ft.t.fn();
  assert.deepEqual(seen, [true, false, true]);
});

test('monitor: a read error is locked and logged once per streak', () => {
  const ft = fakeTimers();
  let fail = true;
  const logs = [];
  const seen = [];
  const m = createDataLockMonitor({
    mountPoint: D, read: () => { if (fail) throw new Error('EIO'); return MAPPER; },
    onChange: (l) => seen.push(l), log: (x) => logs.push(x), setInterval: ft.setInterval, clearInterval: ft.clearInterval,
  });
  assert.equal(m.check(), true);
  assert.equal(m.check(), true);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /EIO/);
  fail = false;
  assert.equal(m.check(), false);
  fail = true;
  m.check();
  assert.equal(logs.length, 2);
  assert.deepEqual(seen, [true, false, true]);
  m.stop();
});
