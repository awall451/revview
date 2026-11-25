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
// (`skip` matches are passed over first: 1 = the second match.)
function upTo(events, pred, skip = 0) {
  let i = -1;
  for (let n = 0; n <= skip; n += 1) i = events.findIndex((ev, k) => k > i && pred(ev));
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
const askQuestion = session('ask-question');
const planApprove = session('plan-approve');

// The last Bash PostToolUse of the working turn: command and its output line are both on screen.
// A recorded mid-turn compaction: the second auto compaction, up to the SubagentStop that arrives during it
// (the Read of src/f2.txt is the last tool). The state stays WORKING; `compacting` is true.
const compaction = session('compaction');
const compacting = withContext(compaction.slice(0, 9));

const working = withContext(upToLast(workingTurn, is('PostToolUse', { tool_name: 'Bash' })));

// The working turn on a hot box with a weak supply: board-level marks (HOT and LOW POWER tags), the state stays WORKING.
const thermal = [...working, { hook_event_name: 'RevviewThermal', hot: true, lowPower: true }];

const NAV_DOWN = { hook_event_name: 'RevviewNav', button: 'down', gesture: 'tap' };

export const RECIPES = Object.freeze({
  working,
  compacting,
  thermal,
  waiting: withContext(upTo(idlePrompt, is('Notification', { notification_type: 'idle_prompt' }))),
  permission: withContext(upTo(permissionPrompt, is('Notification', { notification_type: 'permission_prompt' }))),
  // Claude asks the driver (AskUserQuestion; the first question of ask-question, 3 options) or for approval of a plan (the extra fixture).
  asking: withContext(upTo(askQuestion, is('Notification', { notification_type: 'permission_prompt' }))),
  // the same question with the highlight moved to option 3 by two Down taps (what the buttons do)
  'asking-choice': [...withContext(upTo(askQuestion, is('Notification', { notification_type: 'permission_prompt' }))), NAV_DOWN, NAV_DOWN],
  // the recording's second AskUserQuestion call: two questions, which the buttons cannot answer (answer in the terminal)
  'asking-terminal': withContext(upTo(askQuestion, is('Notification', { notification_type: 'permission_prompt' }), 1)),
  'asking-plan': withContext(upTo(planApprove, is('Notification', { notification_type: 'permission_prompt' }))),
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
