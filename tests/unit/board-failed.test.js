import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { replayView } from '../../src/state/index.js';

// QA r3-05: the two REAL recordings of a failed turn (Claude Code 2.1.330, API unreachable), through the server's function.
const rec = (f) => fs.readFileSync(new URL(`../../fixtures/sessions/hook-wiring/${f}`, import.meta.url), 'utf8')
  .split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));

for (const f of ['events-stop-failure.jsonl', 'events-stop-failure-interactive.jsonl']) {
  test(`${f}: the failed turn is WAITING with failed set, and nothing of an old call under it`, () => {
    const events = rec(f);
    const views = replayView(events);
    assert.equal(events.at(-1).hook_event_name, 'SessionEnd');
    const v = views.at(-2);
    assert.equal(v.view, 'waiting');
    assert.equal(v.failed.error, 'server_error');
    assert.match(v.failed.message, /^API Error: Connection refused/);
    assert.equal(v.tool, null);
    assert.equal(v.file, null);
    assert.equal(v.command, null);
    assert.equal(v.output, v.failed.message);
    assert.deepEqual(v.outputLines, [v.failed.message]);
    assert.equal(views[1].failed, null); // working after the prompt
  });
}

test('a failed turn after a Bash call: the old command and output do not sit under it; the next prompt clears it', () => {
  const A = { session_id: 'A', cwd: '/w/alpha' };
  const bash = { tool_name: 'Bash', tool_input: { command: 'make test' }, tool_use_id: 't1' };
  const evs = [
    { hook_event_name: 'SessionStart', ...A }, { hook_event_name: 'UserPromptSubmit', ...A, prompt: 'go' },
    { hook_event_name: 'PreToolUse', ...A, ...bash },
    { hook_event_name: 'PostToolUse', ...A, ...bash, tool_response: { stdout: '2 passed\n' } },
    { hook_event_name: 'StopFailure', ...A, error: 'rate_limit' },
    { hook_event_name: 'UserPromptSubmit', ...A, prompt: 'again' },
  ];
  const views = replayView(evs);
  assert.equal(views[3].command, 'make test');
  assert.equal(views[4].view, 'waiting');
  assert.deepEqual([views[4].tool, views[4].command, views[4].output, views[4].outputLines], [null, null, null, []]);
  assert.deepEqual(views[4].failed, { error: 'rate_limit', message: null });
  assert.equal(views[5].failed, null);
});

test('an idle_prompt after a failed turn keeps the failed look (Claude Code is still idle, nothing was resent)', () => {
  const A = { session_id: 'A', cwd: '/w/alpha' };
  const views = replayView([
    { hook_event_name: 'SessionStart', ...A }, { hook_event_name: 'UserPromptSubmit', ...A, prompt: 'go' },
    { hook_event_name: 'StopFailure', ...A, error: 'overloaded' },
    { hook_event_name: 'Notification', ...A, notification_type: 'idle_prompt', message: 'Claude is waiting for your input' },
  ]);
  assert.equal(views[3].view, 'waiting');
  assert.deepEqual(views[3].failed, { error: 'overloaded', message: null });
});

test('the flat view has the failed key in every state, also without a session', () => {
  assert.equal(replayView([{ hook_event_name: 'RevviewNetwork', online: true }])[0].failed, null);
});
