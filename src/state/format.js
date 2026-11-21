// Pure string helpers for display. Every shortener returns a string no longer than `max`
// (UTF-16 code units), or null for non-string / empty input.
export const LIMITS = Object.freeze({ path: 40, command: 60, output: 80 });

const ELLIPSIS = '…';
const ESC = '\u001b';
const OSC_RE = new RegExp(`${ESC}\\][^\\u0007${ESC}]*(?:\\u0007|${ESC}\\\\)?`, 'g');
const CSI_RE = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g');
const ESC_PAIR_RE = new RegExp(`${ESC}[\\s\\S]?`, 'g');
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

function truncate(s, max) {
  if (!Number.isInteger(max) || max < 1) return null;
  return s.length <= max ? s : s.slice(0, max - 1) + ELLIPSIS;
}

export function stripAnsi(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(OSC_RE, '')
    .replace(CSI_RE, '')
    .replace(ESC_PAIR_RE, '')
    .replace(/\t/g, ' ')
    .replace(CONTROL_RE, '');
}

function lastLine(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const part = lines[i].slice(lines[i].lastIndexOf('\r') + 1);
    const line = stripAnsi(part).trim();
    if (line !== '') return line;
  }
  return null;
}

// text: a string, or a Bash tool_response object {stdout, stderr, ...}.
export function lastOutputLine(text, max = LIMITS.output) {
  let line = null;
  if (typeof text === 'string') {
    line = lastLine(text);
  } else if (text && typeof text === 'object' && !Array.isArray(text)) {
    if (typeof text.stdout === 'string') line = lastLine(text.stdout);
    if (line === null && typeof text.stderr === 'string') line = lastLine(text.stderr);
  }
  return line === null ? null : truncate(line, max);
}

export function shortenCommand(cmd, max = LIMITS.command) {
  if (typeof cmd !== 'string') return null;
  const s = cmd.replace(/\s+/g, ' ').trim();
  return s === '' ? null : truncate(s, max);
}

export function shortenPath(path, max = LIMITS.path) {
  if (typeof path !== 'string' || path === '') return null;
  if (path.length <= max) return path;
  const segs = path.split('/').filter((x) => x !== '');
  const name = segs[segs.length - 1] ?? '';
  if (name === '') return truncate(path, max);
  let best = null;
  for (let i = segs.length - 1; i >= 0; i--) {
    const cand = ELLIPSIS + '/' + segs.slice(i).join('/');
    if (cand.length > max) break;
    best = cand;
  }
  if (best !== null) return best;
  if (!Number.isInteger(max) || max < 1) return null;
  return ELLIPSIS + name.slice(name.length - (max - 1));
}

// Strip a leading `cwd + '/'`; otherwise return the path unchanged.
export function relativeTo(path, cwd) {
  if (typeof path === 'string' && typeof cwd === 'string' && cwd !== '') {
    const prefix = cwd.endsWith('/') ? cwd : cwd + '/';
    if (path.startsWith(prefix) && path.length > prefix.length) return path.slice(prefix.length);
  }
  return path;
}
