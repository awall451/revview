// How long the permission hook waits for the server: 570 s by default, never more than 570 s, so it always
// ends before Claude Code's own 600 s hook `timeout` (see settings.json).
export const DEFAULT_WAIT_MS = 570000;
export const MAX_WAIT_MS = 590000; // clamp for REVVIEW_HOOK_WAIT_MS: strictly below the 600000 settings timeout

export function resolveWaitMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WAIT_MS;
  return Math.min(n, MAX_WAIT_MS);
}
