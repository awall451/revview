// Shared by the --live tests of emulator/run.sh: a private fixture dir with a fresh HOME, a project dir, and a
// `claude` shim on PATH that runs the stand-in (fixtures/sessions/fake-claude-live.js), so no test ever starts the real claude.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FAKE = fileURLToPath(new URL('./fixtures/sessions/fake-claude-live.js', import.meta.url));

export function liveFixture() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'emu-live-fix-')));
  const home = path.join(dir, 'home');
  const proj = path.join(dir, 'proj');
  const shim = path.join(dir, 'shim');
  const log = path.join(dir, 'claude-log');
  for (const d of [home, proj, shim]) fs.mkdirSync(d);
  fs.writeFileSync(path.join(shim, 'claude'), `#!/bin/bash\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(FAKE)} "$@"\n`, { mode: 0o755 });
  return {
    dir, home, proj, shim, log,
    // env entries for start(): the shim first on PATH, a fresh HOME, the stand-in's log dir
    env: { HOME: home, PATH: `${shim}:${process.env.PATH}`, REVVIEW_FAKE_CLAUDE_LOG: log },
    stand: () => {
      try { return JSON.parse(fs.readFileSync(path.join(log, 'info.json'), 'utf8')); } catch { return null; }
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
