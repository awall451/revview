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

// Nothing that a speech engine could take as markup: [[ ]] (espeak-ng phoneme input) and < > (SSML-like tags).
const scrub = (s) => s.replace(/\[\[|\]\]/g, ' ').replace(/[<>]/g, ' ');

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
    const command = flat(scrub(p.command.replace(CONTROL, (c) => (/\s/.test(c) ? ' ' : ''))));
    if (command !== '') return `Permission: ${tool} ${cutWords(command, SPEECH_LIMITS.maxCommandChars)}`;
  }
  if (p.tool === 'WebFetch' && isStr(p.file)) {
    const host = flat(scrub(p.file.split('/')[0]));
    if (host !== '') return `Permission: ${tool} ${host}`;
  }
  if (p.tool === 'WebSearch' && isStr(p.file)) {
    const q = flat(scrub(p.file.replace(CONTROL, ' ')));
    if (q !== '') return `Permission: ${tool} ${cutWords(q, SPEECH_LIMITS.maxCommandChars)}`;
  }
  if (isStr(p.file)) {
    const base = flat(scrub(p.file).split('/').filter((x) => x !== '').pop() ?? '');
    if (base !== '') return `Permission: ${tool} ${base}`;
  }
  return `Permission: ${tool}`;
}

// Does this word look like a file path or file name? (Heuristic.) A path is a word that
//  - starts with /, ./, ../, ~/ or a drive letter (C:\ or C:/), or contains a backslash, or
//  - has two or more slashes (src/speech/text.js), or
//  - has one slash and ends in a file extension (src/text.js), or
//  - is name.ext with a 1-5 letter extension (index.js, README.md).
// Not paths: a single-slash word without extension (and/or, a/b, input/output: spoken, the slash as a space),
// "done", "2.5", "v1.2.3" (extension must be letters), "e.g" / "i.e", ".env" (spoken as "dot env"), and a bare
// product name Capitalized.js (Node.js, Next.js), while lower-case index.js is a file.
const EXT = /\.[A-Za-z]{1,5}$/;
function looksLikePath(core) {
  if (core === '') return false;
  if (/^(?:\/|\.\/|\.\.\/|~\/|[A-Za-z]:[\\/])/.test(core) || core.includes('\\')) return true;
  const slashes = core.split('/').length - 1;
  if (slashes >= 2) return true;
  if (slashes === 1) return EXT.test(core);
  if (/^(?:e\.g|i\.e)$/i.test(core)) return false;
  if (/^[A-Z][A-Za-z0-9]*\.js$/.test(core)) return false;
  return /^[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{1,5}$/.test(core) && /[A-Za-z]$/.test(core);
}

const dropPathWords = (line) => line.split(/\s+/).map((w) => {
  const m = /^([("'[<]*)(.*?)([)"'\]>,;:!?.]*)$/s.exec(w);
  if (m === null) return w;
  if (looksLikePath(m[2])) return m[1] + m[3];
  return m[2].includes('/') ? m[1] + m[2].replace(/\//g, ' ') + m[3] : w; // and/or -> "and or"
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
      .replace(/\(\s*(?:(?:see|in|at|from|via|to|and|or)\s*)?\)|\[\s*\]|\{\s*\}|""|''/gi, '')
      .replace(/\s+([,;:!?]|\.(?![A-Za-z]))/g, '$1')
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
  const joined = tidy(scrub(text.split('\n').map(plainLine).filter((l) => l !== '').join(' ')));
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
