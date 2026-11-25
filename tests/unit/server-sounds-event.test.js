import test from 'node:test';
import assert from 'node:assert/strict';
import { startLiveServer } from '../../src/server/index.js';

for (const devBridge of [false, true]) {
  test(`POST /event RevviewSounds is internal: 403 (devBridge ${devBridge})`, async (t) => {
    const live = await startLiveServer({ port: 0, devBridge });
    t.after(() => live.close());
    const r = await fetch(`${live.url}/event`, { method: 'POST', body: JSON.stringify({ hook_event_name: 'RevviewSounds', mode: 'cues' }) });
    assert.equal(r.status, 403);
  });
}
