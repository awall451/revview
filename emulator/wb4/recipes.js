// How each WB4 look (mic mark and position, shown-is-not-target, prompt elsewhere, list, menu ...) is produced: events fed to the
// real board, never hand-made view states. Claude events come from the recordings in fixtures/sessions/*.jsonl, copied once per
// session with another session_id and cwd; the internal events (RevviewOwned, RevviewSelect, RevviewNav, RevviewProjects,
// RevviewInput) are the ones the server sends. The one exception is worst-band.json: the board holds at most 8 sessions, so
// `others: 12` and position 12/13 (the worst band) are merged over a real view, like emulator/worst-case/*.json.
import fs from 'node:fs';
import { initialBoard, boardView, replayView, reduceBoard, pendingPrompts } from '../../src/state/index.js';

function recording(name) {
  const url = new URL(`../../fixtures/sessions/${name}.jsonl`, import.meta.url);
  return fs.readFileSync(url, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
}
const is = (name, extra = {}) => (ev) => ev.hook_event_name === name && Object.entries(extra).every(([k, v]) => ev[k] === v);
function upTo(events, pred, last = false) {
  const i = last ? events.findLastIndex(pred) : events.findIndex(pred);
  if (i < 0) throw new Error('recipe: event not found in recording');
  return events.slice(0, i + 1);
}

const workingTurn = recording('working-turn');
const PHASES = {
  working: upTo(workingTurn, is('PostToolUse', { tool_name: 'Bash' }), true),
  done: upTo(workingTurn, is('Stop')),
  permission: upTo(recording('permission-prompt'), is('Notification', { notification_type: 'permission_prompt' })),
  waiting: upTo(recording('idle-prompt'), is('Notification', { notification_type: 'idle_prompt' })),
};

// One session of the given phase: the recording with its own id and a cwd that names the repo.
// An empty repo is a session that reported no cwd at all (the list then shows "(no repo)").
function session(id, phase, repo = id, branch = 'main') {
  const events = PHASES[phase].map((ev) => {
    const { cwd, ...rest } = ev;
    return {
      ...rest,
      session_id: id,
      ...(cwd === undefined || repo === '' ? {} : { cwd: `/home/user/${repo}` }),
      ...(ev.transcript_path === undefined ? {} : { transcript_path: `/home/user/.claude/projects/${id}.jsonl` }),
    };
  });
  return repo === '' ? events : [...events, { hook_event_name: 'RevviewContext', session_id: id, cwd: `/home/user/${repo}`, branch }];
}

// The session's events up to a permission prompt, then revview's answer to it (its `since` is read off the real board).
function answered(id, decision, ...after) {
  const asking = session(id, 'permission');
  const board = asking.reduce((b, ev) => reduceBoard(b, ev), initialBoard());
  const p = pendingPrompts(board).find((x) => x.session === id);
  return [...asking, { hook_event_name: 'RevviewAnswered', session_id: id, agent: p.agent, since: p.since, decision }, ...after.map((e) => ({ ...e, session_id: id }))];
}

// A denied Edit after a Bash call of the same turn (QA r5-01): the working session's events, then the Edit's request and answer.
function editAnswered(id, decision, ...after) {
  const call = { session_id: id, tool_name: 'Edit', tool_input: { file_path: '/home/user/revview/src/app.py', old_string: 'a', new_string: 'b' }, tool_use_id: 'toolu_edit1' };
  const asking = [...session(id, 'working'), { hook_event_name: 'PreToolUse', ...call }, { hook_event_name: 'PermissionRequest', ...call }];
  const board = asking.reduce((b, ev) => reduceBoard(b, ev), initialBoard());
  const p = pendingPrompts(board).find((x) => x.session === id);
  return [...asking, { hook_event_name: 'RevviewAnswered', session_id: id, agent: p.agent, since: p.since, decision }, ...after.map((e) => ({ ...e, session_id: id }))];
}

// A failed turn (QA r3-05): the REAL interactive recording of a StopFailure (API unreachable), up to the StopFailure.
function failedTurn(id, repo = 'revview') {
  return [...upTo(recording('hook-wiring/events-stop-failure-interactive'), is('StopFailure')).map((ev) => ({ ...ev, session_id: id, cwd: `/home/user/${repo}` })),
    { hook_event_name: 'RevviewContext', session_id: id, cwd: `/home/user/${repo}`, branch: 'main' }];
}

const owned = (...ids) => ({ hook_event_name: 'RevviewOwned', ids });
const select = (id) => ({ hook_event_name: 'RevviewSelect', session_id: id });
const nav = (...buttons) => buttons.map((button) => ({ hook_event_name: 'RevviewNav', button, gesture: 'tap' }));
const note = (text) => ({ hook_event_name: 'RevviewNote', note: text });
const projects = (paths) => ({ hook_event_name: 'RevviewProjects', paths });

const three = [...session('s1', 'waiting', 'revview'), ...session('s2', 'working', 'billing-api'), ...session('s3', 'done', 'docs-site')];

const LONG_REPOS = [
  'customer-portal-frontend-monorepo-with-a-very-long-name',
  'infrastructure-terraform-modules-networking-and-load-balancers',
  'revview',
  'a-research-project-about-protein-folding-simulations-with-gpu-clusters-and-a-very-long-tail-2026',
  'billing-api',
  '',
  'docs-site',
  'internal-tools-admin-dashboard-for-the-support-team-and-sales-operations-and-finance-reports',
];
const eight = LONG_REPOS.flatMap((repo, i) => {
  const phase = ['permission', 'working', 'waiting', 'done'][i % 4];
  return session(`l${i + 1}`, phase, repo);
});

const PROJECTS = [
  '/home/user/work/customer-projects/refund-service-frontend/packages/checkout-flow',
  '/home/user/revview',
  '/home/user/work/infrastructure/terraform/modules/networking-and-load-balancers/staging',
  '/home/user/src/github.com/some-organisation/a-repository-with-a-long-name',
];

const WORST_REPO = 'a-very-long-repository-name-for-the-worst-case';
const WORST_BRANCH = 'feature/very-long-branch-name-for-refund-flow-fix-with-many-more-words-2026';
const worst = (phase) => [
  ...session('w1', phase, WORST_REPO, WORST_BRANCH),
  ...session('w2', 'permission', 'other'),
  ...session('w3', 'working', 'third'),
  { hook_event_name: 'RevviewInput', present: false },
  owned('w3'),
  select('w1'),
];

export const RECIPES = Object.freeze({
  // push-to-talk goes to the shown session, 2 of 3
  'mic-position': [...three, owned('s1', 's2', 's3'), select('s2')],
  // the shown session is not one revview started
  'not-target': [...three, owned('s1'), select('s2')],
  // revview started no session at all
  'no-session': [...session('s1', 'working', 'revview'), owned()],
  // revview sessions exist but the driver chose none
  none: [...three, owned('s1', 's2')],
  // another session waits for a permission answer
  elsewhere: [...session('s1', 'working', 'revview'), ...session('s2', 'permission', 'billing-api'), ...session('s3', 'waiting', 'docs-site'),
    owned('s1', 's2', 's3'), select('s1')],
  list: [...three, owned('s1', 's2', 's3'), select('s1'), ...nav('press', 'down')],
  // 8 sessions (the most the board holds), long names, the highlight on the 6th row: the window scrolls
  'list-long': [...eight, owned(...Array.from({ length: 8 }, (_, i) => `l${i + 1}`)), select('l5'), ...nav('press', 'down')],
  menu: [...three, owned('s1', 's2', 's3'), select('s2'), ...nav('menu', 'down')],
  projects: [...three, owned('s1', 's2', 's3'), select('s2'), projects(PROJECTS), ...nav('menu', 'down', 'press', 'down')],
  'new-session': [...three, owned('s1', 's2', 's3'), select('s2'), projects(PROJECTS), ...nav('menu', 'press', 'down')],
  settings: [...three, owned('s1', 's2', 's3'), select('s2'), projects(PROJECTS), ...nav('menu', 'down', 'down', 'press')],
  // revview denied the prompt and the turn stopped: DONE must say the command was denied
  'denied-done': [...answered('s1', 'deny', { hook_event_name: 'Stop' }), owned('s1'), select('s1')],
  // r5-01: an Edit denied after a Bash call of the turn: "Denied: Edit", the old command and output do not come back
  'denied-edit-after-bash': [...editAnswered('s1', 'deny', { hook_event_name: 'Stop' }), owned('s1'), select('s1')],
  // r5-02: the same answer given while OFFLINE keeps its row
  'offline-denied': [...editAnswered('s1', 'deny'), owned('s1'), select('s1'), { hook_event_name: 'RevviewNetwork', online: false }],
  // QA r3-05: the turn ended with an API error: WAITING FOR ME that says "Turn failed: server error" and the message
  'failed-turn': [...failedTurn('s1'), owned('s1'), select('s1')],
  'offline-failed': [...failedTurn('s1'), owned('s1'), select('s1'), { hook_event_name: 'RevviewNetwork', online: false }],
  // revview allowed the prompt; the command is running
  allowed: [...answered('s1', 'allow'), owned('s1'), select('s1')],
  // an owned session after a restart: no event yet, selected, UNKNOWN with its note
  quiet: [{ hook_event_name: 'RevviewInput', present: true }, { ...owned('0b6f6f0e-5a3c-4c1d-9a55-2f0d1c7a9e01', '0b6f6f0e-5a3c-4c1d-9a55-2f0d1c7a9e02'), names: ['revview', 'billing-api'] },
    select('0b6f6f0e-5a3c-4c1d-9a55-2f0d1c7a9e01'), projects(PROJECTS)],
  // a refused New session: the fixed note on a normal view
  'note-start-failed': [...three, owned('s1', 's2', 's3'), select('s2'), note('New session not started: project folder missing')],
  // the list: s2 is not a revview session, its row has the crossed mic
  'list-not-owned': [...three, owned('s1', 's3'), select('s1'), ...nav('press', 'down')],
  // no network while the shown session is the target: the band mic is crossed too
  'offline-mic': [...session('s1', 'working', 'revview'), owned('s1'), select('s1'), { hook_event_name: 'RevviewNetwork', online: false }],
  'worst-band': worst('working'),
  'worst-band-permission': worst('permission'),
});

export const WB4_IDS = Object.keys(RECIPES);

const WORST_MERGE = JSON.parse(fs.readFileSync(new URL('./worst-band.json', import.meta.url), 'utf8'));

// The view state of a look: the board's view after its events (the worst band has the content merged over it).
export function wb4State(id) {
  if (!Object.hasOwn(RECIPES, id)) throw new Error(`unknown wb4 look: ${id}`);
  const state = replayView(RECIPES[id], initialBoard()).at(-1) ?? boardView(initialBoard());
  return id.startsWith('worst-band') ? { ...state, ...WORST_MERGE } : state;
}
