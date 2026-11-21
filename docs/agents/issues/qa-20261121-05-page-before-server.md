---
id: qa-20261121-05
title: Page opened before the server shows a blank white page forever; BENCH item 22 expects STARTING
severity: major
area: view, bench-test
how to reproduce: |
  With nothing on the port, open http://127.0.0.1:18138/ in the 1280x400 emulator; then start
  `node src/server/index.js 18138` and wait (no reload).
evidence: |
  Playwright: `page.goto: net::ERR_CONNECTION_REFUSED`; 3 s after the server is up the panel is still
  a plain white 1280x400 page (/tmp/qa-shots/qa-005-blank-page-opened-before-server.png). No view
  code runs, so nothing retries. BENCH item 22 says "with Chromium first it shows STARTING until the
  server is up (if Chromium shows an error page instead, the kiosk start script must wait...)": the
  emulator already answers this (it is the error page, and it is full-screen white, which at night is
  the opposite of "not dazzling", bench 17). The item should state what is known and the kiosk-start
  requirement (wait for the server, or a local page that retries) should be recorded as a requirement
  for stage 4, not left as a maybe.
---
