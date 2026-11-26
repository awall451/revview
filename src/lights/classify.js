// The state each LED shows, from the board. Pure.
import { boardView, sessionOrder, sessionStarting, isAsk } from '../state/index.js';

const SHOWN = ['working', 'waiting', 'done', 'starting'];

// array of state strings in bar order (see frames.js)
export function lightStates(board) {
  const sessions = board?.sessions;
  if (!sessions || typeof sessions !== 'object') return [];
  return sessionOrder(board).map((id) => {
    const s = sessions[id];
    const pending = Array.isArray(s.pending) ? s.pending : [];
    if (pending.length > 0) return isAsk(pending[0]?.ask) ? 'asking' : 'permission';
    const a = s.state?.activity;
    if (a === 'permission') return 'permission';
    if (s.state?.failed) return 'failed';
    if (sessionStarting(board, id)) return 'starting';
    return SHOWN.includes(a) ? a : 'unknown';
  });
}

export const nightOf = (board) => boardView(board).look === 'night';
export const lightsOn = (board) => board?.lights === 'on';
