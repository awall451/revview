// Stand-in for `claude` in the --live tests of emulator/run.sh. Started through a `claude` shim on PATH.
// Like Claude Code it reads the file after `--settings` and runs the hook commands from it (`bash -c <command>`,
// the hook JSON on stdin, the environment inherited), for SessionStart, a prompt, a tool and TWO permission
// prompts. The PermissionRequest hook's stdout is saved as decision-1.json / decision-2.json.
// It writes only under the directory in REVVIEW_FAKE_CLAUDE_LOG: pid.txt, info.json, stdin.log (raw bytes, hex),
// prompt-1 / prompt-2 (the moment before the hook is called), decision-N.json.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const logDir = process.env.REVVIEW_FAKE_CLAUDE_LOG;
if (!logDir) { console.error('REVVIEW_FAKE_CLAUDE_LOG is not set'); process.exit(3); }
const argv = process.argv.slice(2);
const after = (flag) => { const i = argv.indexOf(flag); return i === -1 ? undefined : argv[i + 1]; };
const sessionId = after('--session-id');
const settingsFile = after('--settings');
const put = (name, text) => fs.writeFileSync(path.join(logDir, name), text);

fs.mkdirSync(logDir, { recursive: true });
put('pid.txt', `${process.pid}\n`);
put('info.json', JSON.stringify({ pid: process.pid, argv, cwd: process.cwd(), port: process.env.REVVIEW_PORT ?? null }));

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (buf) => {
  for (const b of buf) fs.appendFileSync(path.join(logDir, 'stdin.log'), `${b.toString(16).padStart(2, '0')}\n`);
});

const hooks = settingsFile ? (JSON.parse(fs.readFileSync(settingsFile, 'utf8')).hooks ?? {}) : {};
function runHooks(event, payload) {
  const body = JSON.stringify({
    session_id: sessionId,
    transcript_path: path.join(logDir, 'transcript.jsonl'),
    cwd: process.cwd(),
    permission_mode: 'default',
    hook_event_name: event,
    ...payload,
  });
  const cmds = (hooks[event] ?? []).flatMap((g) => (g.hooks ?? []).filter((h) => h.type === 'command').map((h) => h.command));
  return Promise.all(cmds.map((command) => new Promise((resolve) => {
    const p = spawn('bash', ['-c', command], { env: process.env, cwd: process.cwd(), stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stdin.on('error', () => {});
    p.on('close', () => resolve(out));
    p.stdin.end(body);
  })));
}

async function prompt(n, command) {
  const tool = { tool_name: 'Bash', tool_input: { command, description: `step ${n}` } };
  await runHooks('PreToolUse', { ...tool, tool_use_id: `toolu_${n}` });
  put(`prompt-${n}`, '');
  const [out] = await runHooks('PermissionRequest', tool);
  put(`decision-${n}.json`, out ?? '');
  await runHooks('PostToolUse', { ...tool, tool_use_id: `toolu_${n}`, tool_response: { stdout: '', stderr: '', interrupted: false } });
}

await runHooks('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
await runHooks('UserPromptSubmit', { prompt: 'run two commands' });
await prompt(1, 'echo first');
await prompt(2, 'echo second');
put('done', '');
setInterval(() => {}, 1 << 30);
