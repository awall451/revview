// Counts added/removed lines for one finished Edit/Write/MultiEdit call.
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Number of lines in s; a single trailing newline does not start a new line.
export function lineCount(s) {
  if (typeof s !== 'string' || s === '') return 0;
  const n = s.split('\n').length;
  return s.endsWith('\n') ? n - 1 : n;
}

function countPatch(hunks) {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    if (!isObj(hunk) || !Array.isArray(hunk.lines)) continue;
    for (const line of hunk.lines) {
      if (typeof line !== 'string') continue;
      if (line.startsWith('+')) added++;
      else if (line.startsWith('-')) removed++;
    }
  }
  return { added, removed };
}

function fallback(tool, input) {
  if (!isObj(input)) return { added: 0, removed: 0 };
  if (tool === 'Edit') return { added: lineCount(input.new_string), removed: lineCount(input.old_string) };
  if (tool === 'Write') return { added: lineCount(input.content), removed: 0 };
  let added = 0;
  let removed = 0;
  if (Array.isArray(input.edits)) {
    for (const ed of input.edits) {
      if (!isObj(ed)) continue;
      added += lineCount(ed.new_string);
      removed += lineCount(ed.old_string);
    }
  }
  return { added, removed };
}

export function countDiff(event) {
  const zero = { added: 0, removed: 0 };
  if (!isObj(event)) return zero;
  const tool = event.tool_name;
  if (tool !== 'Edit' && tool !== 'Write' && tool !== 'MultiEdit') return zero;
  const resp = event.tool_response;
  if (isObj(resp)) {
    if (resp.type === 'create' && tool === 'Write') {
      const content = typeof resp.content === 'string' ? resp.content : isObj(event.tool_input) ? event.tool_input.content : null;
      return { added: lineCount(content), removed: 0 };
    }
    if (Array.isArray(resp.structuredPatch) && (resp.structuredPatch.length > 0 || resp.type === 'update')) {
      return countPatch(resp.structuredPatch);
    }
  }
  return fallback(tool, event.tool_input);
}
