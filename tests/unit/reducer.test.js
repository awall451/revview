import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, replay, STATES, isState } from '../../src/state/index.js';

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
    tool: null, file: null, diff: { added: 0, removed: 0 }, command: null, output: null,
  });
  assert.notEqual(initialState(), initialState());
  assert.ok(isState(initialState().view));
  assert.equal(STATES.length, 9);
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
  const long = reduce(s, e('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: `${CWD}/a/very/long/dir/structure/src/components/Button.jsx` } }));
  assert.ok(long.file.length <= 40 && long.file.endsWith('Button.jsx') && long.file.startsWith('…/'));
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
  for (const name of ['SubagentStop', 'SubagentStart', 'SessionEnd', 'PreCompact', 'PostCompact', 'SomethingNew']) {
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
