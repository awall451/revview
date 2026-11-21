// Placeholder view: renders a reducer state as plain text. Not the real design.
const LABELS = {
  working: 'WORKING',
  waiting: 'WAITING FOR ME',
  permission: 'NEEDS PERMISSION',
  done: 'DONE',
  starting: 'STARTING',
  offline: 'OFFLINE',
  'insert-key': 'INSERT KEY',
};

function lines(s) {
  const out = [];
  if (s.view === 'offline' || s.view === 'insert-key') out.push(`claude: ${s.activity}`);
  const where = [s.repo, s.branch].filter((x) => typeof x === 'string' && x);
  if (where.length) out.push(where.join(' · '));
  const tool = [s.tool, s.file].filter((x) => typeof x === 'string' && x);
  if (tool.length) out.push(tool.join(' '));
  if (s.diff && (s.diff.added || s.diff.removed)) out.push(`+${s.diff.added} −${s.diff.removed}`);
  if (typeof s.command === 'string' && s.command) out.push(`$ ${s.command}`);
  if (typeof s.output === 'string' && s.output) out.push(s.output);
  return out;
}

export function render(state) {
  const word = document.getElementById('state-word');
  const list = document.getElementById('fields');
  list.textContent = '';
  let view = 'none';
  if (state && typeof state === 'object' && typeof state.view === 'string') {
    view = state.view;
    word.textContent = LABELS[view] ?? view;
    for (const t of lines(state)) {
      const li = document.createElement('li');
      li.textContent = t;
      list.append(li);
    }
  } else {
    word.textContent = 'no state';
  }
  document.body.dataset.view = view;
  document.documentElement.dataset.rendered = view;
}

async function load() {
  const q = new URLSearchParams(location.search);
  try {
    if (q.has('state')) return JSON.parse(q.get('state'));
    const id = q.get('fixture');
    if (id && /^[a-z-]+$/.test(id)) {
      const r = await fetch(new URL(`../../emulator/fixtures/${id}.json`, location.href));
      if (r.ok) return await r.json();
    }
  } catch {
    // fall through to "no state"
  }
  return null;
}

window.revviewRender = render;
render(await load());
