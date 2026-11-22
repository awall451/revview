import test from 'node:test';
import assert from 'node:assert/strict';
import { reduce, initialState, initialBoard, reduceBoard, boardView } from '../../src/state/index.js';
import { shortenUrl, shortenQuery, displayTool } from '../../src/state/format.js';

const CWD = '/tmp/revrec/repo';
const call = (tool_name, tool_input) => ({ session_id: 's', cwd: CWD, tool_name, tool_input, tool_use_id: 'toolu_1' });
const ev = (name, c) => ({ hook_event_name: name, ...c });

test('shortenUrl: host + path without scheme or query; other input raw and cleaned', () => {
  assert.equal(shortenUrl('https://example.com/api/docs?x=1#top'), 'example.com/api/docs');
  assert.equal(shortenUrl('http://example.com:8080/'), 'example.com:8080');
  assert.equal(shortenUrl('ftp://example.com/a'), 'ftp://example.com/a');
  assert.equal(shortenUrl('not a url\u0007\n'), 'not a url');
  assert.equal(shortenUrl('x'.repeat(500)).length, 200);
  assert.equal(shortenUrl(5), null);
  assert.equal(shortenQuery('a\u0000b\nc'), 'abc');
  assert.equal(shortenQuery('q'.repeat(300)).length, 200);
});

test('displayTool: MCP names read server: tool', () => {
  assert.equal(displayTool('mcp__github__create_issue'), 'github: create_issue');
  assert.equal(displayTool('Bash'), 'Bash');
});

test('state: WebFetch, WebSearch and MCP on PreToolUse and PermissionRequest; no Bash command', () => {
  const bash = reduce(initialState(), ev('PreToolUse', call('Bash', { command: 'ls' })));
  for (const name of ['PreToolUse', 'PermissionRequest']) {
    const f = reduce(bash, ev(name, call('WebFetch', { url: 'https://example.com/api/docs' })));
    assert.equal(f.tool, 'WebFetch');
    assert.equal(f.file, 'example.com/api/docs');
    if (name === 'PermissionRequest') assert.equal(f.command, null);
    assert.equal(reduce(bash, ev(name, call('WebSearch', { query: 'node test runner' }))).file, 'node test runner');
    const m = reduce(bash, ev(name, call('mcp__github__create_issue', { title: 'Fix' })));
    assert.equal(m.tool, 'github: create_issue');
    assert.equal(m.file, null);
    if (name === 'PermissionRequest') assert.equal(m.command, null);
  }
});

test('board: pending prompt carries the readable tool; matching still uses the real name', () => {
  const c = call('mcp__github__create_issue', { title: 'Fix' });
  let b = reduceBoard(initialBoard(), ev('PreToolUse', c));
  b = reduceBoard(b, ev('PermissionRequest', c));
  assert.equal(boardView(b).tool, 'github: create_issue');
  assert.equal(boardView(reduceBoard(b, ev('PostToolUse', c))).activity, 'working');
  const w = call('WebFetch', { url: 'https://example.com/a?b=1' });
  b = reduceBoard(initialBoard(), ev('PreToolUse', w));
  b = reduceBoard(b, ev('PermissionRequest', w));
  const v = boardView(b);
  assert.equal(v.tool, 'WebFetch');
  assert.equal(v.file, 'example.com/a');
});
