// Cue sounds for the bar, generated as 16-bit mono 22050 Hz PCM WAV. Pure and deterministic: no randomness, no clock.
//   needs  - Claude needs you (a permission prompt or a question): two rising pairs, 660 Hz then 880 Hz.
//   done   - a turn finished: one 880 Hz bell-like tone with a decay.
//   failed - a turn failed: a falling pair, 523 Hz then 330 Hz.
//   quiet  - a working session went quiet (no hook event for a while): three short even taps at 440 Hz.
//   other  - a change in a session that is NOT the selected one: one short, quiet 600 Hz tone.
// The numbers (pitches, lengths, levels) were chosen on the VM and never heard: there is no audio device here.

export const CUE_NAMES = Object.freeze(['needs', 'done', 'failed', 'other', 'quiet']);
export const CUE_FORMAT = { sampleRate: 22050, channels: 1, bitsPerSample: 16 };

const RATE = CUE_FORMAT.sampleRate;
const RAMP_MS = 9;

const count = (ms) => Math.round((RATE * ms) / 1000);
// A tone of `ms` milliseconds; `decay` is the time constant in ms of an exponential fade (0 = flat).
const tone = (hz, ms, amp, decay = 0) => ({ hz, n: count(ms), amp, decay });
const gap = (ms) => ({ n: count(ms) });

const PATTERNS = {
  needs: [tone(660, 120, 0.6), gap(40), tone(880, 120, 0.6), gap(40), tone(660, 120, 0.6), gap(40), tone(880, 120, 0.6)],
  done: [tone(880, 200, 0.5, 60)],
  failed: [tone(523, 180, 0.6), gap(30), tone(330, 180, 0.6)],
  other: [tone(600, 80, 0.2)],
  quiet: [tone(440, 70, 0.4), gap(70), tone(440, 70, 0.4), gap(70), tone(440, 70, 0.4)],
};

function samplesFor(parts) {
  const out = new Int16Array(parts.reduce((a, p) => a + p.n, 0));
  const ramp = count(RAMP_MS);
  let at = 0;
  for (const p of parts) {
    if (p.hz) {
      for (let i = 0; i < p.n; i++) {
        let env = 1;
        if (i < ramp) env = 0.5 - 0.5 * Math.cos((Math.PI * i) / ramp);
        else if (i >= p.n - ramp) env = 0.5 - 0.5 * Math.cos((Math.PI * (p.n - 1 - i)) / ramp);
        if (p.decay) env *= Math.exp((-i / RATE) * (1000 / p.decay));
        const v = Math.round(32767 * p.amp * env * Math.sin((2 * Math.PI * p.hz * i) / RATE));
        out[at + i] = Math.max(-32768, Math.min(32767, v));
      }
    }
    at += p.n;
  }
  return out;
}

export function cueWav(name) {
  if (!CUE_NAMES.includes(name)) throw new Error(`unknown cue: ${name}`);
  const s = samplesFor(PATTERNS[name]);
  const dataLen = s.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0, 'latin1');
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8, 'latin1');
  buf.write('fmt ', 12, 'latin1');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(CUE_FORMAT.channels, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(CUE_FORMAT.bitsPerSample, 34);
  buf.write('data', 36, 'latin1');
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < s.length; i++) buf.writeInt16LE(s[i], 44 + i * 2);
  return buf;
}
