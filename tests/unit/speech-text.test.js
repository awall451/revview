import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { permissionText, closingText, spokenText, SPEECH_LIMITS, NOTHING_TO_READ } from '../../src/speech/text.js';
import { createClosingMemo } from '../../src/speech/memo.js';

test('limits are the documented numbers', () => {
  assert.deepEqual(SPEECH_LIMITS, { maxChars: 300, maxSentences: 3, maxCommandChars: 100 });
});

test('permission: Bash command is cleaned and cut at a word boundary', () => {
  assert.equal(permissionText({ tool: 'Bash', file: null, command: 'ls   -la\n\t/tmp' }), 'Permission: Bash ls -la /tmp');
  const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
  const t = permissionText({ tool: 'Bash', file: null, command: long });
  assert.ok(t.endsWith('...'));
  const spoken = t.slice('Permission: Bash '.length, -3);
  assert.ok(spoken.length <= 100);
  assert.ok(long.startsWith(spoken));
  assert.match(long.slice(spoken.length), /^ /, 'cut at a word boundary');
  assert.equal(permissionText({ tool: 'Bash', file: null, command: 'a\u0007b\u0000c' }), 'Permission: Bash abc');
  assert.equal(permissionText({ tool: 'Bash', file: null, command: null }), 'Permission: Bash');
});

test('permission: file tools say the basename only', () => {
  assert.equal(permissionText({ tool: 'Edit', file: '/home/u/proj/src/index.js', command: null }), 'Permission: Edit index.js');
  assert.equal(permissionText({ tool: 'Write', file: 'notes.md', command: null }), 'Permission: Write notes.md');
});

test('permission: tool names are made speakable', () => {
  assert.equal(permissionText({ tool: 'mcp__github__create_issue', file: null, command: null }), 'Permission: mcp github create issue');
  assert.equal(permissionText({ tool: 'WebFetch', file: null, command: null }), 'Permission: WebFetch');
  assert.equal(permissionText({ tool: '!!!', file: null, command: null }), 'Permission: a tool');
  assert.equal(permissionText({}), 'Permission: a tool');
  assert.equal(permissionText(null), 'Permission: a tool');
});

test('closing: the real fixture reads as plain words', () => {
  const lines = fs.readFileSync(new URL('../../fixtures/sessions/working-turn.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean);
  const stop = lines.map((l) => JSON.parse(l)).find((e) => e.hook_event_name === 'Stop');
  const t = closingText(stop.last_assistant_message);
  assert.ok(t.length > 0 && t.length <= 300);
  assert.ok(!t.includes('`') && !t.includes('/'), t);
  assert.ok(!/\s{2}| [,.]/.test(t), t);
});

test('closing: code blocks, urls, paths and links', () => {
  assert.equal(closingText('Done.\n```js\nconst x = 1;\n```\nAll good.'), 'Done. All good.');
  assert.equal(closingText('Done.\n```\nrm -rf /\nstill code'), 'Done.');
  assert.equal(closingText('See https://example.com/a?b=1 now, or www.example.org too.'), 'See now, or too.');
  assert.equal(closingText('I changed src/app.py and ./run.sh and ~/x and README.md and index.js.'), 'I changed and and and and.');
  assert.equal(closingText('Edited C:\\temp\\a.txt today.'), 'Edited today.');
  assert.equal(closingText('Read [the guide](https://x.io/g) and ![pic](a.png) ok.'), 'Read the guide and ok.');
  assert.equal(closingText('It uses `foo()` here.'), 'It uses here.');
});

test('closing: ordinary dots, versions and decimals stay', () => {
  assert.equal(closingText('All done. It scored 2.5 on v1.2.3, e.g. fine.'), 'All done. It scored 2.5 on v1.2.3, e.g. fine.');
});

test('closing: markdown marks are dropped', () => {
  const md = '# Title\n\n> quoted\n\n- **bold** item\n- second _one_\n1. numbered\n\n| a | b |\n|---|---|\n| 1 | 2 |\n<b>x</b>';
  const t = closingText(md);
  assert.ok(!/[#>*_|<]/.test(t), t);
  assert.match(t, /^Title\. quoted\. bold item\./);
  assert.equal(closingText('- second _one_\n2) numbered'), 'second one. numbered.');
  assert.equal(closingText('| a | b |\n|---|---|\n| 1 | 2 |'), 'a b. 1 2.');
});

test('closing: whole sentences, at most 3 and 300 characters', () => {
  assert.equal(closingText('One. Two! Three? Four. Five.'), 'One. Two! Three?');
  const s = 'a'.repeat(140);
  assert.equal(closingText(`${s}. ${s}. ${s}.`), `${s}. ${s}.`);
  assert.equal(closingText('First line\nSecond line\n- third item\nfourth'), 'First line. Second line. third item.');
});

test('closing: one long sentence is cut at a word boundary with dots', () => {
  const long = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ');
  const t = closingText(long);
  assert.ok(t.endsWith('...'));
  const body = t.slice(0, -3);
  assert.ok(body.length <= 300);
  assert.ok(long.startsWith(body));
  assert.match(long.slice(body.length), /^ /);
});

test('closing: junk gives nothing', () => {
  for (const j of [null, undefined, 5, {}, '', '   \n', '```\ncode\n```', '`x`', 'https://a.b/c']) assert.equal(closingText(j), '');
});

test('spokenText: prompt wins, else closing, else the fixed phrase', () => {
  assert.equal(spokenText({ prompt: { tool: 'Edit', file: '/a/b.js', command: null }, closing: 'Hello.' }), 'Permission: Edit b.js');
  assert.equal(spokenText({ prompt: null, closing: 'Hello there.' }), 'Hello there.');
  assert.equal(spokenText({ prompt: null, closing: '```x```' }), NOTHING_TO_READ);
  assert.equal(spokenText({}), NOTHING_TO_READ);
  assert.equal(spokenText(), NOTHING_TO_READ);
  assert.equal(NOTHING_TO_READ, 'Nothing to read.');
});

const stop = (sid, msg) => ({ hook_event_name: 'Stop', session_id: sid, last_assistant_message: msg });

test('memo: Stop stored, SubagentStop ignored, SessionEnd deletes', () => {
  const m = createClosingMemo();
  m.note(stop('a', 'hello'));
  assert.equal(m.get('a'), 'hello');
  m.note({ ...stop('a', 'sub'), hook_event_name: 'SubagentStop' });
  assert.equal(m.get('a'), 'hello');
  assert.equal(m.get('zzz'), null);
  m.note({ hook_event_name: 'SessionEnd', session_id: 'a' });
  assert.equal(m.get('a'), null);
  assert.equal(m.size(), 0);
});

test('memo: oldest evicted, re-insert is newest, long text cut', () => {
  const m = createClosingMemo({ max: 2, maxChars: 5 });
  m.note(stop('a', '1')); m.note(stop('b', '2')); m.note(stop('a', '3'));
  m.note(stop('c', '123456789'));
  assert.equal(m.get('b'), null);
  assert.equal(m.get('a'), '3');
  assert.equal(m.get('c'), '12345');
  assert.equal(m.size(), 2);
});

test('memo: junk never throws and is not stored', () => {
  const m = createClosingMemo();
  for (const j of [null, undefined, 3, 'x', [], {}, stop('', 'x'), stop(5, 'x'), stop('a', 5), { hook_event_name: 'Stop' }, { hook_event_name: 'SessionEnd' }]) m.note(j);
  assert.equal(m.size(), 0);
  assert.equal(m.get(undefined), null);
});

test('closing: single-slash words are spoken, real paths and files are dropped', () => {
  assert.equal(closingText('It was a/b testing and/or something.'), 'It was a b testing and or something.');
  assert.equal(closingText('Use the input/output pair, either/or.'), 'Use the input output pair, either or.');
  assert.equal(closingText('I changed src/speech/text.js and src/text.js and ./x and ~/y and C:\\z ok.'), 'I changed and and and and ok.');
  assert.equal(closingText('I used Node.js and Next.js, not index.js or README.md.'), 'I used Node.js and Next.js, not or.');
});

test('closing: holes are tidied and a dot-word keeps its space', () => {
  assert.equal(closingText('Done (see src/a/b.js) now.'), 'Done now.');
  assert.equal(closingText('Try the .env file.'), 'Try the .env file.');
});

test('speech text never carries [[ ]] or < >', () => {
  assert.equal(closingText('Say [[h@lou]] and <break time="1s"/> then a < b > c.'), 'Say h@lou and then a b c.');
  assert.equal(permissionText({ tool: 'Bash', file: null, command: 'if [[ -f x ]]; then <b>hi</b>' }), 'Permission: Bash if -f x ; then b hi /b');
});
