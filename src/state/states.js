// Canonical names of the view's states. See docs/DECISIONS.md.
export const STATES = Object.freeze([
  'working',
  'waiting',
  'permission',
  'done',
  'starting',
  'offline',
  'insert-key',
]);

export function isState(name) {
  return STATES.includes(name);
}
