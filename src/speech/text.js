// What is read aloud, as plain words. Pure: no I/O. See config/speech.json for the engines that speak it.
// Claude's output is untrusted text: it is only ever cleaned and shortened here, then written to a speech
// engine's stdin (see speaker.js). It never reaches a shell or an argument list.

export const NOTHING_TO_READ = 'Nothing to read.';
export const SPEECH_LIMITS = { maxChars: 300, maxSentences: 3, maxCommandChars: 100 };

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const isStr = (v) => typeof v === 'string';

// Cut at a word boundary so the kept text is at most `max` characters, then add `...`.
function cutWords(text, max) {
  if (text.length <= max) return text;
  const head = text.slice(0, max + 1);
  const space = head.lastIndexOf(' ');
  const kept = (space > 0 ? head.slice(0, space) : text.slice(0, max)).replace(/[\s,;:]+$/, '');
  return `${kept}...`;
}

const flat = (s) => s.replace(CONTROL, '').replace(/\s+/g, ' ').trim();

// "mcp__github__create_issue" -> "mcp github create issue"
function speakableTool(tool) {
  const t = isStr(tool) ? tool.replace(/[_-]+/g, ' ').replace(/[^A-Za-z0-9 ]/g, '').replace(/ +/g, ' ').trim() : '';
  return t === '' ? 'a tool' : t;
}

// prompt: { tool, file, command } as from pendingPrompts() (file and command may be null)
export function permissionText(prompt) {
  const p = prompt !== null && typeof prompt === 'object' ? prompt : {};
  const tool = speakableTool(p.tool);
  if (p.tool === 'Bash' && isStr(p.command)) {
    // control characters become spaces here, so a newline in a command separates words
    const command = flat(p.command.replace(CONTROL, (c) => (/\s/.test(c) ? ' ' : '')));
    if (command !== '') return `Permission: ${tool} ${cutWords(command, SPEECH_LIMITS.maxCommandChars)}`;
  }
  if (isStr(p.file)) {
    const base = flat(p.file.split('/').filter((x) => x !== '').pop() ?? '');
    if (base !== '') return `Permission: ${tool} ${base}`;
  }
  return `Permission: ${tool}`;
}

// Does this word look like a file path or file name? (Heuristic: it errs on the side of dropping.)
// A slash or backslash, a leading ./ or ~/, or name.ext with a 1-5 letter extension (index.js, README.md).
// Not "done", "2.5", "v1.2.3" (the extension must be letters only), nor "e.g" / "i.e".
function looksLikePath(core) {
  if (core === '') return false;
  if (/[/\\]/.test(core) || core.startsWith('./') || core.startsWith('~/')) return true;
  if (/^(?:e\.g|i\.e)$/i.test(core)) return false;
  return /^[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{1,5}$/.test(core) && /[A-Za-z]$/.test(core);
}

const dropPathWords = (line) => line.split(/\s+/).map((w) => {
  const m = /^([("'[<]*)(.*?)([)"'\]>,;:!?.]*)$/s.exec(w);
  return m !== null && looksLikePath(m[2]) ? m[1] + m[3] : w;
}).join(' ');

// one markdown line -> plain words ('' when nothing is left)
function plainLine(raw) {
  if (/^[\s|:*_=-]*$/.test(raw)) return ''; // rules and table separators
  let line = raw.replace(/^\s*#{1,6}\s*/, '').replace(/^\s*>+\s*/, '').replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');
  line = dropPathWords(line)
    .replace(/\|/g, ' ')
    .replace(/\*+|~~/g, '')
    .replace(/(^|[\s(])_+(?=\S)/g, '$1')
    .replace(/(?<=\S)_+(?=$|[\s).,!?;:])/g, '')
    .replace(/`/g, '');
  line = flat(line);
  // every line ends a sentence
  line = line.replace(/[\s,;:]+$/, '');
  return /[\p{L}\p{N}]/u.test(line) && !/[.!?]$/.test(line) ? `${line}.` : line;
}

function tidy(s) {
  let t = s;
  for (let i = 0; i < 3; i++) {
    t = t
      .replace(/\(\s*\)|\[\s*\]|\{\s*\}|""|''/g, '')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
      .replace(/[,;:]\s*(?=[.!?])/g, '')
      .replace(/([.!?])(?:\s+\.)+(?=\s|$)/g, '$1')
      .replace(/\s+/g, ' ')
      .replace(/^[\s,;:.]+/, '');
  }
  return t.trim();
}

// from a Stop hook's last_assistant_message (markdown): the first few whole sentences, as plain words
export function closingText(message) {
  if (!isStr(message) || message.trim() === '') return '';
  const text = message
    .replace(/```[\s\S]*?(?:```|$)/g, '\n') // fenced code; an unclosed fence drops the rest
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`[^`\n]*`/g, '')
    .replace(/\b(?:https?|ftp|file):\/\/\S+|\bwww\.\S+/gi, '')
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
    .replace(CONTROL, '')
    .replace(/\r/g, '');
  const joined = tidy(text.split('\n').map(plainLine).filter((l) => l !== '').join(' '));
  const sentences = (joined.match(/.+?(?:[.!?]+(?=\s|$)|$)/gs) ?? []).map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s));
  if (sentences.length === 0) return '';
  if (sentences[0].length > SPEECH_LIMITS.maxChars) return cutWords(sentences[0], SPEECH_LIMITS.maxChars);
  let out = '';
  let n = 0;
  for (const s of sentences) {
    const next = out === '' ? s : `${out} ${s}`;
    if (n >= SPEECH_LIMITS.maxSentences || next.length > SPEECH_LIMITS.maxChars) break;
    out = next;
    n++;
  }
  return out;
}

// The text for one read-aloud press: a pending prompt wins, then the closing words, then a fixed phrase.
export function spokenText({ prompt = null, closing = null } = {}) {
  if (prompt !== null && typeof prompt === 'object') return permissionText(prompt);
  const c = closingText(closing);
  return c === '' ? NOTHING_TO_READ : c;
}
