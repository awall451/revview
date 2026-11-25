import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUE_NAMES, CUE_FORMAT, cueWav } from '../../src/sounds/wav.js';
import { writeCues } from '../../src/sounds/make-cues.js';

const CUES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/sounds/cues');
const RATE = 22050;

function parseWav(buf) {
  assert.equal(buf.toString('latin1', 0, 4), 'RIFF');
  assert.equal(buf.readUInt32LE(4), buf.length - 8);
  assert.equal(buf.toString('latin1', 8, 12), 'WAVE');
  assert.equal(buf.toString('latin1', 12, 16), 'fmt ');
  assert.equal(buf.readUInt32LE(16), 16);
  assert.equal(buf.readUInt16LE(20), 1);
  assert.equal(buf.readUInt16LE(22), 1);
  assert.equal(buf.readUInt32LE(24), RATE);
  assert.equal(buf.readUInt32LE(28), RATE * 2);
  assert.equal(buf.readUInt16LE(32), 2);
  assert.equal(buf.readUInt16LE(34), 16);
  assert.equal(buf.toString('latin1', 36, 40), 'data');
  const n = buf.readUInt32LE(40);
  assert.equal(n, buf.length - 44);
  assert.equal(n % 2, 0);
  const samples = new Int16Array(n / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(44 + i * 2);
  return samples;
}

// Runs of non-silent samples; a gap of >= 15 ms of |s| < 200 ends a burst.
function bursts(s) {
  const minGap = Math.round(0.015 * RATE);
  const out = [];
  let start = -1;
  let last = -1;
  for (let i = 0; i < s.length; i++) {
    if (Math.abs(s[i]) >= 200) {
      if (start >= 0 && i - last > minGap) {
        out.push([start, last]);
        start = -1;
      }
      if (start < 0) start = i;
      last = i;
    }
  }
  if (start >= 0) out.push([start, last]);
  return out;
}

function freq(s, [a, b]) {
  let zc = 0;
  for (let i = a + 1; i <= b; i++) if ((s[i - 1] < 0) !== (s[i] < 0)) zc++;
  return zc / 2 / ((b - a + 1) / RATE);
}

const peak = (s) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

test('format and names', () => {
  assert.deepEqual([...CUE_NAMES], ['needs', 'done', 'failed', 'other']);
  assert.deepEqual({ ...CUE_FORMAT }, { sampleRate: 22050, channels: 1, bitsPerSample: 16 });
  assert.throws(() => cueWav('nope'));
});

test('committed files equal the generator, and writeCues is deterministic', () => {
  for (const n of CUE_NAMES) assert.ok(fs.readFileSync(path.join(CUES_DIR, `${n}.wav`)).equals(cueWav(n)), n);
  const dirs = [fs.mkdtempSync(path.join(os.tmpdir(), 'cues-')), fs.mkdtempSync(path.join(os.tmpdir(), 'cues-'))];
  try {
    for (const d of dirs) writeCues(d);
    for (const n of CUE_NAMES) {
      const a = fs.readFileSync(path.join(dirs[0], `${n}.wav`));
      assert.ok(a.equals(fs.readFileSync(path.join(dirs[1], `${n}.wav`))));
      assert.ok(a.equals(cueWav(n)));
    }
  } finally {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('each cue is a valid, short, small WAV and the four differ', () => {
  const bufs = {};
  for (const n of CUE_NAMES) {
    bufs[n] = fs.readFileSync(path.join(CUES_DIR, `${n}.wav`));
    const s = parseWav(bufs[n]);
    const sec = s.length / RATE;
    assert.ok(sec > 0.05 && sec < 1.0, `${n} ${sec}`);
    assert.ok(bufs[n].length < 64 * 1024);
  }
  for (let i = 0; i < CUE_NAMES.length; i++) {
    for (let j = i + 1; j < CUE_NAMES.length; j++) assert.ok(!bufs[CUE_NAMES[i]].equals(bufs[CUE_NAMES[j]]));
  }
});

test('other is the softest cue', () => {
  const p = Object.fromEntries(CUE_NAMES.map((n) => [n, peak(parseWav(cueWav(n)))]));
  assert.ok(p.other < 0.3 * 32767);
  for (const n of ['needs', 'done', 'failed']) assert.ok(p.other < p[n], n);
});

test('patterns: burst counts and direction', () => {
  const want = { needs: 4, done: 1, failed: 2, other: 1 };
  for (const n of CUE_NAMES) {
    const s = parseWav(cueWav(n));
    const b = bursts(s);
    assert.equal(b.length, want[n], n);
    if (n === 'needs') {
      assert.ok(freq(s, b[1]) > freq(s, b[0]));
      assert.ok(freq(s, b[3]) > freq(s, b[2]));
    }
    if (n === 'failed') assert.ok(freq(s, b[1]) < freq(s, b[0]));
  }
});
