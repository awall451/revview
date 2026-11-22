import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_SPEECH_CONFIG_PATH, loadSpeechConfig, pickEngine, describeChoice, SpeechConfigError,
} from '../../src/speech/config.js';

function withFile(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-config-'));
  try {
    const file = path.join(dir, 'speech.json');
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const load = (obj) => withFile(obj, loadSpeechConfig);
const eng = (extra = {}) => ({ name: 'e', stages: [['/bin/true']], ...extra });

test('the shipped config loads: piper first, espeak-ng second, no speaking on stop', () => {
  assert.ok(path.isAbsolute(DEFAULT_SPEECH_CONFIG_PATH));
  assert.ok(fs.existsSync(DEFAULT_SPEECH_CONFIG_PATH));
  const c = loadSpeechConfig(DEFAULT_SPEECH_CONFIG_PATH);
  assert.deepEqual(c.engines.map((e) => e.name), ['piper', 'espeak-ng']);
  assert.equal(c.speakOnStop, false);
  assert.equal(c.engines[0].stages.length, 2);
  assert.deepEqual(c.engines[1].needs, []);
});

test('a missing file gives no engines and does not throw', () => {
  assert.deepEqual(loadSpeechConfig('/nonexistent/dir/speech.json'), { engines: [], speakOnStop: false });
});

test('a good file: argv is kept exactly as written', () => {
  const c = load({ _note: 'x', speakOnStop: true, engines: [eng({ _c: 1, stages: [['say', '-v', '{text} $HOME'], ['/bin/cat']], needs: ['/etc/hostname'] })] });
  assert.equal(c.speakOnStop, true);
  assert.deepEqual(c.engines[0].stages, [['say', '-v', '{text} $HOME'], ['/bin/cat']]);
  assert.deepEqual(c.engines[0].needs, ['/etc/hostname']);
});

test('bad JSON and bad shapes throw SpeechConfigError', () => {
  assert.throws(() => withFile('{nope', loadSpeechConfig), SpeechConfigError);
  const bad = [
    [],
    { engines: 'x' },
    { engines: Array.from({ length: 9 }, (_, i) => eng({ name: `e${i}` })) },
    { engines: [eng(), 5] },
    { engines: [eng({ name: 'Bad Name' })] },
    { engines: [eng({ name: '' })] },
    { engines: [eng({ name: 'a'.repeat(33) })] },
    { engines: [eng({ stages: [] })] },
    { engines: [eng({ stages: [[]] })] },
    { engines: [eng({ stages: [['/bin/a'], ['/bin/a'], ['/bin/a'], ['/bin/a']] })] },
    { engines: [eng({ stages: [['./rel/x']] })] },
    { engines: [eng({ stages: [['bin/x']] })] },
    { engines: [eng({ stages: [['a b']] })] },
    { engines: [eng({ stages: [['/bin/x', 5]] })] },
    { engines: [eng({ stages: [['/bin/x', '']] })] },
    { engines: [eng({ stages: [['/bin/x', 'a\u0000b']] })] },
    { engines: [eng({ stages: [['/bin/x', 'a'.repeat(513)]] })] },
    { engines: [eng({ stages: [['/bin/x', ...Array(32).fill('a')]] })] },
    { engines: [eng({ stages: 'x' })] },
    { engines: [eng({ needs: ['relative/model'] })] },
    { engines: [eng({ needs: 'x' })] },
    { engines: [eng({ extra: 1 })] },
    { engines: [eng()], speakOnStop: 'yes' },
    { engines: [eng()], other: 1 },
  ];
  for (const b of bad) assert.throws(() => load(b), SpeechConfigError, JSON.stringify(b).slice(0, 80));
  assert.throws(() => load([]), /speech config/);
});

const cfg = () => loadSpeechConfig(DEFAULT_SPEECH_CONFIG_PATH);

test('pickEngine: the first engine whose programs and files are all there', () => {
  const have = (...names) => (p) => names.some((n) => p === n || p.endsWith(`/${n}`));
  const all = pickEngine(cfg(), { exists: have('piper', 'aplay', 'espeak-ng', 'en_US-lessac-medium.onnx') });
  assert.equal(all.name, 'piper');
  const noPiper = pickEngine(cfg(), { exists: have('aplay', 'espeak-ng') });
  assert.equal(noPiper.name, 'espeak-ng');
  const noModel = pickEngine(cfg(), { exists: have('piper', 'aplay', 'espeak-ng') });
  assert.equal(noModel.name, 'espeak-ng');
  const noAplay = pickEngine(cfg(), { exists: have('piper', 'espeak-ng', 'en_US-lessac-medium.onnx') });
  assert.equal(noAplay.name, 'espeak-ng');
  assert.equal(pickEngine(cfg(), { exists: () => false }), null);
  assert.equal(pickEngine({ engines: [], speakOnStop: false }, { exists: () => true }), null);
});

test('pickEngine: a bare command is searched in PATH, an absolute one is checked as it is', () => {
  const seen = [];
  const config = { engines: [{ name: 'x', stages: [['tool'], ['/abs/tool2']], needs: [] }], speakOnStop: false };
  const dirs = ['/one', '/two'].join(path.delimiter);
  const old = process.env.PATH;
  process.env.PATH = dirs;
  try {
    const e = pickEngine(config, { exists: (p) => { seen.push(p); return p === '/two/tool' || p === '/abs/tool2'; } });
    assert.equal(e.name, 'x');
    assert.deepEqual(seen, ['/one/tool', '/two/tool', '/abs/tool2']);
  } finally {
    process.env.PATH = old;
  }
});

test('pickEngine with the real file system: a stand-in engine in a temp dir is found', () => {
  const config = { engines: [{ name: 'real', stages: [['/bin/sh']], needs: ['/nonexistent/model'] }], speakOnStop: false };
  assert.equal(pickEngine(config), null);
  config.engines[0].needs = [];
  assert.equal(pickEngine(config).name, 'real');
});

test('describeChoice: plain log lines', () => {
  const c = cfg();
  assert.equal(describeChoice(c, c.engines[0]), 'read aloud: piper (/opt/piper/piper)');
  assert.equal(describeChoice(c, c.engines[1]), 'read aloud: espeak-ng (espeak-ng)');
  assert.equal(describeChoice(c, null), 'read aloud: no speech engine found (tried piper, espeak-ng): the read-aloud button does nothing');
  assert.equal(describeChoice({ engines: [], speakOnStop: false }, null), 'read aloud: no engines configured');
});
