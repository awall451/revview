// Canonical names of the view's states. See docs/DECISIONS.md.
export const STATES = Object.freeze([
  'working',
  'waiting',
  'permission',
  'done',
  'starting',
  'offline',
  'insert-key',
  'unknown',
  'ended',
]);

// Views drawn by the page itself when its SSE link is down; the state core never emits them.
export const PAGE_ONLY_VIEWS = Object.freeze(['no-link']);

// Every view the screen can show.
export const VIEWS = Object.freeze([...STATES, ...PAGE_ONLY_VIEWS]);

export function isState(name) {
  return STATES.includes(name);
}
