// The laptop key cheatsheet (`bash emulator/run.sh --keys`): two pages of one screen each, generated from the laptop key map
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

// button -> gesture -> { text, does[, asks][, inList] }: the words on the sheet AND the effect the gesture must really have.
// `does` is what it does on a board where it does something (a permission pending, a list closed...), `asks` what it does
// under CLAUDE ASKS (Up / Down move the highlighted choice, Enter answers it or approves a plan, N cancels it or keeps
// planning), `inList` what it does with the list open. tests/unit/emulator-keys-actions.test.js drives every key of the map
// through the real input layer and the real actions and checks the observed effect against these, so a label that
// no longer tells the truth fails there. A row fits 80 columns.
export const TABLE = {
  up: { tap: { text: 'list / ASKS: choice up', does: 'list-open', asks: 'choice-up' } },
  down: { tap: { text: 'list / ASKS: choice down', does: 'list-open', asks: 'choice-down' } },
  left: { tap: { text: 'prev session', does: 'session-prev' } },
  right: { tap: { text: 'next session', does: 'session-next' } },
  press: { tap: { text: 'allow / choose / ASKS: answer', does: 'allow', asks: 'answer', inList: 'choose' } },
  back: { tap: { text: 'back', does: 'close' }, hold: { text: 'home', does: 'home' } },
  'push-to-talk': { tap: { text: 'talk', does: 'send:Space' } },
  'read-aloud': { tap: { text: 'read aloud', does: 'read-aloud' }, hold: { text: 'stop speech', does: 'read-aloud-stop' } },
  cancel: { tap: { text: 'Esc to Claude', does: 'send:Escape' }, longHold: { text: 'Ctrl+C', does: 'send:C-c' } },
  deny: { tap: { text: 'deny / ASKS: cancel', does: 'deny', asks: 'cancel' } },
  menu: { tap: { text: 'menu', does: 'menu-open' }, hold: { text: 'day/night', does: 'look-toggle' } },
};

// the text-only view of TABLE (button -> { tap, hold, longHold })
export const LABELS = Object.fromEntries(Object.entries(TABLE).map(([b, g]) => [b, Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.text]))]));
// the effect-only view
export const EFFECTS = Object.fromEntries(Object.entries(TABLE).map(([b, g]) => [b, Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.does]))]));

const pad = (s, n) => String(s).padEnd(n);

// Two pages, each at most 24 lines of 80 columns (the --keys screen of a laptop terminal): the key table, then the demo
// keys and the rules.
export async function buildPages({ mapPath = DEFAULT_MAP, scenesPath = DEFAULT_SCENES } = {}) {
  const m = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const holdMs = m.timing?.holdMs ?? 400;
  const longMs = m.timing?.longHoldMs ?? 1000;
  const mapped = new Set(m.buttons.map((b) => b.button));
  const p1 = [];
  p1.push(`Click the window first. Tap = press and release; hold = ${holdMs / 1000} s, long hold = ${longMs / 1000} s.`);
  p1.push(`${pad('KEY', 10)}${pad('BUTTON', 14)}${pad('TAP', 16)}${pad('HOLD', 13)}LONG HOLD`);
  for (const b of m.buttons) {
    const l = LABELS[b.button];
    if (!l?.tap) throw new Error(`keys sheet: no label for button ${b.button}`);
    if (b.hold && !l.hold) throw new Error(`keys sheet: no label for ${b.button} hold`);
    if (b.longHold && !l.longHold) throw new Error(`keys sheet: no label for ${b.button} long hold`);
    for (const g of ['hold', 'longHold']) if (l[g] && !b[g]) throw new Error(`keys sheet: label for ${b.button} ${g}, which the map does not give`);
    p1.push(`${pad(b.key, 10)}${pad(b.button, 14)}${pad(l.tap, 16)}${pad(b.hold ? l.hold : '', 13)}${b.longHold ? l.longHold : ''}`.trimEnd());
  }
  for (const b of Object.keys(TABLE)) if (!mapped.has(b)) throw new Error(`keys sheet: label for ${b}, which no key of the map gives`);
  p1.push('');
  p1.push('ASKS = the CLAUDE ASKS screen: Up and Down move the highlighted choice, Enter');
  p1.push('answers it (or approves a plan), N cancels it (or keeps planning).');
  p1.push('ASKS: several questions, pick-any: terminal.');
  p1.push('-- page 1 of 2: keys; the demo keys and the rules are on page 2 --');

  const { buildLoop, DEMO_KEYS } = await import(pathToFileURL(scenesPath).href);
  const known = new Set(buildLoop(1, { lights: true }).map((s) => s.name));
  const keyLine = (k) => `${k.key} ${k.scene}${k.scene === 'lights' ? ' (only with --lights)' : ''}`;
  for (const k of DEMO_KEYS) if (!known.has(k.scene)) throw new Error(`keys sheet: demo key ${k.key} names no scene (${k.scene})`);
  const p2 = [];
  p2.push('Demo keys (demo mode only; the demo player takes them, not the bar):');
  for (let i = 0; i < DEMO_KEYS.length; i += 2) {
    p2.push(`  ${pad(keyLine(DEMO_KEYS[i]), 26)}${DEMO_KEYS[i + 1] ? keyLine(DEMO_KEYS[i + 1]) : ''}`.trimEnd());
  }
  p2.push('  P  pause / continue          [  slower          ]  faster');
  p2.push('In the demo these change the screen: Left, Right, Up, Down, M, Backspace held');
  p2.push('(to the session needing you most).');
  p2.push('Enter, N, Esc, Space on a permission or done screen only log the gesture');
  p2.push('in the demo: nothing is sent to a Claude. With --live they go to the run\'s');
  p2.push('own Claude: Enter allows a shown permission, N denies, Esc and Space are sent.');
  p2.push('Too early: press again = the bar refuses an answer (Enter, N, or a plan');
  p2.push('approval) that comes right after the prompt appeared; wait, press again.');
  p2.push('R reads aloud only after Left/Right has chosen a session, and only with');
  p2.push('espeak-ng, or Piper installed as config/speech.json says.');
  return [`${p1.join('\n')}\n`, `-- page 2: demo keys and rules --\n${p2.join('\n')}\n`];
}

export async function buildSheet(opts) {
  const [a, b] = await buildPages(opts);
  return `${a}\n${b}`;
}

// node emulator/keys-sheet.js [map.json]: print the sheet (run.sh --keys does this)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildSheet({ mapPath: process.argv[2] ?? DEFAULT_MAP }).then((s) => process.stdout.write(s), (e) => {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  });
}
