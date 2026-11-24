// How each emulator fixture is produced: a list of hook events fed to the real reducer.
// Recipes are replayed through the board (replayView). Claude events come from the real recordings in fixtures/sessions/*.jsonl (never hand-written);
// only the synthetic Revview* events (context, starting, network, data lock) are written here,
// because nothing else produces them yet. The fixture JSON files are the reducer's output for these
// events; tests/unit/emulator-fixtures.test.js checks they still match (regenerate with
// REVVIEW_UPDATE_EXPECTED=1 npm run test:unit).
import fs from 'node:fs';

function session(name) {
  const url = new URL(`../../fixtures/sessions/${name}.jsonl`, import.meta.url);
  return fs.readFileSync(url, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
}

// Events up to and including the first one matching `pred`.
function upTo(events, pred) {
  const i = events.findIndex(pred);
  if (i < 0) throw new Error('recipe: event not found in recording');
  return events.slice(0, i + 1);
}

// Events up to and including the LAST one matching `pred`.
function upToLast(events, pred) {
  const i = events.findLastIndex(pred);
  if (i < 0) throw new Error('recipe: event not found in recording');
  return events.slice(0, i + 1);
}

const is = (name, extra = {}) => (ev) =>
  ev.hook_event_name === name && Object.entries(extra).every(([k, v]) => ev[k] === v);

// What the future hook script sends after SessionStart: repo and branch from git.
const CONTEXT = { hook_event_name: 'RevviewContext', cwd: '/home/user/revview', branch: 'main' };
const STARTING = { hook_event_name: 'RevviewStarting' };

function withContext(events) {
  const i = events.findIndex(is('SessionStart'));
  // Applies to the session of the SessionStart it follows.
  const context = { ...CONTEXT, session_id: events[i].session_id };
  return [...events.slice(0, i + 1), context, ...events.slice(i + 1)];
}

const workingTurn = session('working-turn');
const permissionPrompt = session('permission-prompt');
const idlePrompt = session('idle-prompt');

// The last Bash PostToolUse of the working turn: command and its output line are both on screen.
// A recorded mid-turn compaction: the second auto compaction, up to the SubagentStop that arrives during it
// (the Read of src/f2.txt is the last tool). The state stays WORKING; `compacting` is true.
const compaction = session('compaction');
const compacting = withContext(compaction.slice(0, 9));

const working = withContext(upToLast(workingTurn, is('PostToolUse', { tool_name: 'Bash' })));

export const RECIPES = Object.freeze({
  working,
  compacting,
  waiting: withContext(upTo(idlePrompt, is('Notification', { notification_type: 'idle_prompt' }))),
  permission: withContext(upTo(permissionPrompt, is('Notification', { notification_type: 'permission_prompt' }))),
  done: withContext(upTo(workingTurn, is('Stop'))),
  // A fresh start (e.g. a restarted server): nothing is known yet.
  unknown: [],
  starting: [STARTING, CONTEXT],
  // Network lost in the middle of a working turn: the overlay hides the activity, which keeps updating.
  offline: [...working, { hook_event_name: 'RevviewNetwork', online: false }],
  // Key-on without the key stick: still starting underneath, data partition locked.
  'insert-key': [STARTING, { hook_event_name: 'RevviewDataLock', locked: true }],
  // The whole working turn, ending in SessionEnd: Claude exited.
  ended: withContext(workingTurn),
});
