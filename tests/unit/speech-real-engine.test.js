// The shipped espeak-ng command line against the REAL espeak-ng, when it is installed. The gate machine may not
// have it: then each test only says so and passes (the passed count must not depend on the machine). No sound
// card is needed: the output goes to a wav file (-w) or into a pipe nobody reads. NO SOUND IS EVER PLAYED OR HEARD.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSpeaker } from '../../src/speech/speaker.js';
import { loadSpeechConfig, pickEngine, DEFAULT_SPEECH_CONFIG_PATH } from '../../src/speech/config.js';
import { permissionText } from '../../src/speech/text.js';

const shipped = loadSpeechConfig(DEFAULT_SPEECH_CONFIG_PATH);
const real = pickEngine({ engines: shipped.engines.filter((e) => e.name === 'espeak-ng') }); // null when not installed
const T = { timeout: 20000 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

// the shipped first stage with `extra` arguments added at the end, as a one-stage engine
const withArgs = (extra) => ({ name: 'espeak-ng', stages: [[...real.stages[0], ...extra]] });

// size of the wav that espeak-ng writes for `text` using the shipped command line (text only on stdin)
async function wavSize(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'espeak-real-'));
  const out = path.join(dir, 'out.wav');
  const sp = createSpeaker({ engine: withArgs(['-w', out]), log: () => {} });
  try {
    assert.deepEqual(await sp.speak(text), { spoken: true });
    await until(() => !sp.speaking(), 'espeak-ng to finish');
    const head = fs.readFileSync(out).subarray(0, 4).toString('latin1');
    assert.equal(head, 'RIFF');
    return fs.statSync(out).size;
  } finally {
    await sp.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const procs = (needle) => fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).filter((d) => {
  try { return fs.readFileSync(`/proc/${d}/cmdline`, 'latin1').includes(needle); } catch { return false; }
}).map(Number);
const alive = (pid) => {
  try { return !/^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return false; }
};

test('real espeak-ng (asserted only when installed): the shipped command line reads stdin and writes a wav', T, async (t) => {
  if (real === null) { t.diagnostic('espeak-ng not on PATH here: nothing asserted'); return; }
  const small = await wavSize('Hello.');
  const big = await wavSize('Hello there. This is a longer sentence for the speech engine to read.');
  assert.ok(small > 1000, `wav of ${small} bytes`);
  assert.ok(big > small * 2, `longer text gives a longer wav (${small} vs ${big})`);
});

test('real espeak-ng (asserted only when installed): stop ends it and its pipe partner with SIGTERM, no process left', T, async (t) => {
  if (real === null) { t.diagnostic('espeak-ng not on PATH here: nothing asserted'); return; }
  // pitch 37 makes the command line unique; the second stage never reads, so the pipe fills and espeak-ng blocks
  const mark = '-p\u000037';
  const engine = { name: 'espeak-ng', stages: [[...real.stages[0], '-p', '37', '--stdout'], ['sleep', '60']] };
  const sp = createSpeaker({ engine, log: () => {} });
  try {
    assert.deepEqual(await sp.speak(`${'This sentence is long enough to fill a pipe. '.repeat(200)}`), { spoken: true });
    await until(() => procs(mark).length === 1, 'espeak-ng to be running');
    const [pid] = procs(mark);
    await sleep(300);
    assert.ok(alive(pid), 'still blocked on its output pipe');
    assert.equal(sp.speaking(), true);
    await sp.stop();
    await until(() => !alive(pid), 'espeak-ng to be gone');
    assert.equal(sp.speaking(), false);
    assert.deepEqual(procs(mark).filter(alive), []);
  } finally {
    await sp.close();
  }
});

test('real espeak-ng (asserted only when installed): [[ ]] is phoneme input, < > tags are not markup without -m', T, async (t) => {
  if (real === null) { t.diagnostic('espeak-ng not on PATH here: nothing asserted'); return; }
  // [[h@l'oU]] is read as the phonemes of "hello" (short); the same characters as plain letters take longer
  const phonemes = await wavSize("[[h@l'oU]]");
  const letters = await wavSize(" h@l'oU ");
  assert.ok(phonemes < letters, `phoneme input ${phonemes} bytes, plain text ${letters} bytes`);
  // an SSML pause of 30 s would be over 1.3 MB of silence at 22.05 kHz 16 bit; it is spoken as words instead
  const tag = await wavSize('x <break time="30s"/> y');
  assert.ok(tag < 600000, `tag text gave ${tag} bytes`);
});

test('real espeak-ng (asserted only when installed): text.js never lets [[ ]] reach the engine', T, async (t) => {
  if (real === null) { t.diagnostic('espeak-ng not on PATH here: nothing asserted'); return; }
  const said = permissionText({ tool: 'Bash', command: "echo [[h@l'oU]] <b>" });
  assert.ok(!/\[\[|\]\]|[<>]/.test(said), said);
  assert.ok(await wavSize(said) > 1000);
});

test('the shipped espeak-ng engine reads stdin (no text argument) and needs no file', () => {
  const e = shipped.engines.find((x) => x.name === 'espeak-ng');
  assert.ok(e);
  assert.deepEqual(e.stages[0].slice(0, 1), ['espeak-ng']);
  assert.ok(!e.stages[0].slice(1).some((a) => /^[^-]/.test(a) && !['en-us', '165'].includes(a)), 'only options, no text');
});
