import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProjects, isUnsafeText } from '../../src/sessions/index.js';

function file(t, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-proj-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = path.join(dir, 'projects.json');
  fs.writeFileSync(f, typeof content === 'string' ? content : JSON.stringify(content));
  return f;
}
const load = (f) => {
  const logs = [];
  return { list: loadProjects(f, { log: (m) => logs.push(m) }), logs };
};

test('missing file and malformed JSON give [] and a log line', (t) => {
  const missing = load('/nonexistent-dir-xyz/projects.json');
  assert.deepEqual(missing.list, []);
  assert.equal(missing.logs.length, 1);
  for (const body of ['{nope', '', 'null', '[]', '{"projects": "x"}', '{}']) {
    const r = load(file(t, body));
    assert.deepEqual(r.list, [], body);
    assert.equal(r.logs.length, 1, body);
  }
});

test('valid entries are kept in order; other keys are ignored; one trailing slash is stripped', (t) => {
  const r = load(file(t, { note: 'x', other: 1, projects: ['/a/b', '/c/d/', '/'] }));
  assert.deepEqual(r.list, ['/a/b', '/c/d', '/']);
  assert.deepEqual(r.logs, []);
});

test('bad entries are dropped with a reason, never thrown', (t) => {
  const bad = ['rel/path', './x', '/a/../b', '/a//b', '/a/./b', '/a#b', '/tmp/#(touch x)', '/a\nb', '/a\u0001b', '/a\u007fb', '', 5, null, {}, ['/x'], `/${'x'.repeat(4096)}`];
  const r = load(file(t, { projects: [...bad, '/ok'] }));
  assert.deepEqual(r.list, ['/ok']);
  assert.equal(r.logs.length, bad.length);
});

test('at most 32 entries are kept', (t) => {
  const many = Array.from({ length: 40 }, (_, i) => `/p/${i}`);
  const r = load(file(t, { projects: many }));
  assert.deepEqual(r.list, many.slice(0, 32));
  assert.ok(r.logs.length >= 1);
});

test('isUnsafeText: "#" and control characters', () => {
  for (const s of ['#', 'a#b', '\n', '\u0000', '\u007f', '\u009f']) assert.equal(isUnsafeText(s), true, JSON.stringify(s));
  for (const s of ['', '/a/b c', 'ü']) assert.equal(isUnsafeText(s), false);
});
