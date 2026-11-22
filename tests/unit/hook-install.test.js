import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const INSTALL = path.join(ROOT, 'hooks/install.mjs');
const TEMPLATE = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/settings.json'), 'utf8'));
const MARK = ' # revview-hook';
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionDenied', 'Notification', 'Stop', 'StopFailure', 'SubagentStop', 'SessionEnd'];

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'revview-inst-'));

function run(args, { home, configDir, script = INSTALL } = {}) {
  const env = { ...process.env, HOME: home };
  delete env.CLAUDE_CONFIG_DIR;
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  const r = spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const commands = (settings) =>
  Object.entries(settings.hooks ?? {}).flatMap(([ev, groups]) =>
    groups.flatMap((g) => g.hooks.map((h) => ({ ev, command: h.command }))));
const mine = (settings) => commands(settings).filter((c) => c.command.endsWith(MARK));

function setup() {
  const home = tmp();
  const file = path.join(home, '.claude', 'settings.json');
  return { home, file, read: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}

test('template: PermissionRequest is only permission-request.mjs, timeout 600', () => {
  const g = TEMPLATE.hooks.PermissionRequest;
  assert.equal(g.length, 1);
  assert.equal(g[0].hooks.length, 1);
  assert.match(g[0].hooks[0].command, /permission-request\.mjs/);
  assert.equal(g[0].hooks[0].timeout, 600);
  for (const c of commands(TEMPLATE)) {
    if (c.ev !== 'PermissionRequest') assert.doesNotMatch(c.command, /permission-request/);
    else assert.doesNotMatch(c.command, /event\.mjs/);
  }
});

test('template: every consumed event runs event.mjs with a short timeout; $REVVIEW_DIR quoted', () => {
  for (const ev of EVENTS) {
    const hs = TEMPLATE.hooks[ev].flatMap((g) => g.hooks);
    assert.equal(hs.length, 1, ev);
    assert.match(hs[0].command, /event\.mjs/, ev);
    assert.ok(hs[0].timeout <= 10, ev);
  }
  for (const ev of ['SubagentStart', 'PreCompact', 'PostCompact']) assert.equal(TEMPLATE.hooks[ev], undefined);
  for (const c of commands(TEMPLATE)) {
    assert.match(c.command, /^node "\$REVVIEW_DIR\/hooks\/[a-z-]+\.mjs" # revview-hook$/);
  }
});

function consumedEvents() {
  const names = new Set();
  const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const reducer = src('src/state/reducer.js');
  const patchFor = reducer.slice(reducer.indexOf('patchFor'));
  for (const m of patchFor.matchAll(/case '([A-Z]\w*)'/g)) names.add(m[1]);
  for (const f of ['src/state/reducer.js', 'src/state/board.js']) {
    for (const m of src(f).matchAll(/(?:hook_event_name|\bname) === '([A-Z]\w*)'/g)) names.add(m[1]);
  }
  for (const m of src('src/state/board.js').matchAll(/^\s*case '([A-Z]\w*)':/gm)) names.add(m[1]);
  return [...names].filter((n) => !n.startsWith('Revview') && n !== 'PermissionRequest');
}

test('template registers event.mjs for every event the state core consumes (derived from the sources)', () => {
  const derived = consumedEvents();
  for (const ev of EVENTS) assert.ok(derived.includes(ev), `${ev} not found in the state sources`);
  for (const ev of derived) {
    const hs = (TEMPLATE.hooks[ev] ?? []).flatMap((g) => g.hooks);
    assert.ok(hs.some((h) => /event\.mjs/.test(h.command)), `${ev} consumed by the state core but not registered`);
  }
});

test('fresh install into a missing file (HOME default)', () => {
  const { home, file, read } = setup();
  const r = run([], { home });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trim().split('\n').length, 1);
  const s = read();
  assert.equal(mine(s).length, EVENTS.length + 1);
  assert.ok(mine(s).every((c) => c.command.includes(ROOT)));
  assert.ok(fs.readFileSync(file, 'utf8').endsWith('}\n'));
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.equal(fs.existsSync(`${file}.revview-backup`), false);
});

test('CLAUDE_CONFIG_DIR is the default target when set', () => {
  const home = tmp();
  const cfg = path.join(tmp(), 'cfg');
  const r = run([], { home, configDir: cfg });
  assert.equal(r.code, 0, r.err);
  assert.ok(fs.existsSync(path.join(cfg, 'settings.json')));
  assert.equal(fs.existsSync(path.join(home, '.claude')), false);
});

test("merge keeps unrelated keys and the user's own hooks", () => {
  const { home, file, read } = setup();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const user = {
    permissions: { allow: ['Bash(ls)'] },
    model: 'x',
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }],
      PermissionRequest: [{ hooks: [{ type: 'command', command: 'echo perm' }] }],
    },
  };
  fs.writeFileSync(file, JSON.stringify(user));
  assert.equal(run([], { home }).code, 0);
  const s = read();
  assert.deepEqual(s.permissions, user.permissions);
  assert.equal(s.model, 'x');
  assert.equal(s.hooks.PreToolUse[0].hooks[0].command, 'echo mine');
  assert.equal(s.hooks.PermissionRequest[0].hooks[0].command, 'echo perm');
  assert.equal(s.hooks.PreToolUse.length, 2);
  assert.equal(s.hooks.PermissionRequest.length, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.revview-backup`, 'utf8')), user);
});

test('idempotent: two runs give identical bytes, one entry per event', () => {
  const { home, file, read } = setup();
  run([], { home });
  const a = fs.readFileSync(file, 'utf8');
  run([], { home });
  assert.equal(fs.readFileSync(file, 'utf8'), a);
  const evs = mine(read()).map((c) => c.ev).sort();
  assert.deepEqual(evs, [...EVENTS, 'PermissionRequest'].sort());
});

test('old snippet-style entry is replaced, not duplicated; backup made once', () => {
  const { home, file, read } = setup();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const old = {
    hooks: {
      PermissionRequest: [{ matcher: '*', hooks: [{ type: 'command', command: `node ${ROOT.replace(/\/$/, '')}/hooks/permission-request.mjs`, timeout: 600 }] }],
      SubagentStart: [{ hooks: [{ type: 'command', command: 'node /old/place/hooks/event.mjs' }] }],
      PreCompact: [{ hooks: [{ type: 'command', command: 'node "/y/hooks/permission-request.mjs"' }] }],
    },
  };
  fs.writeFileSync(file, JSON.stringify(old));
  run([], { home });
  const s = read();
  assert.ok(!JSON.stringify(s).includes(`node ${ROOT.replace(/\/$/, '')}/hooks/permission-request.mjs`));
  assert.equal(s.hooks.PermissionRequest.length, 1);
  assert.equal(s.hooks.SubagentStart[0].hooks[0].command, 'node /old/place/hooks/event.mjs'); // foreign: kept
  assert.equal(s.hooks.PreCompact[0].hooks[0].command, 'node "/y/hooks/permission-request.mjs"');
  assert.equal(mine(s).length, EVENTS.length + 1);
  const bak = fs.readFileSync(`${file}.revview-backup`, 'utf8');
  assert.ok(bak.includes('/old/place'));
  run(['--remove'], { home });
  assert.equal(fs.readFileSync(`${file}.revview-backup`, 'utf8'), bak);
});

test("--remove leaves only the user's things; no-op without revview hooks", () => {
  const { home, file, read } = setup();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const user = { model: 'x', hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } };
  fs.writeFileSync(file, JSON.stringify(user, null, 2) + '\n');
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(run(['--remove'], { home }).code, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  run([], { home });
  assert.equal(run(['--remove'], { home }).code, 0);
  assert.deepEqual(read(), user);
  fs.writeFileSync(file, '{"a":1}\n');
  run([], { home });
  run(['--remove'], { home });
  assert.deepEqual(read(), { a: 1 });
});

test("other tools' event.mjs / permission-request.mjs hooks survive install and --remove", () => {
  const { home, file, read } = setup();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const user = {
    hooks: {
      PreToolUse: [{ hooks: [{ type: 'command', command: 'node /x/hooks/event.mjs' }] }],
      PermissionRequest: [{ hooks: [{ type: 'command', command: 'node "/y/hooks/permission-request.mjs"' }] }],
    },
  };
  fs.writeFileSync(file, JSON.stringify(user));
  assert.equal(run([], { home }).code, 0);
  const cmds = commands(read()).map((c) => c.command);
  assert.ok(cmds.includes('node /x/hooks/event.mjs'));
  assert.ok(cmds.includes('node "/y/hooks/permission-request.mjs"'));
  assert.equal(mine(read()).length, EVENTS.length + 1);
  assert.equal(run(['--remove'], { home }).code, 0);
  assert.deepEqual(read(), user);
});

test('a symlinked settings file stays a symlink; the real file gets the hooks', () => {
  const { home } = setup();
  const real = path.join(tmp(), 'real.json');
  fs.writeFileSync(real, '{"model":"x"}\n');
  const link = path.join(home, 'link.json');
  fs.symlinkSync(real, link);
  assert.equal(run(['--settings', link], { home }).code, 0);
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  const s = JSON.parse(fs.readFileSync(real, 'utf8'));
  assert.equal(s.model, 'x');
  assert.equal(mine(s).length, EVENTS.length + 1);
  assert.ok(fs.existsSync(`${real}.revview-backup`));
  assert.equal(run(['--settings', link, '--remove'], { home }).code, 0);
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.deepEqual(JSON.parse(fs.readFileSync(real, 'utf8')), { model: 'x' });
});

test('invalid targets: exit 2, file untouched', () => {
  const { home, file } = setup();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const bad of ['{nope', '[1]', '{"hooks":[]}', '"x"', '{"hooks":{"Stop":{"a":1}}}', '{"hooks":{"Stop":"x"}}']) {
    fs.writeFileSync(file, bad);
    const r = run([], { home });
    assert.equal(r.code, 2, bad);
    assert.ok(r.err.length > 0);
    assert.equal(fs.readFileSync(file, 'utf8'), bad);
    assert.equal(fs.existsSync(`${file}.revview-backup`), false);
  }
});

test('--dry-run prints and writes nothing; --settings picks the file', () => {
  const { home, file } = setup();
  const r = run(['--dry-run'], { home });
  assert.equal(r.code, 0);
  assert.equal(mine(JSON.parse(r.out)).length, EVENTS.length + 1);
  assert.equal(fs.existsSync(path.dirname(file)), false);
  const other = path.join(tmp(), 'o.json');
  assert.equal(run(['--settings', other], { home }).code, 0);
  assert.ok(fs.existsSync(other));
});

test('file mode is kept', () => {
  const { home, file } = setup();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{}');
  fs.chmodSync(file, 0o600);
  run([], { home });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('refuses a repo path with a double quote', () => {
  const dir = path.join(tmp(), 'a"b');
  fs.cpSync(path.join(ROOT, 'hooks'), path.join(dir, 'hooks'), { recursive: true });
  const home = tmp();
  const r = run([], { home, script: path.join(dir, 'hooks/install.mjs') });
  assert.equal(r.code, 2);
  assert.equal(fs.existsSync(path.join(home, '.claude')), false);
});

function closedPort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

for (const withSpace of [false, true]) {
  test(`installed PreToolUse command runs for real${withSpace ? ' (repo path with a space)' : ''}`, async () => {
    let script = INSTALL;
    if (withSpace) {
      const dir = path.join(tmp(), 're view');
      fs.cpSync(path.join(ROOT, 'hooks'), path.join(dir, 'hooks'), { recursive: true });
      script = path.join(dir, 'hooks/install.mjs');
    }
    const { home, read } = setup();
    assert.equal(run([], { home, script }).code, 0);
    const cmd = read().hooks.PreToolUse[0].hooks[0].command;
    if (withSpace) assert.ok(cmd.includes('re view'));
    const line = fs.readFileSync(path.join(ROOT, 'fixtures/sessions/working-turn.jsonl'), 'utf8')
      .split('\n').find((l) => l.includes('"PreToolUse"'));
    const r = spawnSync('bash', ['-c', cmd], {
      input: line, encoding: 'utf8', env: { ...process.env, REVVIEW_PORT: String(await closedPort()) },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
  });
}

test('--remove on a file install.mjs created itself writes no backup (QA r5b-03)', () => {
  const { home, file } = setup();
  assert.equal(run([], { home }).code, 0);
  assert.equal(fs.existsSync(`${file}.revview-backup`), false);
  assert.equal(run(['--remove'], { home }).code, 0);
  assert.equal(fs.existsSync(`${file}.revview-backup`), false);
});
