#!/usr/bin/env node
// Installs revview's hooks (hooks/settings.json) into a Claude Code settings file.
// Usage: node hooks/install.mjs [--settings <file>] [--remove] [--dry-run]
// Default target: $CLAUDE_CONFIG_DIR/settings.json, else $HOME/.claude/settings.json.
// Own entries (a command ending in the marker comment ` # revview-hook`, plus once the old snippet form
// `node <this repo>/hooks/permission-request.mjs`) are removed first, then appended again, so the run is
// idempotent and a moved repo replaces the old paths. Everything else, other tools' hooks included, is kept.
// A symlinked settings file is written through the link. The first change to an existing file copies it to <file>.revview-backup.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const die = (msg) => {
  process.stderr.write(`revview install: ${msg}\n`);
  process.exit(2);
};

const args = process.argv.slice(2);
let settingsArg = null;
let remove = false;
let dry = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--remove') remove = true;
  else if (args[i] === '--dry-run') dry = true;
  else if (args[i] === '--settings') {
    settingsArg = args[++i];
    if (!settingsArg) die('--settings needs a file');
  } else die(`unknown argument ${args[i]}`);
}

const repo = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
// the path goes inside a double-quoted bash word
if (/["`$\\\u0000-\u001f\u007f]/.test(repo)) die(`repo path contains a character that cannot be quoted safely: ${JSON.stringify(repo)}`);

const target = settingsArg
  ? path.resolve(settingsArg)
  : process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, 'settings.json')
    : path.join(os.homedir(), '.claude', 'settings.json');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const MARK = ' # revview-hook';
const legacy = [`node ${repo}/hooks/permission-request.mjs`, 'node $REVVIEW_DIR/hooks/permission-request.mjs'];
const ours = (h) => isObj(h) && typeof h.command === 'string' && (h.command.endsWith(MARK) || legacy.includes(h.command));

let existing = null;
let mode = 0o600;
let text = null;
let real = target;
if (fs.existsSync(target)) {
  real = fs.realpathSync(target); // a symlinked settings file is written through
  text = fs.readFileSync(real, 'utf8');
  mode = fs.statSync(real).mode & 0o777;
  try {
    existing = JSON.parse(text);
  } catch (e) {
    die(`${target} is not valid JSON (${e.message}); left untouched`);
  }
  if (!isObj(existing)) die(`${target} is not a JSON object; left untouched`);
}
const settings = existing ?? {};
const before = JSON.stringify(settings);
if (settings.hooks !== undefined && !isObj(settings.hooks)) die(`"hooks" in ${target} is not an object; left untouched`);

const hooks = settings.hooks ?? {};
for (const ev of Object.keys(hooks)) {
  if (!Array.isArray(hooks[ev])) die(`"hooks.${ev}" in ${target} is not an array; left untouched`);
}
for (const ev of Object.keys(hooks)) {
  const groups = [];
  for (const g of hooks[ev]) {
    if (isObj(g) && Array.isArray(g.hooks)) {
      const kept = g.hooks.filter((h) => !ours(h));
      if (kept.length === 0 && g.hooks.length > 0) continue;
      groups.push(kept.length === g.hooks.length ? g : { ...g, hooks: kept });
    } else groups.push(g);
  }
  if (groups.length) hooks[ev] = groups;
  else delete hooks[ev];
}

if (!remove) {
  const raw = fs.readFileSync(path.join(repo, 'hooks', 'settings.json'), 'utf8');
  const tpl = JSON.parse(raw.split('$REVVIEW_DIR').join(repo));
  for (const [ev, groups] of Object.entries(tpl.hooks)) hooks[ev] = [...(hooks[ev] ?? []), ...groups];
}
if (Object.keys(hooks).length) settings.hooks = hooks;
else delete settings.hooks;

const out = JSON.stringify(settings, null, 2) + '\n';
if (dry) {
  process.stdout.write(out);
  process.exit(0);
}
if (existing === null && remove) {
  console.log(`${target}: does not exist, nothing to remove`);
  process.exit(0);
}
if (existing !== null && JSON.stringify(settings) === before) {
  console.log(`${target}: already ${remove ? 'without' : 'up to date with'} revview hooks, not changed`);
  process.exit(0);
}
const dir = path.dirname(real);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
// --remove never starts a backup: without one there was no original (install.mjs created the file), and a copy now would hold revview's own hooks
if (text !== null && !remove && !fs.existsSync(`${real}.revview-backup`)) fs.copyFileSync(real, `${real}.revview-backup`);
const tmpFile = path.join(dir, `.${path.basename(real)}.revview-${process.pid}.tmp`);
const fd = fs.openSync(tmpFile, 'w', mode);
try {
  fs.writeSync(fd, out);
  fs.fsyncSync(fd);
} finally {
  fs.closeSync(fd);
}
fs.chmodSync(tmpFile, mode);
fs.renameSync(tmpFile, real);
console.log(`${target}: revview hooks ${remove ? 'removed' : 'installed'}`);
