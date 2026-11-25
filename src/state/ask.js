// Pure: what an AskUserQuestion or ExitPlanMode call asks the driver, for the "asks me" view (`asking`).
// Built only from the recorded payloads (Claude Code 2.1.331, fixtures/sessions/ask-*.jsonl, plan-*.jsonl):
//   AskUserQuestion tool_input: { questions: [{ question, header, options: [{ label, description }], multiSelect }] }
//   ExitPlanMode    tool_input: { plan: "<markdown>", planFilePath }
// No clock, I/O or randomness; never throws.
import { stripAnsi } from './format.js';

export const ASK_TOOLS = Object.freeze(['AskUserQuestion', 'ExitPlanMode']);
// Code points kept (longer texts end with an ellipsis); the view fits them to pixels on top of this.
export const ASK_LIMITS = Object.freeze({ question: 200, option: 60, title: 120, options: 4 });

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// One display line: ANSI and control characters out, every run of white space (newlines too) one space.
function clean(s, max) {
  if (typeof s !== 'string') return null;
  const one = stripAnsi(s.replace(/[\r\n\t]+/g, ' ')).replace(/\s+/g, ' ').trim();
  if (one === '') return null;
  const cps = Array.from(one);
  return cps.length <= max ? one : `${cps.slice(0, max - 1).join('').trimEnd()}…`;
}

// An option label as the bar shows it (the registry compares the held request's exact label with the bar's)
export const optionLabel = (s) => clean(s, ASK_LIMITS.option);

// The plan's title: its first markdown heading (a leading "Plan:" dropped, the word is on the bar already);
// steps: the numbered items under the first heading that says "steps", else every unindented numbered item.
function planOf(input) {
  const text = isObj(input) && typeof input.plan === 'string' ? input.plan : '';
  const lines = text.slice(0, 65536).split('\n');
  let title = null;
  for (const l of lines) {
    const m = /^#{1,6}\s+(.*)$/.exec(l);
    if (m) {
      title = clean(m[1].replace(/^plan\s*:\s*/i, ''), ASK_LIMITS.title);
      if (title !== null) break;
    }
  }
  const item = /^\d{1,3}[.)]\s+\S/;
  let steps = 0;
  const at = lines.findIndex((l) => /^#{1,6}\s+.*\bsteps?\b/i.test(l));
  if (at >= 0) {
    for (const l of lines.slice(at + 1)) {
      if (/^#{1,6}\s/.test(l)) break;
      if (item.test(l)) steps += 1;
    }
  }
  if (steps === 0) steps = lines.filter((l) => item.test(l)).length;
  return { kind: 'plan', title, steps: steps > 0 ? steps : null };
}

// The first question of the call is shown (the terminal shows one at a time, and no hook says which one is
// on screen); `questions` is how many the call has. Options past the fourth are counted in `more`.
function questionOf(input) {
  const qs = isObj(input) && Array.isArray(input.questions) ? input.questions.filter(isObj) : [];
  const q = qs.length > 0 ? qs[0] : {};
  const all = Array.isArray(q.options) ? q.options.map((o) => clean(isObj(o) ? o.label : o, ASK_LIMITS.option)).filter((x) => x !== null) : [];
  return {
    kind: 'question',
    question: clean(q.question, ASK_LIMITS.question),
    options: all.slice(0, ASK_LIMITS.options),
    more: Math.max(0, all.length - ASK_LIMITS.options),
    multiSelect: q.multiSelect === true,
    questions: Math.max(1, qs.length),
  };
}

// The ask of a tool call, or null when the tool does not ask the driver anything.
// A payload that carries too little still gives an ask (question null / title null): the bar then says only
// that Claude asks, and to look at the terminal.
export function askOf(toolName, toolInput) {
  if (toolName === 'AskUserQuestion') return questionOf(toolInput);
  if (toolName === 'ExitPlanMode') return planOf(toolInput);
  return null;
}

const isCount = (x) => Number.isInteger(x) && x >= 0;
const strOrNull = (x) => x === null || typeof x === 'string';

// True for an object askOf could have made (the board checks what it is given).
export function isAsk(a) {
  if (!isObj(a)) return false;
  if (a.kind === 'plan') return strOrNull(a.title) && (a.steps === null || (isCount(a.steps) && a.steps > 0));
  return a.kind === 'question' && strOrNull(a.question) && Array.isArray(a.options) && a.options.length <= ASK_LIMITS.options
    && a.options.every((o) => typeof o === 'string') && isCount(a.more) && typeof a.multiSelect === 'boolean'
    && Number.isInteger(a.questions) && a.questions >= 1;
}
