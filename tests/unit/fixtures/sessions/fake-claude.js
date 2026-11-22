// Stand-in for claude in tmux tests: argv 2 is the log file. Logs argv (JSON line), then each received byte as hex.
import fs from 'node:fs';

const logPath = process.argv[2];
fs.appendFileSync(logPath, JSON.stringify(process.argv.slice(3)) + '\n');
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (buf) => {
  for (const b of buf) fs.appendFileSync(logPath, b.toString(16).padStart(2, '0') + '\n');
});
