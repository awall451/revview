import test from 'node:test';
import assert from 'node:assert/strict';
import { middleEllipsis, fitPrefix, formatCount, formatElapsed, elapsedWords, quietMinutes } from '../../src/view/fit.js';

const maxLen = (n) => (s) => Array.from(s).length <= n;
const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

test('already fitting text is unchanged', () => {
  assert.equal(middleEllipsis('src/app.py', maxLen(20)), 'src/app.py');
});

test('keeps the file name and as much leading directory as fits', () => {
  const out = middleEllipsis('src/very/long/directory/file.py', maxLen(20));
  assert.ok(out.endsWith('…/file.py'), out);
  assert.equal(Array.from(out).length, 20);
  assert.ok(out.startsWith('src/very'), out);
});

test('falls back to …/basename when no prefix fits', () => {
  assert.equal(middleEllipsis('a/b/c/file.py', maxLen(9)), '…/file.py');
});

test('cuts a too-long basename in the middle keeping the extension', () => {
  const out = middleEllipsis('dir/abcdefghijklmnopqrstuvwxyz.py', maxLen(9));
  assert.ok(Array.from(out).length <= 9, out);
  assert.ok(out.includes('…'));
  assert.ok(out.endsWith('xyz.py'), out);
  assert.ok(out.startsWith('ab'), out);
});

test('a long name without slash is cut in the middle', () => {
  const out = middleEllipsis('x'.repeat(100) + '.txt', maxLen(12));
  assert.ok(Array.from(out).length <= 12, out);
  assert.ok(out.endsWith('.txt'));
  assert.ok(out.includes('…'));
  assert.ok(out.startsWith('xxx'));
});

test('never splits surrogate pairs', () => {
  const name = '😀'.repeat(20) + '.py';
  for (let n = 4; n < 24; n++) {
    const out = middleEllipsis(`d/${name}`, maxLen(n));
    assert.ok(!lone.test(out), `${n}: ${out}`);
  }
});

test('CJK paths keep the file name end', () => {
  const out = middleEllipsis('日本語のディレクトリ/とても長いファイル名のテスト.txt', maxLen(12));
  assert.ok(Array.from(out).length <= 12, out);
  assert.ok(out.endsWith('.txt'), out);
});

test('empty and non-string input', () => {
  assert.equal(middleEllipsis('', maxLen(3)), '');
  assert.equal(middleEllipsis(null, maxLen(3)), '');
});

test('formatCount', () => {
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(42), '42');
  assert.equal(formatCount(9999), '9999');
  assert.equal(formatCount(10000), '10.0k');
  assert.equal(formatCount(12345), '12.3k');
  assert.equal(formatCount(99999), '99.9k');
  assert.equal(formatCount(100000), '100k');
  assert.equal(formatCount(999999), '999k');
  assert.equal(formatCount(1000000), '1.0M');
  assert.equal(formatCount(999999999), '999M');
  assert.equal(formatCount(1234567), '1.2M');
  assert.equal(formatCount(12345678901), '12G');
  assert.equal(formatCount(-5), '0');
  assert.equal(formatCount('x'), '0');
});

test('cuts never strand a combining mark, split a ZWJ emoji or a flag', () => {
  const fam = '\u{1F468}‍\u{1F469}‍\u{1F467}';
  const flag = '\u{1F1E9}\u{1F1EA}';
  const names = ['é'.repeat(12) + '.txt', `${fam.repeat(5)}.md`, `${flag.repeat(5)}.md`];
  const regionals = (t) => Array.from(t).filter((c) => /[\u{1F1E6}-\u{1F1FF}]/u.test(c)).length;
  for (const name of names) {
    for (let n = 3; n < Array.from(name).length; n++) {
      const out = middleEllipsis(name, (s) => Array.from(s).length <= n);
      const [head, tail = ''] = out.split('…');
      assert.ok(!/^[̀-ͯ‍]/.test(tail), `stray mark after ellipsis: ${JSON.stringify(out)}`);
      assert.ok(!head.endsWith('‍'), `split ZWJ: ${JSON.stringify(out)}`);
      assert.ok(!lone.test(out), `lone surrogate: ${JSON.stringify(out)}`);
      assert.equal(regionals(head) % 2, 0, `split flag: ${JSON.stringify(out)}`);
      assert.equal(regionals(tail) % 2, 0, `split flag: ${JSON.stringify(out)}`);
    }
  }
});

test('fitWhere: full text when it fits', async () => {
  const { fitWhere } = await import('../../src/view/fit.js');
  assert.equal(fitWhere('rev', 'main', maxLen(40)), 'rev · main');
  assert.equal(fitWhere('rev', '', maxLen(40)), 'rev');
});

test('fitWhere: keeps the repo whole and the end of the branch', async () => {
  const { fitWhere } = await import('../../src/view/fit.js');
  const out = fitWhere('revview', 'feature/very-long-branch-name-2026', maxLen(24));
  assert.equal(Array.from(out).length, 24);
  assert.ok(out.startsWith('revview · feat'), out);
  assert.ok(out.endsWith('name-2026'), out);
  assert.ok(out.includes('…'));
});

test('fitWhere: null when even a minimal cut does not fit; never splits graphemes', async () => {
  const { fitWhere } = await import('../../src/view/fit.js');
  assert.equal(fitWhere('a-very-long-repository', 'abcdefghij', maxLen(10)), null);
  const out = fitWhere('r', 'éééééééé', maxLen(9));
  assert.ok(!/^́|…́/u.test(out), out);
});

test('fitPrefix: fitting text is unchanged, empty stays empty', () => {
  assert.equal(fitPrefix('make build', maxLen(20)), 'make build');
  assert.equal(fitPrefix('', maxLen(0)), '');
  assert.equal(fitPrefix(undefined, maxLen(5)), '');
});

test('fitPrefix: the largest prefix plus an ellipsis that fits', () => {
  const out = fitPrefix('abcdefghijklmnop', maxLen(8));
  assert.equal(out, 'abcdefg…');
  assert.equal(fitPrefix('abcdefghijklmnop', maxLen(2)), 'a…');
});

test('fitPrefix: nothing fits gives just the ellipsis; no trailing space before it', () => {
  assert.equal(fitPrefix('abcdef', maxLen(0)), '…');
  assert.equal(fitPrefix('ab cd ef gh', maxLen(6)), 'ab cd…');
});

test('fitPrefix: never splits a grapheme (emoji ZWJ sequence, flag, combining mark)', () => {
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
  const text = `a${family}${family}${family}`;
  for (let n = 1; n <= 9; n++) {
    const out = fitPrefix(text, (s) => Array.from(s).length <= n);
    assert.ok(!lone.test(out), `lone surrogate at n=${n}`);
    const kept = out.slice(0, -1);
    assert.ok(kept === '' || kept === 'a' || kept === `a${family}` || kept === `a${family}${family}`, `split cluster: ${JSON.stringify(out)}`);
  }
  const accent = 'e\u0301e\u0301e\u0301e\u0301';
  const out = fitPrefix(accent, (s) => Array.from(s).length <= 4);
  assert.equal(out, 'e\u0301…');
});

test('formatElapsed: m:ss under an hour, 1h05 under 100 h, 99h+ from 100 h, 0:00 for negative, empty when unknown', () => {
  const s = 1000;
  const m = 60 * s;
  const h = 60 * m;
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(7 * s), '0:07');
  assert.equal(formatElapsed(7999), '0:07');
  assert.equal(formatElapsed(12 * m + 34 * s), '12:34');
  assert.equal(formatElapsed(59 * m + 59 * s + 999), '59:59');
  assert.equal(formatElapsed(h), '1h00');
  assert.equal(formatElapsed(h + 5 * m), '1h05');
  assert.equal(formatElapsed(23 * h + 59 * m + 59 * s), '23h59');
  assert.equal(formatElapsed(99 * h + 59 * m + 59 * s), '99h59');
  assert.equal(formatElapsed(100 * h), '99h+');
  assert.equal(formatElapsed(1e12), '99h+');
  assert.equal(formatElapsed(-5 * s), '0:00');
  assert.equal(formatElapsed(-1e12), '0:00');
  for (const bad of [NaN, Infinity, null, undefined, '5', {}]) assert.equal(formatElapsed(bad), '');
});

test('elapsedWords and quietMinutes', () => {
  assert.equal(elapsedWords(754000), 'In this state for 12 min 34 s');
  assert.equal(elapsedWords(7000), 'In this state for 7 s');
  assert.equal(elapsedWords(3900000), 'In this state for 1 h 5 min');
  assert.equal(elapsedWords(100 * 3600000), 'In this state for 100 h or more');
  assert.equal(elapsedWords(-1), 'In this state for 0 s');
  assert.equal(elapsedWords(NaN), '');
  assert.equal(quietMinutes(0), '1');
  assert.equal(quietMinutes(59999), '1');
  assert.equal(quietMinutes(7 * 60000 + 5000), '7');
  assert.equal(quietMinutes(99 * 60000), '99');
  assert.equal(quietMinutes(100 * 60000), '99+');
  assert.equal(quietMinutes(-5), '1');
  assert.equal(quietMinutes(undefined), '');
});
