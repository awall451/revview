// Preloaded into the server of a long drive (node --import tests/long/clock-skew.js src/server/index.js PORT).
// Date.now() is shifted by LONG_DRIVE_SKEW_MS at start, and on SIGUSR2 by the number of ms in the file
// LONG_DRIVE_SKEW_FILE (an absolute offset, may be negative): the way a Pi's wall clock jumps when it gets the time
// from the network after boot. Only Date.now() moves (what the server's code reads); setTimeout, setInterval and
// performance.now() stay monotonic, as they do on a real system whose clock is stepped.
import fs from 'node:fs';

let skew = Number(process.env.LONG_DRIVE_SKEW_MS ?? 0) || 0;
const real = Date.now.bind(Date);
Date.now = () => real() + skew;
process.on('SIGUSR2', () => {
  const file = process.env.LONG_DRIVE_SKEW_FILE;
  if (file) skew = Number(fs.readFileSync(file, 'utf8')) || 0;
});
