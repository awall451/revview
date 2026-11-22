// Recording harness for the WB3 fixtures (NOT run by the gate or by the tests; it needs a signed-in claude).
// Real Claude Code (model haiku) in revview's own private tmux sessions (createSessionRunner, socket path in /tmp),
// driven through the real server (startLiveServer in this process, devBridge on), the real wheel-button path
// (POST /dev/key feeds the same gesture detector as the device) and the real PermissionRequest hook script.
// Typing a prompt is done by this harness with `tmux send-keys -l` (it stands in for the driver's voice).
//
// usage: node fixtures/buttons/wb3/drive.mjs [scenario ...]      (no argument: all, in order)
//   scenarios: wb3-allow-main wb3-deny-main wb3-allow-subagent wb3-esc wb3-ctrlc wb3-two-sessions
// env: RVWB3_PORT (default 8199), RVWB3_WORK (default /tmp/rvwb3), RVWB3_OUT (default: this directory)
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createSessionRunner } from '../../../src/sessions/index.js';
import { startLiveServer } from '../../../src/server/index.js';

const execP = promisify(execFile);
const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, '../../..');
const PORT = Number(process.env.RVWB3_PORT || 8199);
const WORK = process.env.RVWB3_WORK || '/tmp/rvwb3';
const OUT = process.env.RVWB3_OUT || HERE;
const REPO = path.join(WORK, 'repo');
const CFG = path.join(WORK, 'cfg');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LONG = 'Run node -e "setTimeout(()=>{},40000)" with the Bash tool, nothing else.';

// ---- clean env: no Claude Code variables of the session this shell runs in; auth from the agent-kit file
for (const k of Object.keys(process.env)) if (/^(CLAUDECODE$|CLAUDE_|AI_AGENT$)/.test(k)) delete process.env[k];
for (const l of fs.readFileSync('/etc/agent-kit/auth.env', 'utf8').split('\n')) {
  const m = /^([A-Z_]+)=(.*)$/.exec(l.trim());
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
process.env.CLAUDE_CONFIG_DIR = CFG;
process.env.TERM = 'xterm-256color';

const scrub = (s) => String(s).replaceAll(ROOT, '$REVVIEW_DIR').replaceAll('/home/agent/', '/home/user/');
const hhmmss = () => new Date().toISOString().slice(11, 19);

// ---- throwaway config dir and repo
function setupFiles() {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(CFG, { recursive: true });
  fs.mkdirSync(path.join(REPO, '.claude'), { recursive: true });
  const src = '/tmp/rvbtn/cfg';
  for (const f of ['settings.json', 'policy-limits.json', 'policy-limits.json.signature.json', 'policy-limits.json.stamp.json',
    'remote-settings.json', 'remote-settings.json.synced-at']) {
    if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(CFG, f));
  }
  const cj = JSON.parse(fs.readFileSync(path.join(src, '.claude.json'), 'utf8'));
  cj.projects = { [REPO]: { hasTrustDialogAccepted: true, allowedTools: [] } };
  fs.writeFileSync(path.join(CFG, '.claude.json'), JSON.stringify(cj));
  execFileSync('git', ['init', '-q', REPO]);
  fs.writeFileSync(path.join(REPO, 'README.md'), 'throwaway repo for the wb3 recordings\n');
  // logging hook: one JSON line into the events file; every event but PermissionRequest also goes to the server
  fs.writeFileSync(path.join(WORK, 'log-hook.sh'), `#!/bin/bash
# usage: log-hook.sh EVENTS_FILE PORT
b=$(cat)
printf '%s\\n' "$b" | tr -d '\\n' >> "$1"; echo >> "$1"
case "$b" in *'"hook_event_name":"PermissionRequest"'*) ;; *)
  curl -s -m 5 -X POST --data-binary "$b" "http://127.0.0.1:$2/event" >/dev/null 2>&1 ;; esac
exit 0
`, { mode: 0o755 });
}

function writeSettings(eventsFile) {
  const log = { type: 'command', command: `${WORK}/log-hook.sh ${eventsFile} ${PORT}` };
  const hooks = {};
  for (const e of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SubagentStop', 'SessionEnd']) {
    hooks[e] = [{ matcher: '', hooks: [log] }];
  }
  hooks.PermissionRequest = [{
    matcher: '*',
    hooks: [log, { type: 'command', command: `REVVIEW_PORT=${PORT} node ${ROOT}/hooks/permission-request.mjs`, timeout: 600 }],
  }];
  const settings = { permissions: { defaultMode: 'default', allow: ['Bash(node:*)'] }, hooks };
  const text = JSON.stringify(settings, null, 1);
  fs.writeFileSync(path.join(REPO, '.claude/settings.json'), text);
  return text;
}

// ---- one scenario's run
async function withScenario(name, fn, { permissionWaitMs } = {}) {
  fs.rmSync(path.join(REPO, 'out.txt'), { force: true });
  fs.rmSync(path.join(REPO, 'marker.txt'), { force: true });
  const eventsFile = path.join(WORK, `events-${name}.jsonl`);
  fs.rmSync(eventsFile, { force: true });
  fs.writeFileSync(eventsFile, '');
  writeSettings(eventsFile);
  const sock = path.join(WORK, `tmux-${name}.sock`);
  const runner = createSessionRunner({ socket: { path: sock }, claude: ['claude', '--model', 'haiku'] });
  const actions = [];
  const origErr = console.error;
  console.error = (...a) => { actions.push(a.join(' ')); origErr(...a); };
  const note = (m) => { actions.push(`# ${hhmmss()} ${m}`); origErr(`# ${m}`); };
  const server = await startLiveServer({ port: PORT, devBridge: true, sessions: runner, permissionWaitMs });
  const tm = (args) => execP('tmux', ['-f', '/dev/null', '-S', sock, ...args], { encoding: 'utf8' }).then((r) => r.stdout);
  const saved = [];
  const save = (file, text) => { fs.writeFileSync(path.join(OUT, file), scrub(text)); saved.push(file); };
  const windowOf = async (id) => (await runner.list()).find((s) => s.id === id)?.window;
  const c = {
    runner, server, note, tm, save, repo: REPO, eventsFile,
    events: () => fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    async start(label) {
      const s = await runner.start({ cwd: REPO, name: label });
      await tm(['resize-window', '-t', s.window, '-x', '150', '-y', '45']);
      note(`session ${label} = ${s.id}`);
      for (const end = Date.now() + 60000; Date.now() < end; await sleep(500)) {
        if (c.events().some((e) => e.session_id === s.id && e.hook_event_name === 'SessionStart') && /❯/.test(await c.pane(s.id))) return s;
      }
      throw new Error(`session ${label} did not come up`);
    },
    async pane(id) {
      const w = await windowOf(id);
      if (!w) return '(session gone)';
      const t = await tm(['capture-pane', '-p', '-t', w]);
      return t.split('\n').filter((l) => l.trim() !== '').join('\n');
    },
    async cap(id, file) {
      const t = await c.pane(id);
      save(file, `# captured ${hhmmss()}\n${t}\n`);
      return t;
    },
    async type(id, text) {
      const w = await windowOf(id);
      await tm(['send-keys', '-t', w, '-l', text]);
      await sleep(400);
      await tm(['send-keys', '-t', w, 'Enter']);
      note(`typed into ${id.slice(0, 8)}: ${text}`);
    },
    async raw(id, key) { await tm(['send-keys', '-t', await windowOf(id), key]); note(`terminal key ${key} into ${id.slice(0, 8)}`); },
    async key(code, holdMs = 60) {
      const post = (type) => fetch(`${server.url}/dev/key`, { method: 'POST', body: JSON.stringify({ code, type }) });
      await post('down');
      await sleep(holdMs);
      await post('up');
      note(`pressed ${code} (held ${holdMs} ms)`);
      await sleep(300);
    },
    async state() { return (await (await fetch(`${server.url}/state`)).json()).state; },
    async saveState(file) { save(file, JSON.stringify(await c.state(), null, 1) + '\n'); },
    async waitFor(fn, ms = 60000, what = 'condition') {
      for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) if (await fn()) return true;
      note(`TIMEOUT waiting for ${what}`);
      return false;
    },
    hasEvent: (id, ev, extra = () => true) => c.events().some((e) => e.session_id === id && e.hook_event_name === ev && extra(e)),
    ps: () => execFileSync('bash', ['-c', "ps -eo pid,etimes,args | grep -E '[p]ermission-request.mjs' || true"], { encoding: 'utf8' }).trim(),
  };
  try {
    await fn(c);
  } catch (e) {
    note(`SCENARIO ERROR: ${e.stack || e}`);
  } finally {
    for (const s of await runner.list().catch(() => [])) await runner.stop(s.id).catch(() => {});
    await runner.killServer().catch(() => {});
    await server.close();
    for (const end = Date.now() + 10000; Date.now() < end; await sleep(300)) {
      if (!execFileSync('bash', ['-c', "pgrep -f 'claude --model haiku --session-id' || true"], { encoding: 'utf8' }).trim()) break;
    }
    console.error = origErr;
    save(`actions-${name}.txt`, actions.join('\n') + '\n');
    save(`events-${name}.jsonl`, fs.readFileSync(eventsFile, 'utf8'));
    fs.rmSync(sock, { force: true });
    console.log(`${name}: saved ${saved.join(', ')}`);
  }
}

// ---- scenarios
const permissionShown = (c) => async () => (await c.state()).view === 'permission';

const SCENARIOS = {
  async 'wb3-allow-main'() {
    await withScenario('wb3-allow-main', async (c) => {
      const s = await c.start('main');
      await c.type(s.id, 'Run date > out.txt with the Bash tool, nothing else.');
      await c.waitFor(permissionShown(c), 90000, 'permission on the bar');
      await c.saveState('state-wb3-allow-main-1-permission.json');
      await c.key('F21'); // early: the prompt has been on the bar < 1.5 s
      await c.cap(s.id, 'pane-wb3-allow-main-1-early-press.txt');
      await sleep(2000);
      await c.saveState('state-wb3-allow-main-2-after-early.json');
      c.note(`hook processes: ${c.ps().split('\n').length}`);
      await sleep(2000);
      await c.key('F21');
      await c.waitFor(() => c.hasEvent(s.id, 'Stop') && c.events().filter((e) => e.hook_event_name === 'Stop').length >= 1, 60000, 'Stop');
      await sleep(1000);
      await c.cap(s.id, 'pane-wb3-allow-main-2-after-allow.txt');
      c.note(`out.txt exists: ${fs.existsSync(path.join(c.repo, 'out.txt'))}`);
      await c.saveState('state-wb3-allow-main-3-after-allow.json');
    });
  },
  async 'wb3-deny-main'() {
    await withScenario('wb3-deny-main', async (c) => {
      const s = await c.start('main');
      await c.type(s.id, 'Run date > out.txt with the Bash tool, nothing else.');
      await c.waitFor(permissionShown(c), 90000, 'permission on the bar');
      await sleep(2000);
      await c.cap(s.id, 'pane-wb3-deny-main-1-before-deny.txt');
      await c.key('F16');
      await c.waitFor(() => c.hasEvent(s.id, 'Stop'), 60000, 'Stop');
      await sleep(1000);
      await c.cap(s.id, 'pane-wb3-deny-main-2-after-deny.txt');
      c.note(`out.txt exists: ${fs.existsSync(path.join(c.repo, 'out.txt'))}`);
      await c.saveState('state-wb3-deny-main-1-after-deny.json');
    });
  },
  async 'wb3-allow-subagent'() {
    await withScenario('wb3-allow-subagent', async (c) => {
      const s = await c.start('main');
      // The subagent's request arrives after the main turn's Stop (the Agent call returns at once, the agent is backgrounded).
      await c.type(s.id, 'Use the Agent tool once with a general-purpose subagent. The subagent must run exactly this Bash command and report its output: touch marker.txt && echo made . Do nothing else yourself.');
      await c.waitFor(permissionShown(c), 90000, 'permission on the bar');
      await c.saveState('state-wb3-allow-subagent-1-permission.json');
      await sleep(2000);
      await c.cap(s.id, 'pane-wb3-allow-subagent-1-before-allow.txt');
      await c.key('F21');
      await c.waitFor(() => fs.existsSync(path.join(c.repo, 'marker.txt')), 40000, 'marker.txt');
      await c.waitFor(() => c.hasEvent(s.id, 'PostToolUse', (e) => e.agent_id), 40000, 'subagent PostToolUse');
      await sleep(6000);
      await c.cap(s.id, 'pane-wb3-allow-subagent-2-after-allow.txt');
      await c.saveState('state-wb3-allow-subagent-2-after-allow.json');
      c.note(`marker.txt exists: ${fs.existsSync(path.join(c.repo, 'marker.txt'))}`);
    });
  },
  async 'wb3-esc'() {
    await withScenario('wb3-esc', async (c) => {
      const s = await c.start('main');
      await c.type(s.id, LONG);
      await c.waitFor(() => c.hasEvent(s.id, 'PreToolUse'), 90000, 'PreToolUse');
      await sleep(6000);
      await c.cap(s.id, 'pane-wb3-esc-1-before-esc.txt');
      c.note(`view before: ${(await c.state()).view}`);
      await c.saveState('state-wb3-esc-1-before.json');
      await c.key('F15'); // tap
      const st = await c.state();
      c.note(`view 300 ms after the press: ${st.view}`);
      await c.saveState('state-wb3-esc-2-after.json');
      await sleep(2000);
      await c.cap(s.id, 'pane-wb3-esc-2-after-esc.txt');
      c.note(`events after the press: ${c.events().map((e) => e.hook_event_name).join(',')}`);
    });
  },
  async 'wb3-ctrlc'() {
    await withScenario('wb3-ctrlc', async (c) => {
      const s = await c.start('main');
      await c.type(s.id, LONG);
      await c.waitFor(() => c.hasEvent(s.id, 'PreToolUse'), 90000, 'PreToolUse');
      await sleep(6000);
      await c.cap(s.id, 'pane-wb3-ctrlc-1-before.txt');
      await c.key('F15', 1200); // long-hold
      c.note(`view 300 ms after the long-hold: ${(await c.state()).view}`);
      await c.saveState('state-wb3-ctrlc-1-after-first.json');
      await sleep(1500);
      await c.cap(s.id, 'pane-wb3-ctrlc-2-after-first.txt');
      await c.key('F15', 1200); // second long-hold within 5 s: refused
      await sleep(1500);
      await c.cap(s.id, 'pane-wb3-ctrlc-3-after-second-refused.txt');
      c.note(`sessions listed: ${JSON.stringify((await c.runner.list()).map((x) => x.id))}`);
    });
  },
  async 'wb3-two-sessions'() {
    await withScenario('wb3-two-sessions', async (c) => {
      const a = await c.start('A');
      const b = await c.start('B');
      c.note(`chosen after starts: ${c.runner.chosen()} (B is ${b.id})`);
      await c.runner.choose(a.id);
      await c.type(a.id, LONG);
      await c.waitFor(() => c.hasEvent(a.id, 'PreToolUse'), 90000, 'PreToolUse in A');
      await sleep(6000);
      await c.cap(a.id, 'pane-wb3-two-sessions-1-A-running.txt');
      await c.runner.choose(b.id);
      c.note('chose B (harness: runner.choose)');
      await c.key('F15'); // cancel tap -> B only
      await sleep(1500);
      await c.cap(a.id, 'pane-wb3-two-sessions-2-A-after-cancel-on-B.txt');
      await c.cap(b.id, 'pane-wb3-two-sessions-3-B-after-cancel.txt');
      await c.saveState('state-wb3-two-sessions-1-after-cancel-on-B.json');
      await c.runner.choose(a.id);
      c.note('chose A (harness)');
      await c.key('F15');
      await sleep(2000);
      await c.cap(a.id, 'pane-wb3-two-sessions-4-A-after-cancel-on-A.txt');
      await c.saveState('state-wb3-two-sessions-2-after-cancel-on-A.json');
      // push-to-talk on the chosen session A, voice not set up
      await c.key('F13');
      await sleep(1000);
      await c.cap(a.id, 'pane-wb3-two-sessions-5-A-after-push-to-talk.txt');
      // permission prompt in the NON-chosen session B
      await c.type(b.id, 'Run date > out.txt with the Bash tool, nothing else.');
      await c.waitFor(permissionShown(c), 90000, 'permission on the bar (B)');
      await c.saveState('state-wb3-two-sessions-3-B-permission.json');
      await sleep(2000);
      await c.key('F21'); // chosen is A: must do nothing
      await sleep(1000);
      await c.cap(b.id, 'pane-wb3-two-sessions-6-B-dialog-after-allow-press.txt');
      c.note(`hook processes before the terminal answer: ${c.ps()}`);
      await c.raw(b.id, '1');
      await c.waitFor(() => c.hasEvent(b.id, 'Stop'), 60000, 'Stop in B');
      await sleep(1500);
      await c.cap(b.id, 'pane-wb3-two-sessions-7-B-after-terminal-1.txt');
      c.note(`hook processes after the terminal answer: ${c.ps() || '(none)'}`);
      await c.saveState('state-wb3-two-sessions-4-after-terminal.json');
    }, { permissionWaitMs: 20000 });
  },
};

setupFiles();
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENARIOS);
for (const n of names) {
  if (!SCENARIOS[n]) throw new Error(`unknown scenario ${n}`);
  await SCENARIOS[n]();
}
