// The laptop demo loop: three sessions (repos revview, garden, notes) played from the REAL recordings in
// fixtures/sessions/*.jsonl (cut like emulator/wb4/recipes.js, re-addressed per session). Only the Revview*
// events the product already accepts over POST under the dev bridge are written here (RevviewContext,
// RevviewNetwork, RevviewDataLock). `expect` is what the bar SHOWS after the scene's last step (GET /state,
// boardView): the shown session's view (or the overlay) and how many sessions are on the board.
//
// Not a scene: compaction. The board has no compaction view: a compacting session shows WORKING (see
// fixtures/sessions/compaction.expected.json), so it cannot be told apart on the bar and is left out.
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
  waiting: between(idlePrompt, is('UserPromptSubmit'), is('Notification', { notification_type: 'idle_prompt' })),
};
if (!start(PARTS.starts.revview[0]) || !start(PARTS.starts.garden[0]) || !start(PARTS.starts.notes[0])) throw new Error('demo: recording does not start with SessionStart');

export const REPOS = Object.freeze(['revview', 'garden', 'notes']);

export const sessionId = (loop, repo) => `demo${loop}-${repo}`;

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
  return REPOS.map((repo) => ({ hook_event_name: 'SessionEnd', session_id: sessionId(loop, repo) }));
}

// The scenes of loop number `loop` (session ids derive from it, so every loop's ids are fresh).
export function buildLoop(loop) {
  const [a, b, c] = REPOS.map((repo) => ({ repo, id: sessionId(loop, repo) }));
  const as = (s, events) => readdress(events, s.id, s.repo);
  const ctx = (s) => ({ hook_event_name: 'RevviewContext', session_id: s.id, cwd: `/home/user/${s.repo}`, branch: 'main' });
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
  ];
}
