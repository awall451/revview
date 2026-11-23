import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// emulator/keys-sheet.js: the one-screen cheatsheet, generated from config/buttons.laptop.json.
const MAP = fileURLToPath(new URL('../../config/buttons.laptop.json', import.meta.url));
const SCENES = fileURLToPath(new URL('../../emulator/demo/scenes.js', import.meta.url));
const RUN = fileURLToPath(new URL('../../emulator/run.sh', import.meta.url));
const { buildSheet, LABELS } = await import('../../emulator/keys-sheet.js');
const map = JSON.parse(fs.readFileSync(MAP, 'utf8'));

const sheet = () => buildSheet({ mapPath: MAP, scenesPath: SCENES });

test('fits a 24-row terminal: at most 24 lines of at most 80 columns', async () => {
  const lines = (await sheet()).split('\n');
  if (lines.at(-1) === '') lines.pop();
  assert.ok(lines.length <= 24, `${lines.length} lines`);
  for (const l of lines) assert.ok(l.length <= 80, `${l.length} columns: ${l}`);
});

test('every button of the laptop map is in the sheet, with its key and its gestures', async () => {
  const lines = (await sheet()).split('\n');
  for (const b of map.buttons) {
    const row = lines.find((l) => l.startsWith(String(b.key).padEnd(10)) && l.split(/\s+/)[1] === b.button);
    assert.ok(row, `no row for ${b.key} ${b.button}`);
    const text = LABELS[b.button];
    assert.ok(row.includes(text.tap), `${b.button}: tap label ${text.tap}`);
    if (b.hold) assert.ok(text.hold && row.includes(text.hold), `${b.button}: hold label`);
    if (b.longHold) assert.ok(text.longHold && row.includes(text.longHold), `${b.button}: long hold label`);
  }
});

test('a label exists for every mapped button and gesture', () => {
  for (const b of map.buttons) {
    assert.ok(LABELS[b.button]?.tap, `tap label for ${b.button}`);
    if (b.hold) assert.ok(LABELS[b.button].hold, `hold label for ${b.button}`);
    if (b.longHold) assert.ok(LABELS[b.button].longHold, `long-hold label for ${b.button}`);
  }
});

test('a button or gesture without a label makes the sheet fail, naming it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-'));
  try {
    const bad = (buttons) => {
      const p = path.join(dir, 'm.json');
      fs.writeFileSync(p, JSON.stringify({ ...map, buttons }));
      return buildSheet({ mapPath: p, scenesPath: SCENES });
    };
    await assert.rejects(bad([{ key: 'Q', button: 'nonesuch' }]), /nonesuch/);
    await assert.rejects(bad([{ key: 'Up', button: 'up', longHold: true }]), /up.*long hold/);
    await assert.rejects(bad([{ key: 'Up', button: 'up', hold: true }]), /up.*hold/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the labels for the gestures that do something special match the real code', () => {
  assert.match(LABELS.back.hold, /home/i);
  assert.match(LABELS['read-aloud'].hold, /stop/i);
  assert.match(LABELS.cancel.longHold, /Ctrl\+C/);
});

test('the demo keys come from scenes.js: every scene name and the range', async () => {
  const out = await sheet();
  const { buildLoop } = await import('../../emulator/demo/scenes.js');
  const names = buildLoop(1).map((s) => s.name);
  for (const n of names) assert.ok(out.includes(n), n);
  assert.match(out, new RegExp(`1-${names.length}`));
  assert.match(out, /nothing is sent to a Claude/i);
});

test('the footer says what really happens: no variable for speech, what the demo shows and what needs --live', async () => {
  const out = await sheet();
  assert.doesNotMatch(out, /REVVIEW_SPEECH/, 'the server reads config/speech.json by default');
  assert.match(out, /R reads aloud only after Left\/Right has chosen a session/);
  assert.match(out, /Piper installed as config\/speech\.json says/);
  assert.doesNotMatch(out, /speaks on any machine/);
  assert.doesNotMatch(out, /show what the bar would show/);
  assert.match(out, /Left, Right, Up, Down, M, Backspace held/);
  assert.match(out, /Enter, N, Esc, Space on a permission or done screen only log the gesture/);
  assert.match(out, /needs --live/);
});

test('run.sh --keys prints exactly the sheet', async () => {
  const r = spawnSync('bash', [RUN, '--keys'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, await sheet());
});

test('docs/EMULATOR-LAPTOP.md shows the real sheet and the real alias block, and is linked', async () => {
  const doc = fs.readFileSync(new URL('../../docs/EMULATOR-LAPTOP.md', import.meta.url), 'utf8');
  assert.ok(doc.includes(`\`\`\`\n${await sheet()}\`\`\``), 'the guide has the sheet as --keys prints it');
  // the alias block of the guide is the real output for a clone in ~/revview
  const real = spawnSync('bash', [RUN, '--print-aliases'], { encoding: 'utf8' }).stdout;
  const root = path.dirname(path.dirname(RUN));
  const shown = real.split(root).join('~/revview').replace(/^# .*$/m, '# revview emulator');
  assert.ok(doc.includes(`\`\`\`\n${shown}\`\`\``), 'the guide has the alias block');
  const top = fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8').split('\n').slice(0, 4).join('\n');
  assert.match(top, /docs\/EMULATOR-LAPTOP\.md/);
  assert.match(fs.readFileSync(new URL('../../emulator/README.md', import.meta.url), 'utf8'), /docs\/EMULATOR-LAPTOP\.md/);
  // the text says what happens (checked against the code by the fresh-clone QA): no speech variable, every scene's screen,
  // what the demo shows and what needs --live, --stop for every run, -h
  assert.doesNotMatch(doc, /only with\s+`?REVVIEW_SPEECH/);
  assert.doesNotMatch(doc, /show what the bar would show/);
  for (const w of ['WORKING', 'NEEDS PERMISSION', 'DONE', 'WAITING FOR ME', 'OFFLINE', 'INSERT KEY', 'CLAUDE EXITED']) assert.ok(doc.includes(w), w);
  assert.match(doc, /No projects: add paths to the projects file/);
  assert.match(doc, /Backspace \*\*tapped\*\*/);
  assert.match(doc, /`--live`/);
  assert.match(doc, /EVERY `run\.sh`/);
  assert.ok(doc.includes('`-h`'));
  for (const o of ['--port', '--no-browser', '--scale', '--demo', '--live', '--keys', '--print-aliases', '--stop', '--help']) {
    assert.ok(doc.includes(`\`${o}`), `guide mentions ${o}`);
  }
});
