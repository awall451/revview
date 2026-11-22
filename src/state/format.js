// Pure string helpers for display. Every shortener returns a string no longer than `max`
// (Unicode code points), or null for non-string / empty input.
// `path` is only a memory/payload guard: the view fits the file name to real pixels (keeping the base name).
export const LIMITS = Object.freeze({ path: 200, command: 300, output: 80, outputLines: 3 });

const ELLIPSIS = '…';
const ESC = '\u001b';
const OSC_RE = new RegExp(`${ESC}\\][^\\u0007${ESC}]*(?:\\u0007|${ESC}\\\\)?`, 'g');
const CSI_RE = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g');
const ESC_PAIR_RE = new RegExp(`${ESC}[\\s\\S]?`, 'g');
const C1_CSI_RE = /\u009b[0-?]*[ -/]*[@-~]/g;
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const len = (s) => Array.from(s).length;

function truncate(s, max) {
  if (!Number.isInteger(max) || max < 1) return null;
  const cps = Array.from(s);
  return cps.length <= max ? s : cps.slice(0, max - 1).join('') + ELLIPSIS;
}

export function stripAnsi(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(OSC_RE, '')
    .replace(CSI_RE, '')
    .replace(C1_CSI_RE, '')
    .replace(ESC_PAIR_RE, '')
    .replace(/\t/g, ' ')
    .replace(CONTROL_RE, '');
}

// The last n non-empty cleaned lines of text, oldest first. Scans from the end: the work is bounded by the
// lines it needs, not by the size of the text.
function lastLines(text, n) {
  const found = [];
  let end = text.length;
  while (end > 0 && found.length < n) {
    const nl = text.lastIndexOf('\n', end - 1);
    const raw = text.slice(nl + 1, end).replace(/\r+$/, '');
    end = nl < 0 ? 0 : nl;
    const line = stripAnsi(raw.slice(raw.lastIndexOf('\r') + 1)).trim();
    if (line !== '') found.push(line);
  }
  return found.reverse();
}

// text: a string, or a Bash tool_response object {stdout, stderr, ...} (stderr only when stdout has no line).
export function lastOutputLines(text, n = LIMITS.outputLines, max = LIMITS.output) {
  let lines = [];
  if (typeof text === 'string') {
    lines = lastLines(text, n);
  } else if (text && typeof text === 'object' && !Array.isArray(text)) {
    if (typeof text.stdout === 'string') lines = lastLines(text.stdout, n);
    if (lines.length === 0 && typeof text.stderr === 'string') lines = lastLines(text.stderr, n);
  }
  return lines.map((l) => truncate(l, max)).filter((l) => l !== null);
}

export function lastOutputLine(text, max = LIMITS.output) {
  return lastOutputLines(text, 1, max).at(-1) ?? null;
}

export function shortenCommand(cmd, max = LIMITS.command) {
  if (typeof cmd !== 'string') return null;
  const s = cmd.replace(/\s+/g, ' ').trim();
  return s === '' ? null : truncate(s, max);
}

export function shortenPath(path, max = LIMITS.path) {
  if (typeof path !== 'string' || path === '') return null;
  if (len(path) <= max) return path;
  const segs = path.split('/').filter((x) => x !== '');
  const name = segs[segs.length - 1] ?? '';
  if (name === '') return truncate(path, max);
  let best = null;
  for (let i = segs.length - 1; i >= 0; i--) {
    const cand = ELLIPSIS + '/' + segs.slice(i).join('/');
    if (len(cand) > max) break;
    best = cand;
  }
  if (best !== null) return best;
  if (!Number.isInteger(max) || max < 1) return null;
  return ELLIPSIS + Array.from(name).slice(-(max - 1)).join('');
}

// Strip a leading `cwd + '/'`; otherwise return the path unchanged.
export function relativeTo(path, cwd) {
  if (typeof path === 'string' && typeof cwd === 'string' && cwd !== '') {
    const prefix = cwd.endsWith('/') ? cwd : cwd + '/';
    if (path.startsWith(prefix) && path.length > prefix.length) return path.slice(prefix.length);
  }
  return path;
}
