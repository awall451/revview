import test from 'node:test';
import assert from 'node:assert/strict';
import { countDiff, lineCount } from '../../src/state/diff.js';

const ev = (tool_name, tool_input, tool_response) => ({ hook_event_name: 'PostToolUse', tool_name, tool_input, tool_response });

test('lineCount', () => {
  assert.equal(lineCount('a\nb\n'), 2);
  assert.equal(lineCount('a\nb'), 2);
  assert.equal(lineCount('\n'), 1);
  assert.equal(lineCount('a'), 1);
  assert.equal(lineCount('\n\n'), 2);
  assert.equal(lineCount(''), 0);
  for (const v of [null, undefined, 3, {}, []]) assert.equal(lineCount(v), 0);
});

test('real Edit structuredPatch counts +1 -1', () => {
  const resp = {
    filePath: '/tmp/revrec/repo/src/app.py',
    structuredPatch: [{
      oldStart: 1, oldLines: 6, newStart: 1, newLines: 6,
      lines: [' def greet(name):', '-    return "hello " + name', '+    return f"hello {name}!"', ' ', ' ', ' def add(a, b):'],
    }],
  };
  assert.deepEqual(countDiff(ev('Edit', { file_path: 'x', old_string: 'a\nb\nc', new_string: 'z' }, resp)), { added: 1, removed: 1 });
});

test('real Write create counts the lines of the content', () => {
  const resp = { type: 'create', filePath: '/x', content: '# helpers\n\ndef double(x): return 2 * x\n', structuredPatch: [], originalFile: null };
  assert.deepEqual(countDiff(ev('Write', { file_path: '/x', content: 'ignored' }, resp)), { added: 3, removed: 0 });
});

test('Write create falls back to tool_input.content when the response has none', () => {
  assert.deepEqual(countDiff(ev('Write', { content: 'a\nb\n' }, { type: 'create' })), { added: 2, removed: 0 });
});

test('Write update uses the structuredPatch, several hunks', () => {
  const resp = {
    type: 'update',
    structuredPatch: [
      { lines: ['+a', '+b', ' c', '-d'] },
      { lines: ['-e', '-f', '+g'] },
    ],
  };
  assert.deepEqual(countDiff(ev('Write', { content: 'x' }, resp)), { added: 3, removed: 3 });
});

test('Write update with an empty patch counts 0/0 (no change)', () => {
  assert.deepEqual(countDiff(ev('Write', { content: 'a\nb' }, { type: 'update', structuredPatch: [] })), { added: 0, removed: 0 });
});

test('Edit fallback without tool_response', () => {
  const input = { old_string: 'a\nb', new_string: 'x\ny\nz\n' };
  assert.deepEqual(countDiff(ev('Edit', input)), { added: 3, removed: 2 });
  assert.deepEqual(countDiff(ev('Edit', input, null)), { added: 3, removed: 2 });
  assert.deepEqual(countDiff(ev('Edit', { old_string: 'a', new_string: 'b' }, 'ok')), { added: 1, removed: 1 });
});

test('MultiEdit fallback sums the edits', () => {
  const input = { file_path: 'f', edits: [{ old_string: 'a', new_string: 'b\nc' }, { old_string: 'x\ny', new_string: '' }, null, { old_string: 5 }] };
  assert.deepEqual(countDiff(ev('MultiEdit', input)), { added: 2, removed: 3 });
});

test('Write fallback counts the content', () => {
  assert.deepEqual(countDiff(ev('Write', { content: 'a\nb\nc' })), { added: 3, removed: 0 });
});

test('malformed input gives 0/0', () => {
  const zero = { added: 0, removed: 0 };
  const bad = [null, undefined, 42, 'x', [], {}, ev('Edit'), ev('Edit', null), ev('Edit', 'str'), ev('Write', { content: 7 }),
    ev('Edit', { old_string: 1, new_string: 2 }), ev('MultiEdit', { edits: 'nope' })];
  for (const e of bad) assert.deepEqual(countDiff(e), zero);
});

test('malformed hunks and lines are skipped', () => {
  const resp = { structuredPatch: [null, 5, { lines: 'nope' }, { lines: ['+ok', 7, null, '-ok', ''] }] };
  assert.deepEqual(countDiff(ev('Edit', { old_string: 'a', new_string: 'b' }, resp)), { added: 1, removed: 1 });
});

test('non-edit tools give 0/0', () => {
  for (const t of ['Read', 'Bash', 'Glob', 'Task', 'NotebookEdit', 'mcp__x__y']) {
    const e = ev(t, { content: 'a\nb', old_string: 'a', new_string: 'b' }, { structuredPatch: [{ lines: ['+a'] }] });
    assert.deepEqual(countDiff(e), { added: 0, removed: 0 });
  }
});
