import test from 'node:test';
import assert from 'node:assert/strict';
import { middleEllipsis, formatCount } from '../../src/view/fit.js';

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
