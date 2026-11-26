// WS2812B over SPI: encoding and the helper-process driver. Untested on hardware.
import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SPI_HZ = 2400000; // 3 SPI bits per data bit: 1 SPI bit = 416 ns, a data bit = 1.25 us
export const RESET_BYTES = 90; // 90 * 8 * 416 ns = 300 us low (newer WS2812B want >= 280 us)

// G, R, B per LED, MSB first, bit 1 -> 110, bit 0 -> 100 (9 bytes per LED), then RESET_BYTES zero bytes
export function encodeWs2812(frame) {
  const out = Buffer.alloc(frame.length * 9 + RESET_BYTES);
  let pos = 0;
  for (const [r, g, b] of frame) {
    let bits = 0;
    let n = 0;
    for (const byte of [g, r, b]) {
      for (let i = 7; i >= 0; i--) {
        bits = (bits << 3) | (((byte >> i) & 1) ? 0b110 : 0b100);
        n += 3;
        while (n >= 8) { out[pos++] = (bits >> (n - 8)) & 0xff; n -= 8; }
        bits &= (1 << n) - 1;
      }
    }
  }
  return out;
}

export const helperArgv = ({ device, leds, python = 'python3' }) => [
  python, fileURLToPath(new URL('./spi-helper.py', import.meta.url)), '--device', device, '--leds', String(leds), '--hz', String(SPI_HZ),
];

export function createNullDriver() {
  return { show() {}, close: () => Promise.resolve() };
}

// show(frame) sends one hex line per frame to the helper (started on the first show). Any failure: one log line, dead.
export function createSpiDriver({ argv, spawn = nodeSpawn, log = () => {}, timers, leds, closeWaitMs = 1000 }) {
  const setT = timers?.setTimeout ?? setTimeout;
  const clearT = timers?.clearTimeout ?? clearTimeout;
  let child = null;
  let dead = false;
  let closing = false;
  let errLine = '';
  let exited = Promise.resolve();
  let onExit = () => {};

  const die = (reason) => {
    if (dead) return;
    dead = true;
    if (!closing) log(`lights: LED driver stopped (${reason}); the LEDs stay off until the server restarts`);
  };

  function start() {
    try {
      const c = spawn(argv[0], argv.slice(1), { shell: false, stdio: ['pipe', 'ignore', 'pipe'] });
      child = c;
      exited = new Promise((r) => { onExit = r; });
      c.on('error', (e) => { child = null; die(`cannot start: ${e?.code ?? e?.message ?? 'error'}`); onExit(); });
      c.on('exit', (code, signal) => {
        child = null;
        die(`exit ${code ?? signal}${errLine ? `: ${errLine}` : ''}`);
        onExit();
      });
      c.stderr?.on('data', (d) => { if (errLine === '') errLine = String(d).split('\n')[0].trim().slice(0, 200); });
      c.stderr?.on('error', () => {});
      c.stdin?.on('error', (e) => die(`write failed: ${e?.code ?? e?.message ?? 'error'}`));
    } catch (e) {
      child = null;
      die(`cannot start: ${e?.code ?? e?.message ?? 'error'}`);
    }
  }

  const write = (frame) => {
    try { child.stdin.write(`${encodeWs2812(frame).toString('hex')}\n`); } catch (e) { die(`write failed: ${e?.message ?? 'error'}`); }
  };

  return {
    show(frame) {
      if (dead || closing) return;
      if (child === null) start();
      if (child !== null && !dead) write(frame);
    },
    async close() {
      if (closing) return;
      closing = true;
      const c = child;
      if (c === null || dead) return;
      try {
        write(Array.from({ length: leds }, () => [0, 0, 0]));
        c.stdin.end();
      } catch { /* gone already */ }
      let t;
      const timeout = new Promise((r) => { t = setT(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } r(); }, closeWaitMs); });
      await Promise.race([exited, timeout]);
      clearT(t);
    },
  };
}
