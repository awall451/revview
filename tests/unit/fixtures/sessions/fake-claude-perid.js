// Stand-in for claude: argv 2 is a log DIRECTORY, then `--session-id <id>`. Logs each received byte as hex
// to <dir>/<id>.log, so tests can tell sessions apart.
import fs from 'node:fs';
import path from 'node:path';

const id = process.argv[process.argv.indexOf('--session-id') + 1];
const logPath = path.join(process.argv[2], `${id}.log`);
fs.writeFileSync(logPath, 'started\n');
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (buf) => {
  for (const b of buf) fs.appendFileSync(logPath, b.toString(16).padStart(2, '0') + '\n');
});
