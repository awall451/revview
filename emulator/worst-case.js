// Worst-case renderer inputs (Node side). Each emulator/worst-case/<id>.json is a CONTENT object
// (repo, branch, tool, file, command, output, diff), hand-written to stress layout; it is NOT reducer
// output, so it lives outside emulator/fixtures/ (every file there gets a screenshot check). Tests merge it
// over a fixture state.
import fs from 'node:fs';

export const WORST_CASE_IDS = ['over-limits', 'no-spaces', 'cjk-wide', 'at-limits', 'big-diff', 'band-marks'];

export const WORST_CASE_DIR = new URL('./worst-case/', import.meta.url);

export function loadWorstCase(id) {
  if (!WORST_CASE_IDS.includes(id)) throw new Error(`unknown worst case: ${id}`);
  return JSON.parse(fs.readFileSync(new URL(`${id}.json`, WORST_CASE_DIR), 'utf8'));
}

// What the state core can emit under view 'permission': no output, and a command only for a Bash tool (the
// requested command). Worst-case content merged over the permission fixture must go through this, or the
// screenshot shows an Edit with an old `$ command` and output that no real state has.
export function asPermission(content) {
  const c = { ...content, output: null, outputLines: [] };
  if (c.tool !== 'Bash') c.command = null;
  return c;
}
