// The laptop key cheatsheet (`bash emulator/run.sh --keys`): one screen, generated from the laptop key map
// (config/buttons.laptop.json: which key is which button, and which buttons have a hold / long hold) and from
// the demo scenes (emulator/demo/scenes.js).
//
// What a gesture DOES lives in code (the board's reduceNav in src/state/board.js, dispatch in
// src/sessions/actions.js), as if-chains, not as a table anywhere. So the words for it are here, in ONE table
// beside the map, and buildSheet() throws when a mapped button, or a hold / long hold the map gives it, has no
// label (tests/unit/emulator-keys-sheet.test.js), so a new key cannot be left off the sheet.
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DEFAULT_MAP = `${ROOT}config/buttons.laptop.json`;
export const DEFAULT_SCENES = `${ROOT}emulator/demo/scenes.js`;

// button -> what its tap / hold / long hold does (each at most 14 characters, so a row fits 80 columns)
export const LABELS = {
  up: { tap: 'list / up' },
  down: { tap: 'list / down' },
  left: { tap: 'prev session' },
  right: { tap: 'next session' },
  press: { tap: 'allow / choose' },
  back: { tap: 'back', hold: 'home' },
  'push-to-talk': { tap: 'talk' },
  'read-aloud': { tap: 'read aloud', hold: 'stop speech' },
  cancel: { tap: 'Esc to Claude', longHold: 'Ctrl+C' },
  deny: { tap: 'deny' },
  menu: { tap: 'menu' },
};

const pad = (s, n) => String(s).padEnd(n);

export async function buildSheet({ mapPath = DEFAULT_MAP, scenesPath = DEFAULT_SCENES } = {}) {
  const m = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const holdMs = m.timing?.holdMs ?? 400;
  const longMs = m.timing?.longHoldMs ?? 1000;
  const out = [];
  out.push(`Click the window first. Tap = press and release; hold = ${holdMs / 1000} s, long hold = ${longMs / 1000} s.`);
  out.push(`${pad('KEY', 10)}${pad('BUTTON', 14)}${pad('TAP', 16)}${pad('HOLD', 13)}LONG HOLD`);
  for (const b of m.buttons) {
    const l = LABELS[b.button];
    if (!l?.tap) throw new Error(`keys sheet: no label for button ${b.button}`);
    if (b.hold && !l.hold) throw new Error(`keys sheet: no label for ${b.button} hold`);
    if (b.longHold && !l.longHold) throw new Error(`keys sheet: no label for ${b.button} long hold`);
    out.push(`${pad(b.key, 10)}${pad(b.button, 14)}${pad(l.tap, 16)}${pad(b.hold ? l.hold : '', 13)}${b.longHold ? l.longHold : ''}`.trimEnd());
  }
  const { buildLoop } = await import(pathToFileURL(scenesPath).href);
  const names = buildLoop(1).map((s) => s.name);
  out.push('Demo keys (demo mode only; the demo player takes them, not the bar):');
  out.push(`  1-${names.length}  jump: ${names.slice(0, 7).join(', ')},`);
  out.push(`       ${names[7]} (mid-turn auto), ${names[8]} (/compact at the prompt)`);
  out.push('  P  pause / continue          [  slower          ]  faster');
  out.push('In the demo these change the screen: Left, Right, Up, Down, M, Backspace held');
  out.push('(go to the session that needs you most). Enter picks a row in a list or menu.');
  out.push('Enter, N, Esc, Space on a permission or done screen only log the gesture');
  out.push('in the demo: nothing is sent to a Claude. With --live they go to the run\'s');
  out.push('own Claude: Enter allows a shown permission, N denies, Esc and Space are sent.');
  out.push('R reads aloud only after Left/Right has chosen a session, and only with');
  out.push('espeak-ng, or Piper installed as config/speech.json says.');
  return `${out.join('\n')}\n`;
}

// node emulator/keys-sheet.js [map.json]: print the sheet (run.sh --keys does this)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildSheet({ mapPath: process.argv[2] ?? DEFAULT_MAP }).then((s) => process.stdout.write(s), (e) => {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  });
}
