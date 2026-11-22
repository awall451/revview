// The projects config file: where "New session" may start Claude Code. See README.md ("Projects").
// A bad file or entry never stops the bar: it is logged and dropped.
import fs from 'node:fs';
import path from 'node:path';
import { isUnsafeText } from './runner.js';

export const MAX_PROJECTS = 32;
export const MAX_PROJECT_CHARS = 4096;

// Why an entry is refused, or null when it is fine. (Whether the directory exists is runner.start's check.)
export function projectProblem(p) {
  if (typeof p !== 'string') return 'not a string';
  if (p.length < 1 || p.length > MAX_PROJECT_CHARS) return 'length must be 1..4096';
  if (isUnsafeText(p)) return 'contains "#" or a control character';
  if (!path.isAbsolute(p)) return 'not an absolute path';
  const bare = p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
  if (path.normalize(bare) !== bare) return 'not a normalized path (no "..", ".", or "//")';
  return null;
}

export function loadProjects(file, { log = () => {} } = {}) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    log(`projects: cannot read ${file}: ${e?.code ?? e?.message ?? e}`);
    return [];
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    log(`projects: ${file} is not valid JSON: ${e?.message ?? e}`);
    return [];
  }
  const list = data !== null && typeof data === 'object' ? data.projects : undefined;
  if (!Array.isArray(list)) {
    log(`projects: ${file} has no "projects" array`);
    return [];
  }
  const out = [];
  list.forEach((p, i) => {
    if (out.length >= MAX_PROJECTS) {
      if (i === MAX_PROJECTS) log(`projects: more than ${MAX_PROJECTS} entries, the rest are ignored`);
      return;
    }
    const bad = projectProblem(p);
    if (bad) {
      log(`projects: entry ${i} refused (${bad})`);
      return;
    }
    out.push(p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);
  });
  return out;
}
