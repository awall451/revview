import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, stripAnsi, lastOutputLine, lastOutputLines, shortenCommand, shortenPath } from '../../src/state/format.js';

const REAL_STDOUT =
  ' src/app.py | 2 \u001b[32m+\u001b[m\u001b[31m-\u001b[m\n 1 file changed, 1 insertion(+), 1 deletion(-)\n\u001b[32m2 passed\u001b[0m in 0.01s';

test('LIMITS are frozen and have the agreed values', () => {
  assert.deepEqual({ ...LIMITS }, { path: 200, command: 300, output: 80, outputLines: 3 });
  assert.ok(Object.isFrozen(LIMITS));
});

test('stripAnsi removes CSI sequences', () => {
  assert.equal(stripAnsi('\u001b[32m+\u001b[m\u001b[31m-\u001b[m'), '+-');
  assert.equal(stripAnsi('\u001b[1;38;5;196mred\u001b[0m'), 'red');
});

test('stripAnsi removes OSC sequences (BEL and ST terminated)', () => {
  assert.equal(stripAnsi('a\u001b]0;title\u0007b'), 'ab');
  assert.equal(stripAnsi('a\u001b]8;;http://x\u001b\\link\u001b]8;;\u001b\\b'), 'alinkb');
});

test('stripAnsi removes other ESC pairs and control chars, keeps newline, tab becomes a space', () => {
  assert.equal(stripAnsi('a\u001bMb'), 'ab');
  assert.equal(stripAnsi('a\u0000b\u0007c\u0008d'), 'abcd');
  assert.equal(stripAnsi('a\nb'), 'a\nb');
  assert.equal(stripAnsi('a\tb'), 'a b');
  assert.equal(stripAnsi(42), '');
});

test('lastOutputLine from the real Bash tool_response', () => {
  const resp = { stdout: REAL_STDOUT, stderr: '', interrupted: false, isImage: false, noOutputExpected: false };
  assert.equal(lastOutputLine(resp), '2 passed in 0.01s');
  assert.equal(lastOutputLine(REAL_STDOUT), '2 passed in 0.01s');
});

test('lastOutputLine falls back to stderr when stdout has no non-empty line', () => {
  assert.equal(lastOutputLine({ stdout: '  \n\n', stderr: 'boom\n' }), 'boom');
  assert.equal(lastOutputLine({ stdout: 'out', stderr: 'err' }), 'out');
});

test('lastOutputLine keeps the part after the last carriage return', () => {
  assert.equal(lastOutputLine('10%\r50%\r100% done\nfinal\r  98%  \n'), '98%');
});

test('lastOutputLine returns null for empty or unusable input', () => {
  for (const v of [null, undefined, '', '  \n ', {}, { stdout: '', stderr: '' }, 42, []]) {
    assert.equal(lastOutputLine(v), null);
  }
});

test('lastOutputLine truncates to max with an ellipsis', () => {
  const out = lastOutputLine('x'.repeat(200));
  assert.equal(out.length, LIMITS.output);
  assert.ok(out.endsWith('…'));
  assert.equal(lastOutputLine('abcdefghij', 5), 'abcd…');
  assert.equal(lastOutputLine('abcde', 5), 'abcde');
});

test('shortenCommand collapses whitespace including newlines', () => {
  assert.equal(shortenCommand('  git   status\n  && echo\tdone \n'), 'git status && echo done');
});

test('shortenCommand truncates with an ellipsis', () => {
  const out = shortenCommand('echo ' + 'a'.repeat(400));
  assert.equal(out.length, LIMITS.command);
  assert.ok(out.endsWith('…'));
  assert.equal(shortenCommand('abcdef', 4), 'abc…');
});

test('shortenCommand returns null for empty or non-string', () => {
  for (const v of ['', '   \n', null, undefined, 3]) assert.equal(shortenCommand(v), null);
});

test('shortenPath leaves short paths alone', () => {
  assert.equal(shortenPath('src/app.py'), 'src/app.py');
  assert.equal(shortenPath('a'.repeat(40)), 'a'.repeat(40));
});

test('shortenPath keeps the most trailing segments that fit', () => {
  const p = 'a/very/long/dir/structure/src/components/Button.jsx';
  assert.equal(shortenPath(p, 30), '…/src/components/Button.jsx');
  assert.equal(shortenPath(p, 24), '…/components/Button.jsx');
  assert.equal(shortenPath(p, 20), '…/Button.jsx');
  for (const max of [13, 15, 20, 30, 40]) assert.ok(shortenPath(p, max).length <= max);
});

test('shortenPath with a file name that is too long keeps its tail', () => {
  const out = shortenPath('dir/' + 'n'.repeat(250) + '.js');
  assert.equal(out.length, LIMITS.path);
  assert.ok(out.startsWith('…'));
  assert.ok(out.endsWith('n.js'));
});

test('shortenPath returns null for empty or non-string', () => {
  for (const v of ['', null, undefined, 1, {}]) assert.equal(shortenPath(v), null);
});

test('lastOutputLine handles CRLF output', () => {
  assert.equal(lastOutputLine('a\r\nb\r\n'), 'b');
  assert.equal(lastOutputLine({ stdout: '', stderr: 'err\r\n' }), 'err');
  assert.equal(lastOutputLine('a\r\n\r\n'), 'a');
  assert.equal(lastOutputLine('10%\r50%\r100%\r\n'), '100%');
});

test('stripAnsi handles 8-bit C1 controls', () => {
  assert.equal(stripAnsi('x\u009b31my'), 'xy');
  assert.equal(stripAnsi('a\u0080b\u0090c\u009fd'), 'abcd');
});

test('truncation never splits a surrogate pair', () => {
  const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
  const name = '😀'.repeat(30) + '.txt';
  for (let max = 2; max < 30; max++) {
    const out = shortenPath('/a/b/' + name, max);
    assert.ok(!lone.test(out), `max ${max}`);
    assert.ok(Array.from(out).length <= max);
  }
  for (let max = 2; max < 20; max++) {
    const cmd = shortenCommand('echo ' + '😀'.repeat(50), max);
    assert.ok(!lone.test(cmd), `cmd max ${max}`);
  }
  assert.ok(!lone.test(lastOutputLine('😀'.repeat(100), 11)));
});

const AWKWARD = [
  '', '\n', 'a', 'a\nb\nc\nd\ne', 'a\r\nb\r\nc\r\nd\r\n', 'x\n\n\n  \n\t\n',
  'progress 10%\rprogress 50%\rprogress 100%\ndone\n', 'a\rb\n', 'a\r\r\nb',
  '\u001b[32mgreen\u001b[0m\n\u001b]0;title\u0007after\n', '\u001b]8;;http://x\u001b\\link\n',
  'ctl\u0001\u0002\n\u0000\n', 'a\tb\n\tc\t\n', 'é😀'.repeat(60) + '\nshort',
  { stdout: 'o1\no2', stderr: 'e' }, { stdout: '\n \n', stderr: 'e1\ne2\ne3\ne4' }, { stdout: '', stderr: 'only err' },
  { stdout: 5, stderr: 'e' }, { stderr: 'e' }, {}, null, undefined, 5, true, [], ['a', 'b'], { stdout: [] },
  'a\n'.repeat(1000), 'z'.repeat(10000),
];

test('lastOutputLines: last 3 non-empty lines, oldest first, cleaned like lastOutputLine', () => {
  assert.deepEqual(lastOutputLines('a\n\nb\r\nc\n  \nd\n'), ['b', 'c', 'd']);
  assert.deepEqual(lastOutputLines('a\nb'), ['a', 'b']);
  assert.deepEqual(lastOutputLines('p 1\rp 2\n\u001b[32m2 passed\u001b[0m\n', 2), ['p 2', '2 passed']);
  assert.deepEqual(lastOutputLines({ stdout: ' \n', stderr: 'e1\ne2' }), ['e1', 'e2']);
  assert.deepEqual(lastOutputLines({ stdout: 'o', stderr: 'e1' }), ['o']);
  assert.deepEqual(lastOutputLines('a'.repeat(100) + '\nb', 3, 5), ['aaaa…', 'b']);
  assert.deepEqual(lastOutputLines(null), []);
  assert.deepEqual(lastOutputLines(['a']), []);
  assert.deepEqual(lastOutputLines(''), []);
});

test('lastOutputLines last element equals lastOutputLine for awkward inputs', () => {
  for (const x of AWKWARD) {
    for (const max of [80, 5, 1]) {
      const lines = lastOutputLines(x, 3, max);
      assert.ok(lines.length <= 3);
      assert.equal(lines.at(-1) ?? null, lastOutputLine(x, max), JSON.stringify(x)?.slice(0, 60));
      for (const l of lines) assert.ok(Array.from(l).length <= max && l !== '');
    }
  }
});

test('lastOutputLines is bounded on multi-MB input', () => {
  const many = 'short line\n'.repeat(500000);
  const t0 = Date.now();
  assert.deepEqual(lastOutputLines(many), ['short line', 'short line', 'short line']);
  assert.ok(Date.now() - t0 < 500);
  const big = 'x'.repeat(5 * 1024 * 1024);
  const out = lastOutputLines(big);
  assert.equal(out.length, 1);
  assert.equal(Array.from(out[0]).length, LIMITS.output);
  assert.equal(lastOutputLine(big), out[0]);
  assert.deepEqual(lastOutputLines('a\nb\n' + big + '\n'), ['a', 'b', out[0]].slice(-3));
});
