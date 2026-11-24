Unit tests (node:test) for src/state/. Run: `npm run test:unit`.

## Renamed test files

Test files are named by what they test. These were named after review rounds; DECISIONS.md and the history files
under `docs/agents/` still use the old names.

| Old name | New name |
| --- | --- |
| board-r3.test.js | board-permission-details.test.js |
| board-r5.test.js | board-answered-call.test.js |
| board-r6-boot.test.js | board-boot-done.test.js |
| board-r6-launch.test.js | board-launch.test.js |
| board-r6.test.js | board-missing-projects.test.js |
| board-r6b.test.js | board-ended-notes.test.js |
| board-r7.test.js | board-last-session-ended.test.js |
| board-wb3.test.js | board-interrupt.test.js |
| board-wb4.test.js | board-selection-navigation.test.js |
| emulator-wb4.test.js | emulator-looks.test.js |
| server-r6-boot.test.js | server-boot-done.test.js |
| server-r6-launch.test.js | server-launch.test.js |
| server-r6.test.js | server-missing-projects.test.js |
| server-wb4.test.js | server-owned-navigation.test.js |
| sessions-wb4.test.js | sessions-selection.test.js |
| target-r5.test.js | target-readable-tool.test.js |
