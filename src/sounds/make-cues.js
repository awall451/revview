// Writes <name>.wav for every cue. Usage: node src/sounds/make-cues.js [dir]  (default: src/sounds/cues/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUE_NAMES, cueWav } from './wav.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function writeCues(dir = path.join(HERE, 'cues')) {
  fs.mkdirSync(dir, { recursive: true });
  return CUE_NAMES.map((name) => {
    const file = path.join(dir, `${name}.wav`);
    const buf = cueWav(name);
    fs.writeFileSync(file, buf);
    return { file, bytes: buf.length };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const { file, bytes } of writeCues(process.argv[2] ? path.resolve(process.argv[2]) : undefined)) {
    console.log(`${file} ${bytes} bytes`);
  }
}
