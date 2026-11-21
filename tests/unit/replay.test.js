import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initialState, replay } from '../../src/state/index.js';

// Regenerate expected files with REVVIEW_UPDATE_EXPECTED=1 (see src/state/README.md).
const DIR = new URL('../../fixtures/sessions/', import.meta.url);
const UPDATE = process.env.REVVIEW_UPDATE_EXPECTED === '1';

const names = fs.readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -'.jsonl'.length)).sort();

function label(ev) {
  return [ev.hook_event_name, ev.tool_name, ev.notification_type].filter((x) => typeof x === 'string').join(' ');
}

test('there are session recordings', () => {
  assert.ok(names.length >= 3);
});

for (const name of names) {
  test(`replay of ${name}.jsonl matches ${name}.expected.json`, () => {
    const text = fs.readFileSync(new URL(`${name}.jsonl`, DIR), 'utf8');
    const events = text.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
    const states = replay(events, initialState());
    assert.equal(states.length, events.length);
    const actual = events.map((ev, i) => ({ event: label(ev), state: states[i] }));
    const expectedUrl = new URL(`${name}.expected.json`, DIR);
    if (UPDATE) {
      fs.writeFileSync(expectedUrl, JSON.stringify(actual, null, 2) + '\n');
      return;
    }
    assert.ok(fs.existsSync(expectedUrl), `${name}.expected.json is missing`);
    assert.deepEqual(actual, JSON.parse(fs.readFileSync(expectedUrl, 'utf8')));
  });
}
