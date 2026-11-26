// The laptop demo loop: three sessions (repos revview, garden, notes) played from the REAL recordings in
// fixtures/sessions/*.jsonl (cut like emulator/wb4/recipes.js, re-addressed per session). Only the Revview*
// events the product already accepts over POST under the dev bridge are written here (RevviewContext,
// RevviewNetwork, RevviewDataLock). `expect` is what the bar SHOWS after the scene's last step (GET /state,
// boardView): the shown session's view (or the overlay) and how many sessions are on the board.
//
// Scenes 8 and 9: compaction, from fixtures/sessions/compaction.jsonl, in ONE extra session (repo revview, id ...-compaction).
// The main state does not change while Claude compacts: the bar says it in the tool line ("Compacting context", `expect.compacting`).
// 8 ends on the PreCompact of a turn's auto compaction (and its SubagentStop): WORKING + the line. 9 goes on from there: the compaction
// ends (the line goes away), the turn finishes, then a /compact typed at the prompt (PreCompact manual): DONE + the line. A scene ends
// on the compacting state (the player's hold shows it); the next scene (or the loop's restart) shows its end.
//
// Scene 10: Claude asks (AskUserQuestion), from fixtures/sessions/ask-question.jsonl, in the compaction session (it is the only one
// left, and the compaction ended with scene 9): CLAUDE ASKS with the question and its options. It ends on the asking state; scene 11 (or
// the loop's restart, after a jump) moves on. After the question the scene taps Down, Down, Up (steps `DemoKey`, which the player sends as laptop keys through
// POST /dev/key, the way a typed key goes): the highlighted option moves 1 -> 2 -> 3 -> 2 so the owner sees it; a jump (key 0) skips them
// and shows option 1. The demo keys are 1-9 and 0 (= 10).
//
// Scene 11: a task list and the time marks, from fixtures/sessions/task-list.jsonl (Claude Code 2.1.332: TaskCreate / TaskUpdate), in a session of
// its own (repo revview, id ...-tasks) that replaces the asking one (its SessionEnd comes first). Real events of the recording, the tool
// rows left out: the prompt, four TaskCreate, then Bash and TaskUpdate calls up to 2 of 4 done: WORKING with the clock running ("0:07"...) and "tasks 2/4"
// in row A. The scene holds long (`hold`), so the server's quiet timer (run.sh passes --quiet-minutes 0.4 = 24 s to the demo server) fires inside the
// hold: the QUIET mark appears at the end, and the next event (the loop's restart) clears it. At speeds above 1x the hold is shorter than
// the timer and no QUIET shows. No demo key reaches it (the keys are 1-9 and 0 = 10): it follows the asking scene in the loop.
import fs from 'node:fs';

function recording(name) {
  const url = new URL(`../../fixtures/sessions/${name}.jsonl`, import.meta.url);
  return fs.readFileSync(url, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
}
const is = (name, extra = {}) => (ev) => ev.hook_event_name === name && Object.entries(extra).every(([k, v]) => ev[k] === v);
function between(events, from, to, lastTo = false) {
  const a = events.findIndex(from);
  const b = lastTo ? events.findLastIndex(to) : events.findIndex(to);
  if (a < 0 || b < 0 || b < a) throw new Error('demo: event not found in recording');
  return events.slice(a, b + 1);
}

const workingTurn = recording('working-turn');
const permissionPrompt = recording('permission-prompt');
const idlePrompt = recording('idle-prompt');
const compaction = recording('compaction');
const askQuestion = recording('ask-question');
const taskList = recording('task-list');
const start = is('SessionStart');
const lastBash = workingTurn.findLastIndex(is('PostToolUse', { tool_name: 'Bash' }));

const PARTS = {
  starts: { revview: [workingTurn[0]], garden: [permissionPrompt[0]], notes: [idlePrompt[0]] },
  // the user prompt up to the last Bash result: the bar shows the command and its output
  working: between(workingTurn, is('UserPromptSubmit'), is('PostToolUse', { tool_name: 'Bash' }), true),
  // the rest of the working turn up to Stop (its SessionEnd is the last scene's)
  workingRest: workingTurn.slice(lastBash + 1, workingTurn.findIndex(is('Stop')) + 1),
  // the user prompt up to the permission_prompt notification
  permission: between(permissionPrompt, is('UserPromptSubmit'), is('Notification', { notification_type: 'permission_prompt' })),
  // the prompt answered, on the real recording: the tool's result and the turn's Stop
  permissionRest: between(permissionPrompt, is('PostToolUse', { tool_name: 'Bash' }), is('Stop')),
  // recording events 0-8: start, prompt, reads, a PreCompact not followed by a compaction, a read, the auto PreCompact, SubagentStop
  compactAuto: compaction.slice(0, 9),
  // events 9-20: SessionStart compact + PostCompact, a read, the turn's Stop, then `/compact` at the prompt: PreCompact manual + SubagentStop
  compactManual: compaction.slice(9, 21),
  // the user prompt up to the first permission_prompt notification: AskUserQuestion waits for the driver
  ask: between(askQuestion, is('UserPromptSubmit'), is('Notification', { notification_type: 'permission_prompt' })),
  // the prompt, the four creates, the first Bash step and the first two tasks done: events 1, 7, 10, 13, 16, 19, 21, 25, 27, 33, 35, 37 of the recording
  tasks: [1, 7, 10, 13, 16, 19, 21, 25, 27, 33, 35, 37].map((i) => taskList[i]),
  waiting: between(idlePrompt, is('UserPromptSubmit'), is('Notification', { notification_type: 'idle_prompt' })),
};
if (!start(PARTS.starts.revview[0]) || !start(PARTS.starts.garden[0]) || !start(PARTS.starts.notes[0])) throw new Error('demo: recording does not start with SessionStart');

export const REPOS = Object.freeze(['revview', 'garden', 'notes']);

export const sessionId = (loop, repo) => `demo${loop}-${repo}`;

const COMPACTION = 'compaction';
const TASKS = 'tasks';
const TASKS_HOLD = 36000; // ms at 1x: the quiet timer of the demo server is 24 s
const readdress = (events, id, repo) => events.map((ev) => {
  const { cwd, ...rest } = ev;
  return {
    ...rest,
    session_id: id,
    ...(cwd === undefined ? {} : { cwd: `/home/user/${repo}` }),
    ...(ev.transcript_path === undefined ? {} : { transcript_path: `/home/user/.claude/projects/${id}.jsonl` }),
  };
});
const net = (online) => ({ hook_event_name: 'RevviewNetwork', online });
const lock = (locked) => ({ hook_event_name: 'RevviewDataLock', locked });

// A step is { event, gap? }: gap 0 posts it right after the previous one (setup), else the player's gap applies.
const steps = (events, gap) => events.map((event) => (gap === undefined ? { event } : { event, gap }));

// What clears the overlays the scenes leave on the board.
export const clearOverlays = () => [net(true), lock(false)];

// The loop's last events: every demo session still on the board ends (an id the board never saw is harmless).
export function endLoop(loop) {
  return [...REPOS, COMPACTION, TASKS].map((repo) => ({ hook_event_name: 'SessionEnd', session_id: sessionId(loop, repo) }));
}

// The scenes of loop number `loop` (session ids derive from it, so every loop's ids are fresh).
export function buildLoop(loop) {
  const [a, b, c] = REPOS.map((repo) => ({ repo, id: sessionId(loop, repo) }));
  const as = (s, events) => readdress(events, s.id, s.repo);
  const ctx = (s) => ({ hook_event_name: 'RevviewContext', session_id: s.id, cwd: `/home/user/${s.repo}`, branch: 'main' });
  const d = { repo: 'revview', id: sessionId(loop, COMPACTION) };
  const e = { repo: 'revview', id: sessionId(loop, TASKS) };
  const starts = [a, b, c].flatMap((s) => [...as(s, PARTS.starts[s.repo]), ctx(s)]);
  return [
    { name: 'working', steps: [...steps(starts, 0), ...steps(as(a, PARTS.working))], expect: { view: 'working', sessions: 3 } },
    { name: 'permission', steps: steps(as(b, PARTS.permission)), expect: { view: 'permission', sessions: 3 } },
    // the first session's turn ends and the second one's prompt is answered: both done, nothing asks or works
    { name: 'done', steps: steps([...as(a, PARTS.workingRest), ...as(b, PARTS.permissionRest)]), expect: { view: 'done', sessions: 3 } },
    { name: 'waiting', steps: steps(as(c, PARTS.waiting)), expect: { view: 'waiting', sessions: 3 } },
    { name: 'offline', steps: steps([net(false)]), expect: { view: 'offline', sessions: 3 } },
    { name: 'insert-key', steps: steps([net(true), lock(true)]), expect: { view: 'insert-key', sessions: 3 } },
    { name: 'ended', steps: steps([lock(false), ...endLoop(loop)]), expect: { view: 'ended', sessions: 0 } },
    // one session of its own, started here (the three above have ended): auto compaction in the middle of a turn
    { name: 'compaction', steps: [...steps([...as(d, PARTS.compactAuto.slice(0, 1)), ctx(d)], 0), ...steps(as(d, PARTS.compactAuto.slice(1)))], expect: { view: 'working', sessions: 1, compacting: true } },
    // the compaction ends, the turn finishes, then /compact at the prompt
    { name: 'compact-cmd', steps: steps(as(d, PARTS.compactManual)), expect: { view: 'done', sessions: 1, compacting: true } },
    // Claude asks a question in the same session
    // then the highlight moves like the driver's own taps would: down, down, up (the scene ends on option 2)
    { name: 'asking', steps: [...steps(as(d, PARTS.ask)), ...['ArrowDown', 'ArrowDown', 'ArrowUp'].map((code) => ({ event: { hook_event_name: 'DemoKey', code } }))], expect: { view: 'asking', sessions: 1 } },
    // the asking session ends and a task list is worked: the clock, "tasks N/M", and (after the hold's first 24 s) QUIET
    {
      name: 'tasks',
      steps: [
        ...steps([{ hook_event_name: 'SessionEnd', session_id: d.id }, ...as(e, [taskList[0]]), ctx(e)], 0),
        // the four creates come quickly, the rest at the player's pace
        ...as(e, PARTS.tasks).map((event, i) => (i >= 1 && i <= 4 ? { event, gap: 700 } : { event })),
      ],
      hold: TASKS_HOLD,
      expect: { view: 'working', sessions: 1 },
    },
  ];
}
