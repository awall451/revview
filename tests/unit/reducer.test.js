import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, replay, STATES, isState, isDriverPrompt } from '../../src/state/index.js';

const CWD = '/tmp/revrec/repo';
const e = (hook_event_name, extra = {}) => ({ hook_event_name, cwd: CWD, ...extra });
const run = (events, s = initialState()) => events.reduce((acc, ev) => reduce(acc, ev), s);

const PERMISSION_NOTIFICATION = { session_id: 's', cwd: CWD, hook_event_name: 'Notification', message: 'Claude needs your permission', notification_type: 'permission_prompt' };
const IDLE_NOTIFICATION = { session_id: 's', hook_event_name: 'Notification', message: 'Claude is waiting for your input', notification_type: 'idle_prompt' };

const EDIT_INPUT = { file_path: `${CWD}/src/app.py`, old_string: 'a', new_string: 'b' };
const EDIT_RESPONSE = { structuredPatch: [{ lines: [' x', '-a', '+b'] }] };

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

test('initialState', () => {
  assert.deepEqual(initialState(), {
    view: 'unknown', activity: 'unknown', offline: false, locked: false, repo: null, branch: null,
    tool: null, file: null, diff: { added: 0, removed: 0 }, command: null, output: null, outputLines: [], failed: null, compacting: false,
  });
  assert.notEqual(initialState(), initialState());
  assert.ok(isState(initialState().view));
  assert.equal(STATES.length, 10);
});

test('SessionStart -> waiting, sets repo, keeps per-turn data', () => {
  const s = run([e('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'a.js' } })]);
  const s2 = reduce(s, e('SessionStart'));
  assert.equal(s2.activity, 'waiting');
  assert.equal(s2.view, 'waiting');
  assert.equal(s2.repo, 'repo');
  assert.equal(s2.tool, 'Read');
});

test('repo is the last path segment of cwd, trailing slash ignored', () => {
  assert.equal(reduce(null, e('SessionStart', { cwd: '/a/b/proj/' })).repo, 'proj');
  assert.equal(reduce(null, e('SessionStart', { cwd: '/' })).repo, null);
  assert.equal(reduce(null, { hook_event_name: 'SessionStart' }).repo, null);
});

test('UserPromptSubmit -> working and resets the turn', () => {
  const s = run([
    e('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }),
    e('PostToolUse', { tool_name: 'Edit', tool_input: EDIT_INPUT, tool_response: EDIT_RESPONSE }),
  ]);
  assert.deepEqual(s.diff, { added: 1, removed: 1 });
  const t = reduce(s, e('UserPromptSubmit', { prompt: 'x' }));
  assert.equal(t.activity, 'working');
  assert.deepEqual(t.diff, { added: 0, removed: 0 });
  assert.equal(t.tool, null);
  assert.equal(t.file, null);
  assert.equal(t.command, null);
  assert.equal(t.output, null);
});

test('PreToolUse sets tool, relative+shortened file, Bash command', () => {
  const s = reduce(null, e('PreToolUse', { tool_name: 'Read', tool_input: { file_path: `${CWD}/src/app.py` } }));
  assert.equal(s.activity, 'working');
  assert.equal(s.tool, 'Read');
  assert.equal(s.file, 'src/app.py');
  const long = reduce(s, e('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: `${CWD}/${'d/'.repeat(120)}src/components/Button.jsx` } }));
  assert.ok(long.file.length <= 200 && long.file.endsWith('Button.jsx') && long.file.startsWith('…/'));
  const abs = reduce(s, e('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/etc/hosts' } }));
  assert.equal(abs.file, '/etc/hosts');
  const nb = reduce(s, e('PreToolUse', { tool_name: 'NotebookEdit', tool_input: { notebook_path: `${CWD}/n.ipynb` } }));
  assert.equal(nb.file, 'n.ipynb');
  const none = reduce(s, e('PreToolUse', { tool_name: 'Grep', tool_input: { pattern: 'x' } }));
  assert.equal(none.file, null);
  assert.equal(none.tool, 'Grep');
});

test('PreToolUse Bash sets command (collapsed) and clears output; non-Bash keeps them', () => {
  const s = run([
    e('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'echo hi' }, tool_response: { stdout: 'hi\n', stderr: '' } }),
  ]);
  assert.equal(s.output, 'hi');
  const t = reduce(s, e('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls\n  -la' } }));
  assert.equal(t.command, 'ls -la');
  assert.equal(t.output, null);
  const u = reduce(s, e('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'x' } }));
  assert.equal(u.command, 'echo hi');
  assert.equal(u.output, 'hi');
});

test('PermissionRequest -> permission with tool and command; PostToolUse -> working', () => {
  const s = run([
    e('UserPromptSubmit'),
    e('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'rm x' } }),
    e('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm x' } }),
  ]);
  assert.equal(s.activity, 'permission');
  assert.equal(s.view, 'permission');
  assert.equal(s.tool, 'Bash');
  assert.equal(s.command, 'rm x');
  const t = reduce(s, e('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'rm x' }, tool_response: { stdout: '', stderr: '' } }));
  assert.equal(t.activity, 'working');
  assert.equal(t.output, null);
});

test('permission and idle notifications use the real payloads', () => {
  const s = reduce(run([e('UserPromptSubmit')]), PERMISSION_NOTIFICATION);
  assert.equal(s.activity, 'permission');
  const w = reduce(s, IDLE_NOTIFICATION);
  assert.equal(w.activity, 'waiting');
  const p2 = reduce(w, { ...PERMISSION_NOTIFICATION, notification_type: 'worker_permission_prompt' });
  assert.equal(p2.activity, 'permission');
});

test('idle_prompt moves done and permission to waiting', () => {
  const done = run([e('UserPromptSubmit'), e('Stop')]);
  assert.equal(done.activity, 'done');
  assert.equal(reduce(done, IDLE_NOTIFICATION).activity, 'waiting');
  const perm = reduce(null, PERMISSION_NOTIFICATION);
  assert.equal(reduce(perm, IDLE_NOTIFICATION).activity, 'waiting');
});

test('Notification is keyed on notification_type, not on message', () => {
  const s = run([e('UserPromptSubmit')]);
  assert.equal(reduce(s, { hook_event_name: 'Notification', message: 'Claude needs your permission' }), s);
  assert.equal(reduce(s, { hook_event_name: 'Notification', message: 'Claude is waiting for your input', notification_type: 'other' }), s);
  assert.equal(reduce(s, { hook_event_name: 'Notification', notification_type: 42 }), s);
});

test('Stop -> done, then idle -> waiting; SubagentStop after Stop is ignored (same ref)', () => {
  const s = run([e('UserPromptSubmit'), e('Stop')]);
  assert.equal(s.activity, 'done');
  assert.equal(reduce(s, e('SubagentStop', { agent_id: 'a' })), s);
  assert.equal(reduce(s, IDLE_NOTIFICATION).activity, 'waiting');
});

test('StopFailure -> waiting; PermissionDenied -> working', () => {
  assert.equal(run([e('UserPromptSubmit'), e('StopFailure')]).activity, 'waiting');
  const p = run([e('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'x' } }), e('PermissionDenied', { tool_name: 'Bash' })]);
  assert.equal(p.activity, 'working');
});

test('ignored events keep the same reference', () => {
  const s = run([e('UserPromptSubmit')]);
  for (const name of ['SubagentStop', 'SubagentStart', 'SessionEnd', 'PostCompact', 'SomethingNew']) {
    assert.equal(reduce(s, e(name)), s, name);
  }
});

test('unchanged events keep the same reference', () => {
  const s = run([e('UserPromptSubmit'), e('Stop')]);
  assert.equal(reduce(s, e('Stop')), s);
  const w = run([e('UserPromptSubmit')]);
  assert.equal(reduce(w, e('UserPromptSubmit')), w);
  const r = reduce(w, e('PostToolUse', { tool_name: 'Read' }));
  assert.equal(reduce(r, e('PostToolUse', { tool_name: 'Read' })), r);
});

test('diff is counted once per call (Pre + Post) and accumulates over the turn', () => {
  const pre = e('PreToolUse', { tool_name: 'Edit', tool_input: EDIT_INPUT });
  const post = e('PostToolUse', { tool_name: 'Edit', tool_input: EDIT_INPUT, tool_response: EDIT_RESPONSE });
  const s = run([e('UserPromptSubmit'), pre, post]);
  assert.deepEqual(s.diff, { added: 1, removed: 1 });
  assert.deepEqual(reduce(s, post).diff, { added: 2, removed: 2 });
  const w = run([e('UserPromptSubmit'), e('PostToolUse', { tool_name: 'Write', tool_input: { file_path: `${CWD}/n.py`, content: 'a\nb\n' }, tool_response: { type: 'create', content: 'a\nb\n', structuredPatch: [] } })]);
  assert.deepEqual(w.diff, { added: 2, removed: 0 });
  assert.equal(w.file, 'n.py');
});

test('PostToolUse Bash: output is the last ANSI-stripped line, command set from input', () => {
  const s = reduce(null, e('PostToolUse', {
    tool_name: 'Bash',
    tool_input: { command: 'git diff --stat' },
    tool_response: { stdout: ' a | 2 \u001b[32m+\u001b[m\n\u001b[32m2 passed\u001b[0m in 0.01s', stderr: '' },
  }));
  assert.equal(s.command, 'git diff --stat');
  assert.equal(s.output, '2 passed in 0.01s');
});

test('PostToolUseFailure: working, Bash output from error, no diff', () => {
  const s = reduce(null, e('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'false' }, error: 'Exit code 1\nboom' }));
  assert.equal(s.activity, 'working');
  assert.equal(s.output, 'boom');
  assert.deepEqual(s.diff, { added: 0, removed: 0 });
  const t = reduce(null, e('PostToolUseFailure', { tool_name: 'Edit', tool_input: EDIT_INPUT, tool_response: EDIT_RESPONSE, error: 'x' }));
  assert.deepEqual(t.diff, { added: 0, removed: 0 });
  assert.equal(reduce(null, e('PostToolUseFailure', {})).activity, 'unknown');
});

test('unknown tool names are accepted without diff', () => {
  const s = reduce(null, e('PostToolUse', { tool_name: 'FooTool', tool_input: { content: 'a\nb', old_string: 'x' }, tool_response: { structuredPatch: [{ lines: ['+a'] }] } }));
  assert.equal(s.activity, 'working');
  assert.equal(s.tool, 'FooTool');
  assert.equal(s.file, null);
  assert.deepEqual(s.diff, { added: 0, removed: 0 });
  const t = reduce(null, e('PreToolUse', { tool_name: 'mcp__x__y', tool_input: { file_path: 'q/z.txt' } }));
  assert.equal(t.file, 'q/z.txt');
});

test('RevviewContext sets repo and branch only', () => {
  const s = run([e('UserPromptSubmit')]);
  const t = reduce(s, { hook_event_name: 'RevviewContext', cwd: '/home/u/proj', branch: 'main' });
  assert.equal(t.repo, 'proj');
  assert.equal(t.branch, 'main');
  assert.equal(t.activity, 'working');
  assert.equal(reduce(t, { hook_event_name: 'RevviewContext', branch: null }).branch, null);
  assert.equal(reduce(t, { hook_event_name: 'RevviewContext' }), t);
  assert.equal(reduce(t, { hook_event_name: 'RevviewContext', cwd: '/home/u/proj', branch: 'main' }), t);
});

test('RevviewStarting -> starting and clears the turn', () => {
  const s = run([
    e('UserPromptSubmit'),
    e('PostToolUse', { tool_name: 'Edit', tool_input: EDIT_INPUT, tool_response: EDIT_RESPONSE }),
  ]);
  const t = reduce(s, { hook_event_name: 'RevviewStarting' });
  assert.equal(t.activity, 'starting');
  assert.equal(t.view, 'starting');
  assert.deepEqual(t.diff, { added: 0, removed: 0 });
  assert.equal(t.tool, null);
  assert.equal(t.repo, 'repo');
});

test('overlays: locked beats offline beats activity; activity keeps updating underneath', () => {
  let s = run([e('UserPromptSubmit')]);
  s = reduce(s, { hook_event_name: 'RevviewNetwork', online: false });
  assert.equal(s.offline, true);
  assert.equal(s.view, 'offline');
  assert.equal(s.activity, 'working');
  s = reduce(s, e('Stop'));
  assert.equal(s.view, 'offline');
  assert.equal(s.activity, 'done');
  s = reduce(s, { hook_event_name: 'RevviewDataLock', locked: true });
  assert.equal(s.view, 'insert-key');
  s = reduce(s, { hook_event_name: 'RevviewNetwork', online: true });
  assert.equal(s.view, 'insert-key');
  s = reduce(s, e('UserPromptSubmit'));
  assert.equal(s.view, 'insert-key');
  assert.equal(s.activity, 'working');
  s = reduce(s, { hook_event_name: 'RevviewDataLock', locked: false });
  assert.equal(s.view, 'working');
  assert.equal(reduce(s, { hook_event_name: 'RevviewDataLock', locked: false }), s);
  assert.equal(reduce(s, { hook_event_name: 'RevviewNetwork', online: true }), s);
});

test('non-boolean overlay values are ignored', () => {
  const s = initialState();
  assert.equal(reduce(s, { hook_event_name: 'RevviewNetwork', online: 'no' }), s);
  assert.equal(reduce(s, { hook_event_name: 'RevviewNetwork' }), s);
  assert.equal(reduce(s, { hook_event_name: 'RevviewDataLock', locked: 1 }), s);
});

test('malformed inputs never throw and are ignored with the same reference', () => {
  const s = run([e('UserPromptSubmit')]);
  const bad = [
    null, undefined, 42, 'x', [], {}, { hook_event_name: 'Nope' }, { hook_event_name: 42 },
    { hook_event_name: 'PreToolUse' }, { hook_event_name: 'PreToolUse', tool_name: '' },
    { hook_event_name: 'PostToolUse' }, { hook_event_name: 'PermissionRequest', tool_name: 7 },
    { hook_event_name: 'Notification' }, { hook_event_name: 'Notification', notification_type: 'idle' },
  ];
  for (const ev of bad) {
    let out;
    assert.doesNotThrow(() => { out = reduce(s, ev); }, JSON.stringify(ev));
    assert.equal(out, s, JSON.stringify(ev));
  }
});

test('partially valid events apply the valid parts', () => {
  const s = initialState();
  for (const resp of [null, 'text', 42, [], {}]) {
    let out;
    assert.doesNotThrow(() => { out = reduce(s, e('PostToolUse', { tool_name: 'Bash', tool_input: 'oops', tool_response: resp })); });
    assert.equal(out.activity, 'working');
    assert.equal(out.tool, 'Bash');
    assert.deepEqual(out.diff, { added: 0, removed: 0 });
  }
  const t = reduce(s, e('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'x' }, tool_response: 'plain last line\n' }));
  assert.equal(t.output, 'plain last line');
  const u = reduce(s, e('PostToolUse', { tool_name: 'Edit', tool_input: null, tool_response: null }));
  assert.equal(u.activity, 'working');
  assert.equal(reduce(s, { hook_event_name: 'UserPromptSubmit', cwd: 5 }).repo, null);
});

test('reduce with null/undefined/invalid state uses initialState()', () => {
  assert.deepEqual(reduce(null, e('Stop')), reduce(initialState(), e('Stop')));
  assert.deepEqual(reduce(undefined, e('Stop')), reduce(initialState(), e('Stop')));
  assert.deepEqual(reduce('junk', e('Stop')), reduce(initialState(), e('Stop')));
  assert.deepEqual(reduce(null, null), initialState());
});

test('purity: frozen state and event are not mutated', () => {
  const events = [
    e('SessionStart'), e('UserPromptSubmit', { prompt: 'p' }),
    e('PreToolUse', { tool_name: 'Edit', tool_input: { ...EDIT_INPUT } }),
    e('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'x' } }),
    PERMISSION_NOTIFICATION,
    e('PostToolUse', { tool_name: 'Edit', tool_input: { ...EDIT_INPUT }, tool_response: { structuredPatch: [{ lines: ['+a', '-b'] }] } }),
    e('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'x' }, tool_response: { stdout: 'a\nb', stderr: '' } }),
    e('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'x' }, error: 'e' }),
    e('Stop'), IDLE_NOTIFICATION, e('SubagentStop'),
    { hook_event_name: 'RevviewContext', cwd: '/x/y', branch: 'b' },
    { hook_event_name: 'RevviewStarting' },
    { hook_event_name: 'RevviewNetwork', online: false },
    { hook_event_name: 'RevviewDataLock', locked: true },
  ];
  let s = deepFreeze(initialState());
  for (const ev of events) {
    deepFreeze(ev);
    const beforeState = JSON.parse(JSON.stringify(s));
    const beforeEvent = JSON.parse(JSON.stringify(ev));
    s = reduce(s, ev);
    deepFreeze(s);
    assert.ok(s);
    assert.deepEqual(JSON.parse(JSON.stringify(ev)), beforeEvent);
    assert.notEqual(beforeState, s);
  }
  assert.equal(s.view, 'insert-key');
});

test('replay folds and returns the state after each event', () => {
  const events = [e('UserPromptSubmit'), e('Stop')];
  const states = replay(events);
  assert.equal(states.length, 2);
  assert.equal(states[0].activity, 'working');
  assert.equal(states[1].activity, 'done');
  assert.deepEqual(replay([]), []);
  const start = reduce(null, e('SessionStart'));
  assert.equal(replay([e('Stop')], start)[0].repo, 'repo');
});

test('repo: SessionStart and RevviewContext set it; other events only fill a null repo', () => {
  let s = run([e('SessionStart')]);
  assert.equal(s.repo, 'repo');
  s = reduce(s, { hook_event_name: 'UserPromptSubmit', cwd: `${CWD}/sub/dir` });
  assert.equal(s.repo, 'repo');
  s = reduce(s, { hook_event_name: 'RevviewContext', cwd: '/tmp/other' });
  assert.equal(s.repo, 'other');
  s = reduce(s, { hook_event_name: 'SessionStart', cwd: '/tmp/third' });
  assert.equal(s.repo, 'third');
  const mid = reduce(initialState(), { hook_event_name: 'UserPromptSubmit', cwd: CWD });
  assert.equal(mid.repo, 'repo');
});

test('a long cwd-relative path is not cut by the state core', () => {
  const rel = 'packages/frontend/src/components/dashboard/widgets/chartpanel/VeryLongComponentNameHandler.tsx';
  assert.ok(rel.length >= 70 && rel.length < 200);
  const s = run([e('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: `${CWD}/${rel}` } })]);
  assert.equal(s.file, rel);
});

test('an empty or whitespace Bash command clears command and output', () => {
  for (const blank of ['', '   ']) {
    const s = run([
      e('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'echo hi' } }),
      e('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'echo hi' }, tool_response: { stdout: 'hi' } }),
      e('PreToolUse', { tool_name: 'Bash', tool_input: { command: blank } }),
    ]);
    assert.equal(s.command, null);
    assert.equal(s.output, null);
  }
});

test('a Bash event without a string command keeps the previous command', () => {
  const s = run([
    e('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'echo hi' } }),
    e('PostToolUse', { tool_name: 'Bash', tool_input: {} }),
  ]);
  assert.equal(s.command, 'echo hi');
});

// QA round 2 issue 06; payloads from fixtures/sessions/compaction.jsonl (recorded, 2.1.330).
test('SessionStart source compact (auto mid-turn or manual) keeps the activity', () => {
  const working = run([e('SessionStart', { source: 'startup' }), e('UserPromptSubmit', { prompt: 'p' }),
    e('PreToolUse', { tool_name: 'Read', tool_input: { file_path: `${CWD}/a.txt` }, tool_use_id: 't1' })]);
  assert.equal(working.activity, 'working');
  // PreCompact is no longer ignored: it sets the compacting mark and nothing else (board-compaction.test.js)
  const compacting = reduce(working, e('PreCompact', { trigger: 'auto', custom_instructions: null }));
  assert.deepEqual(compacting, { ...working, compacting: true });
  assert.deepEqual(reduce(compacting, e('SessionStart', { source: 'compact' })), working);
  assert.equal(reduce(working, e('SessionStart', { source: 'compact', model: 'claude-haiku-5-5' })), working);
  const done = reduce(working, e('Stop', { background_tasks: [] }));
  assert.equal(reduce(done, e('SessionStart', { source: 'compact' })), done);
  for (const source of ['startup', 'resume', 'clear', undefined]) {
    assert.equal(reduce(working, e('SessionStart', { source })).activity, 'waiting', String(source));
  }
});

// Async subagents (fixtures/sessions/subagent-permission.jsonl): the main turn stops while they run.
test('Stop while background subagents run -> working; with none running -> done', () => {
  const s = run([e('UserPromptSubmit', { prompt: 'p' })]);
  const running = { id: 'a1', type: 'subagent', status: 'running', description: 'd', agent_type: 'general-purpose' };
  assert.equal(reduce(s, e('Stop', { background_tasks: [running] })).activity, 'working');
  assert.equal(reduce(s, e('Stop', { background_tasks: [] })).activity, 'done');
  assert.equal(reduce(s, e('Stop', { background_tasks: [{ ...running, status: 'completed' }] })).activity, 'done');
  // a background shell (a dev server) is not Claude working on the turn
  assert.equal(reduce(s, e('Stop', { background_tasks: [{ ...running, type: 'shell' }] })).activity, 'done');
  assert.equal(reduce(s, e('Stop', { background_tasks: [null, 'x'] })).activity, 'done');
});

test('a task-notification prompt (injected when a subagent ends) continues the turn without a reset', () => {
  const s = run([e('UserPromptSubmit', { prompt: 'p' }),
    e('PostToolUse', { tool_name: 'Edit', tool_input: EDIT_INPUT, tool_response: EDIT_RESPONSE }), e('Stop')]);
  assert.equal(isDriverPrompt(e('UserPromptSubmit', { prompt: 'p' })), true);
  const inj = e('UserPromptSubmit', { prompt: '<task-notification>\n<task-id>a1</task-id>\n</task-notification>' });
  assert.equal(isDriverPrompt(inj), false);
  const t = reduce(s, inj);
  assert.equal(t.activity, 'working');
  assert.deepEqual(t.diff, { added: 1, removed: 1 });
  assert.equal(t.tool, 'Edit');
  // the schema's optional source: only "user" (or none) is the driver
  assert.equal(isDriverPrompt(e('UserPromptSubmit', { prompt: 'p', source: 'user' })), true);
  assert.equal(isDriverPrompt(e('UserPromptSubmit', { prompt: 'p', source: 'system' })), false);
  assert.deepEqual(reduce(s, e('UserPromptSubmit', { prompt: 'p', source: 'loop_wakeup' })).diff, { added: 1, removed: 1 });
  assert.equal(isDriverPrompt(e('Stop')), false);
  assert.equal(isDriverPrompt(null), false);
});

test('outputLines: last 3 lines of a Bash result, output is the last one, cleared by PreToolUse and new turn', () => {
  const r = { stdout: 'a\nb\n\u001b[32mc\u001b[0m\nd\n' };
  const s = reduce(initialState(), e('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'x' }, tool_response: r }));
  assert.deepEqual(s.outputLines, ['b', 'c', 'd']);
  assert.equal(s.output, 'd');
  const same = reduce(s, e('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'x' }, tool_response: r }));
  assert.equal(same, s, 'equal outputLines keep the identity');
  const pre = reduce(s, e('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'y' } }));
  assert.deepEqual(pre.outputLines, []);
  assert.equal(pre.output, null);
  const f = reduce(pre, e('PostToolUseFailure', { tool_name: 'Bash', error: 'l1\nl2' }));
  assert.deepEqual(f.outputLines, ['l1', 'l2']);
  assert.equal(f.output, 'l2');
  const nb = reduce(s, e('PostToolUse', { tool_name: 'Read', tool_input: { file_path: '/a' } }));
  assert.deepEqual(nb.outputLines, ['b', 'c', 'd']);
  const t = reduce(s, e('UserPromptSubmit', { prompt: 'go' }));
  assert.deepEqual(t.outputLines, []);
  assert.equal(t.output, null);
  assert.equal(reduce(t, e('Notification', { notification_type: 'other' })), t);
});

// QA r3-05: a failed turn stays WAITING, with `failed` built only from the recorded StopFailure payload
test('StopFailure sets failed {error, message}; the turn fields stay', () => {
  const s = run([e('UserPromptSubmit', { prompt: 'x' }), e('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }),
    e('StopFailure', { error: 'rate_limit', last_assistant_message: '  API Error: slow down\n\u001b[31mnow  ' })]);
  assert.equal(s.activity, 'waiting');
  assert.equal(s.view, 'waiting');
  assert.deepEqual(s.failed, { error: 'rate_limit', message: 'API Error: slow downnow' });
  assert.equal(s.tool, 'Bash');
  assert.equal(s.command, 'ls');
  assert.equal(initialState().failed, null);
});

test('StopFailure: error only from /^[a-z_]{1,40}$/, message cut to 200 and null when absent', () => {
  const f = (extra) => run([e('StopFailure', extra)]).failed;
  assert.deepEqual(f({}), { error: 'unknown', message: null });
  assert.deepEqual(f({ error: 'Bad Error!', last_assistant_message: 42 }), { error: 'unknown', message: null });
  assert.equal(f({ error: 'x'.repeat(41) }).error, 'unknown');
  assert.equal(f({ error: 7 }).error, 'unknown');
  assert.equal(f({ error: 'overloaded', last_assistant_message: 'a'.repeat(500) }).message.length, 200);
  assert.equal(f({ last_assistant_message: ' \n ' }).message, null);
});

test('every other event that changes the turn clears failed', () => {
  const failed = run([e('UserPromptSubmit'), e('StopFailure', { error: 'server_error', last_assistant_message: 'boom' })]);
  assert.ok(failed.failed);
  const after = {
    prompt: e('UserPromptSubmit', { prompt: 'again' }),
    pre: e('PreToolUse', { tool_name: 'Read', tool_input: {} }),
    post: e('PostToolUse', { tool_name: 'Read', tool_input: {} }),
    perm: e('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'x' } }),
    stop: e('Stop'),
    start: e('SessionStart', { source: 'startup' }),
    starting: { hook_event_name: 'RevviewStarting' },
  };
  for (const [k, ev] of Object.entries(after)) assert.equal(reduce(failed, ev).failed, null, k);
  // events that leave the state untouched keep it (same reference)
  assert.equal(reduce(failed, e('SubagentStop')), failed);
  assert.equal(reduce(failed, e('SessionStart', { source: 'compact' })), failed);
});

test('a command up to 300 code points is kept', () => {
  const cmd = 'echo ' + 'a'.repeat(295);
  assert.equal(reduce(initialState(), e('PreToolUse', { tool_name: 'Bash', tool_input: { command: cmd } })).command, cmd);
});

test('StopFailure message: ANSI stripped, cut by code points (no split surrogate)', () => {
  const s = run([e('StopFailure', { error: 'x', last_assistant_message: '\u001b[31m' + '\u{1F600}'.repeat(250) })]);
  assert.equal(Array.from(s.failed.message).length, 200);
  assert.equal(s.failed.message.includes('['), false);
  assert.equal(s.failed.message.includes('\uFFFD'), false);
});

// QA r6-05: a StopFailure message that is cut ends with an ellipsis, within the 200 code point limit
test('StopFailure message: 330 chars is cut to 199 + an ellipsis; 199 and 200 are unchanged; 201 is cut', () => {
  const msg = (n) => run([e('StopFailure', { error: 'x', last_assistant_message: 'a'.repeat(n) })]).failed.message;
  const cut = msg(330);
  assert.equal(Array.from(cut).length, 200);
  assert.equal(cut, 'a'.repeat(199) + '\u2026');
  assert.equal(msg(200), 'a'.repeat(200));
  assert.equal(msg(199), 'a'.repeat(199));
  assert.equal(msg(201), 'a'.repeat(199) + '\u2026');
});
