// Which cue a board change deserves. Pure: no clock, no I/O.
import { selectedKey, shownKey } from '../state/index.js';

// 'needs' | 'failed' | 'done' | null for one session entry of board.sessions
export function cueClass(board, key) {
  const s = board?.sessions?.[key];
  if (!s || typeof s !== 'object') return null;
  if ((Array.isArray(s.pending) && s.pending.length > 0) || s.state?.activity === 'permission') return 'needs';
  if (s.state?.failed) return 'failed';
  if (s.state?.activity === 'done') return 'done';
  return null;
}

// null, or { cue, session } for the one cue this change gives: a session whose class changed to a non-null one.
// The selected (else shown) session gives its own cue; a change in any other session gives 'other'.
export function cueFor(prev, next) {
  const sessions = next?.sessions;
  if (!sessions || typeof sessions !== 'object') return null;
  const sel = selectedKey(next) ?? shownKey(next);
  let other = null;
  for (const key of Object.keys(sessions)) {
    const now = cueClass(next, key);
    if (now === null || now === cueClass(prev, key)) continue;
    if (key === sel) return { cue: now, session: key };
    other ??= { cue: 'other', session: key };
  }
  return other;
}
