// The kept settings file: parse (refuses what it does not know) and the store (atomic write, never throws, one log line per failure streak).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSettings, defaultSettingsPath, createSettingsStore, SettingsError, MAX_SETTINGS_BYTES } from '../../src/server/settings.js';
import path from 'node:path';
import { fakeFs } from './settings-fake-fs.js';

const P = '/state/revview/settings.json';

test('parseSettings: good files, every key optional', () => {
  assert.deepEqual(parseSettings('{}'), {});
  assert.deepEqual(parseSettings('{"sounds":"cues","look":"night","lights":"on"}'), { sounds: 'cues', look: 'night', lights: 'on' });
  assert.deepEqual(parseSettings(' {"look":"auto"}\n'), { look: 'auto' });
  for (const v of ['off', 'cues', 'speech']) assert.deepEqual(parseSettings(`{"sounds":"${v}"}`), { sounds: v });
  for (const v of ['day', 'night', 'auto']) assert.deepEqual(parseSettings(`{"look":"${v}"}`), { look: v });
  for (const v of ['off', 'on']) assert.deepEqual(parseSettings(`{"lights":"${v}"}`), { lights: v });
});

test('parseSettings: refuses unknown keys, bad values, non-objects, bad JSON, too large', () => {
  const bad = [
    ['{"volume":"loud"}', /unknown key "volume"/],
    ['{"_comment":"x"}', /unknown key "_comment"/],
    ['{"sounds":"loud"}', /"sounds" must be/],
    ['{"sounds":1}', /"sounds" must be/],
    ['{"look":"dark"}', /"look" must be/],
    ['{"look":null}', /"look" must be/],
    ['{"lights":"blink"}', /"lights" must be/],
    ['{"lights":true}', /"lights" must be/],
    ['[]', /JSON object/],
    ['"cues"', /JSON object/],
    ['null', /JSON object/],
    ['12', /JSON object/],
    ['{"sounds":', /not valid JSON/],
    ['', /not valid JSON/],
    [`{"sounds":"off","x":"${'a'.repeat(MAX_SETTINGS_BYTES)}"}`, /larger than/],
  ];
  for (const [text, re] of bad) {
    assert.throws(() => parseSettings(text), (e) => e instanceof SettingsError && re.test(e.message), text.slice(0, 40));
  }
});

test('defaultSettingsPath: XDG_STATE_HOME, else HOME/.local/state', () => {
  assert.equal(defaultSettingsPath({ XDG_STATE_HOME: '/x/state', HOME: '/home/u' }), '/x/state/revview/settings.json');
  assert.equal(defaultSettingsPath({ HOME: '/home/u' }), '/home/u/.local/state/revview/settings.json');
  assert.equal(defaultSettingsPath({ XDG_STATE_HOME: '', HOME: '/home/u' }), '/home/u/.local/state/revview/settings.json');
});

const mk = (files, extra = {}) => {
  const fs = fakeFs(files);
  const logs = [];
  const store = createSettingsStore({ path: P, fs, log: (m) => logs.push(m), ...extra });
  return { fs, logs, store };
};

test('store.load: missing file, kept file', () => {
  let c = mk({});
  assert.deepEqual(c.store.load(), { values: {}, status: 'none' });
  c = mk({ [P]: '{"sounds":"speech","lights":"off"}' });
  assert.deepEqual(c.store.load(), { values: { sounds: 'speech', lights: 'off' }, status: 'kept' });
  assert.deepEqual(c.logs, [], 'load itself never logs; the caller prints the one start line');
});

test('store.load: corrupt, refused and unreadable files give no values and a reason', () => {
  let r = mk({ [P]: '{oops' }).store.load();
  assert.equal(r.status, 'refused');
  assert.deepEqual(r.values, {});
  assert.match(r.reason, /not valid JSON/);
  r = mk({ [P]: '{"sounds":"loud"}' }).store.load();
  assert.equal(r.status, 'refused');
  assert.match(r.reason, /"sounds" must be/);
  const c = mk({ [P]: '{}' });
  c.fs.failOn.read = 'EACCES';
  r = c.store.load();
  assert.equal(r.status, 'unreadable');
  assert.deepEqual(r.values, {});
  assert.match(r.reason, /EACCES/);
});

test('store.save: mkdir -p the parent, tmp in the same dir, fsync, rename, then the directory fsync', () => {
  const { fs, store, logs } = mk({});
  assert.equal(store.save({ sounds: 'cues' }), true);
  assert.deepEqual(JSON.parse(fs.files.get(P)), { sounds: 'cues' });
  assert.equal(fs.files.has(`${P}.tmp`), false);
  assert.deepEqual(fs.calls, [
    'mkdir /state/revview', `open ${P}.tmp`, `write ${P}.tmp`, `fsync ${P}.tmp`, `close ${P}.tmp`,
    `rename ${P}.tmp ${P}`, 'open /state/revview', 'fsync /state/revview', 'close /state/revview',
  ]);
  assert.deepEqual(logs, []);
  assert.equal(fs.fds.size, 0, 'no descriptor left open');
});

test('store.save: a failing directory fsync does not fail the save', () => {
  const { fs, store, logs } = mk({});
  const real = fs.openSync;
  fs.openSync = (p, ...a) => { if (p === '/state/revview') throw Object.assign(new Error('EISDIR'), { code: 'EISDIR' }); return real(p, ...a); };
  assert.equal(store.save({ look: 'night' }), true);
  assert.deepEqual(JSON.parse(fs.files.get(P)), { look: 'night' });
  assert.deepEqual(logs, []);
});

test('store.save: write failures log one line per streak, never throw, keep the old file', () => {
  const { fs, store, logs } = mk({ [P]: '{"sounds":"off"}' });
  store.load();
  for (const code of ['EROFS', 'EACCES', 'ENOSPC']) {
    fs.failOn = { rename: code };
    assert.doesNotThrow(() => assert.equal(store.save({ sounds: 'cues' }), false));
  }
  assert.equal(logs.length, 1, 'one line for the whole streak');
  assert.match(logs[0], /cannot write/);
  assert.match(logs[0], /EROFS/);
  assert.match(logs[0], new RegExp(P));
  assert.equal(fs.files.get(P), '{"sounds":"off"}', 'the old file is untouched');
  fs.failOn = {};
  assert.equal(store.save({ sounds: 'speech' }), true);
  assert.deepEqual(JSON.parse(fs.files.get(P)), { sounds: 'speech' });
  assert.equal(logs.length, 1, 'a success logs nothing');
  fs.failOn = { open: 'EACCES' };
  store.save({ sounds: 'off' });
  assert.equal(logs.length, 2, 'a new streak after a success logs again');
  assert.match(logs[1], /EACCES/);
});

test('store.save: every failing function is survived (mkdir, open, write, fsync, rename)', () => {
  for (const op of ['mkdir', 'open', 'write', 'fsync', 'rename']) {
    const { fs, store, logs } = mk({});
    fs.failOn = { [op]: 'EROFS' };
    assert.equal(store.save({ look: 'day' }), false, op);
    assert.equal(logs.length, 1, op);
    assert.equal(fs.fds.size, 0, `${op}: no descriptor left open`);
  }
});

test('a refused file is not touched by load and is overwritten at the next change', () => {
  const { fs, store } = mk({ [P]: '{"volume":11}' });
  assert.equal(store.load().status, 'refused');
  assert.equal(fs.files.get(P), '{"volume":11}');
  assert.deepEqual(fs.calls, [`read ${P}`], 'load only reads');
  store.save({ look: 'night' });
  assert.deepEqual(JSON.parse(fs.files.get(P)), { look: 'night' });
});

test('keys of settings this run does not have are carried over into the next write', () => {
  const { fs, store } = mk({ [P]: '{"sounds":"speech","lights":"on","look":"day"}' });
  store.load();
  store.save({ look: 'night' }); // this run has no sounds and no lights
  assert.deepEqual(JSON.parse(fs.files.get(P)), { sounds: 'speech', lights: 'on', look: 'night' });
  store.save({ look: 'auto', sounds: undefined, lights: null });
  assert.deepEqual(JSON.parse(fs.files.get(P)), { sounds: 'speech', lights: 'on', look: 'auto' });
  store.save({ sounds: 'off' });
  assert.deepEqual(JSON.parse(fs.files.get(P)), { sounds: 'off', lights: 'on', look: 'auto' });
});

test('a store without a load first starts from nothing carried', () => {
  const { fs, store } = mk({ [P]: '{"sounds":"speech"}' });
  store.save({ look: 'night' });
  assert.deepEqual(JSON.parse(fs.files.get(P)), { look: 'night' });
});

test('defaultSettingsPath: HOME unset or empty falls back to the home directory, never a relative path', () => {
  for (const env of [{}, { HOME: '' }]) assert.ok(path.isAbsolute(defaultSettingsPath(env)), JSON.stringify(env));
});

test('store.save: a failed save removes the temp file; a short write is continued', () => {
  const fs = fakeFs();
  const store = createSettingsStore({ path: '/s/settings.json', fs, log: () => {} });
  fs.failOn = { fsync: 'EIO' };
  assert.equal(store.save({ look: 'night' }), false);
  assert.ok(fs.calls.includes('unlink /s/settings.json.tmp'));
  assert.equal(fs.files.has('/s/settings.json.tmp'), false);
  fs.failOn = {};
  fs.shortWrite = 3;
  assert.equal(store.save({ look: 'night' }), true);
  assert.deepEqual(JSON.parse(fs.files.get('/s/settings.json')), { look: 'night' });
});
