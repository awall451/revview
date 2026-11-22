import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, stripAnsi, lastOutputLine, shortenCommand, shortenPath } from '../../src/state/format.js';

const REAL_STDOUT =
  ' src/app.py | 2 \u001b[32m+\u001b[m\u001b[31m-\u001b[m\n 1 file changed, 1 insertion(+), 1 deletion(-)\n\u001b[32m2 passed\u001b[0m in 0.01s';

test('LIMITS are frozen and have the agreed values', () => {
  assert.deepEqual({ ...LIMITS }, { path: 200, command: 60, output: 80 });
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
  const out = shortenCommand('echo ' + 'a'.repeat(100));
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
