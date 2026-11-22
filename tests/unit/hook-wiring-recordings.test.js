// Replays the REAL Claude Code sessions in fixtures/sessions/hook-wiring (recorded with fixtures/sessions/hook-wiring/record.mjs)
// through the real hook script (hooks/event.mjs) into a live server, one line at a time, and compares what the bar
// showed with what it showed in the real run (states-<name>.jsonl, taken from the server that really ran).
// The recorded cwd (/tmp/rvhw/repo) does not exist in a fresh checkout, so git gives the hook no branch: the branch
// is not compared (recorded: main, then feature-bar after the failing-Bash context) and neither is anything else
// that depends on git. Everything else must match.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startLiveServer } from '../../src/server/index.js';

const SCRIPT = fileURLToPath(new URL('../../hooks/event.mjs', import.meta.url));
const DIR = new URL('../../fixtures/sessions/hook-wiring/', import.meta.url);
const jsonl = (f) => fs.readFileSync(new URL(f, DIR), 'utf8').split('\n').filter((l) => l.trim() !== '');
const names = fs.readdirSync(DIR).filter((f) => /^events-.*\.jsonl$/.test(f)).map((f) => f.slice(7, -6));

function runHook(port, input) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SCRIPT], { env: { ...process.env, REVVIEW_PORT: String(port) } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.resume();
    p.on('close', (code) => resolve({ out, code }));
    p.stdin.on('error', () => {});
    p.stdin.end(input);
  });
}

// the fields that do not depend on git at the recorded cwd (branch is left out on purpose)
const proj = (s) => ({ view: s.view, activity: s.activity, repo: s.repo, tool: s.tool, file: s.file, diff: s.diff, command: s.command });
const dedupe = (a) => a.filter((x, i) => i === 0 || JSON.stringify(x) !== JSON.stringify(a[i - 1]));
const isSubsequence = (sub, full) => {
  let i = 0;
  for (const x of full) if (i < sub.length && JSON.stringify(x) === JSON.stringify(sub[i])) i++;
  return i === sub.length;
};

test('recordings exist', () => {
  assert.deepEqual(names.sort(), ['bar-follows', 'permission-denied', 'stop-failure', 'stop-failure-interactive']);
});

for (const name of names) {
  test(`hook-wiring ${name}: the real hook reproduces the bar of the real run`, async () => {
    const srv = await startLiveServer({ port: 0 });
    try {
      const port = new URL(srv.url).port;
      const seen = [];
      let skipped = 0;
      for (const line of jsonl(`events-${name}.jsonl`)) {
        const r = await runHook(port, line);
        assert.equal(r.code, 0);
        assert.equal(r.out, '');
        if (JSON.parse(line).hook_event_name === 'PermissionRequest') skipped++;
        seen.push(proj((await (await fetch(`${srv.url}/state`)).json()).state));
      }
      const got = dedupe(seen);
      const real = dedupe(jsonl(`states-${name}.jsonl`).map((l) => proj(JSON.parse(l).state)));
      if (name === 'stop-failure') {
        // In the real run the bar never showed the StopFailure: claude -p exits right after firing it and the
        // revview hook's post did not get through (the recorder hook did log it), so the recorded bar went
        // working -> ended. Replayed with every line delivered, StopFailure gives `waiting` (src/state/reducer.js)
        // in between. So the recorded states (minus the leading `unknown`, before the first event) are a subsequence of the replay.
        assert.ok(isSubsequence(real.slice(1), got), `recorded states are not a subsequence of the replay:\n${JSON.stringify(got)}\n${JSON.stringify(real)}`);
        assert.deepEqual(got.map((s) => s.view), ['waiting', 'working', 'waiting', 'ended']);
      } else {
        assert.ok(isSubsequence(got, real), `replayed states are not a subsequence of the recorded ones:\n${JSON.stringify(got)}\n${JSON.stringify(real)}`);
      }
      assert.deepEqual(got.at(-1), real.at(-1)); // both end on the same final state
      assert.equal(got.at(-1).view, 'ended');
      assert.equal(skipped, 0); // none of these runs had a PermissionRequest (a prompt would be skipped by the hook, not posted)
    } finally {
      await srv.close();
    }
  });
}

test('bar-follows: working with tool and file, diff counted, done, then ended', () => {
  const real = dedupe(jsonl('states-bar-follows.jsonl').map((l) => proj(JSON.parse(l).state)));
  assert.deepEqual(real.map((s) => s.view).filter((v, i, a) => v !== a[i - 1]), ['unknown', 'waiting', 'working', 'done', 'ended']);
  assert.ok(real.some((s) => s.view === 'working' && s.tool === 'Write' && s.file === 'notes.txt'));
  assert.ok(real.some((s) => s.tool === 'Edit' && s.file === 'notes.txt' && s.diff.added + s.diff.removed > 0));
  assert.deepEqual(real.at(-1).diff, { added: 0, removed: 0 }); // SessionEnd clears the turn
  // the failing Bash arrived as PostToolUseFailure and the turn went on
  const ev = jsonl('events-bar-follows.jsonl').map((l) => JSON.parse(l).hook_event_name);
  assert.ok(ev.includes('PostToolUseFailure'));
  assert.equal(ev.at(-1), 'SessionEnd');
});

test('stop-failure: StopFailure fires with error and last_assistant_message and the bar goes working -> ended', () => {
  const ev = jsonl('events-stop-failure.jsonl').map((l) => JSON.parse(l));
  const f = ev.find((e) => e.hook_event_name === 'StopFailure');
  assert.equal(f.error, 'server_error');
  assert.match(f.last_assistant_message, /ECONNREFUSED/);
  assert.ok(!ev.some((e) => e.hook_event_name === 'Stop'));
});

test('stop-failure-interactive: in interactive claude (tmux) the StopFailure post reaches the server: working -> waiting -> ended', () => {
  const ev = jsonl('events-stop-failure-interactive.jsonl').map((l) => JSON.parse(l));
  assert.deepEqual(ev.map((e) => e.hook_event_name), ['SessionStart', 'UserPromptSubmit', 'StopFailure', 'SessionEnd']);
  assert.equal(ev[2].error, 'server_error');
  assert.match(ev[2].last_assistant_message, /ECONNREFUSED/);
  const real = dedupe(jsonl('states-stop-failure-interactive.jsonl').map((l) => proj(JSON.parse(l).state)));
  assert.deepEqual(real.map((s) => s.view), ['unknown', 'waiting', 'working', 'waiting', 'ended']);
  // the server's state three seconds after the failure: waiting (what QA issue r3-05 is about)
  const after = JSON.parse(fs.readFileSync(new URL('state-stop-failure-interactive.json', DIR), 'utf8')).state;
  assert.equal(after.view, 'waiting');
  assert.match(fs.readFileSync(new URL('pane-stop-failure-interactive.txt', DIR), 'utf8'), /API Error: Connection refused/);
});
