---
id: qa-20261122-08
title: A reload of the live page while the server is down leaves Chromium's white error page for good
severity: minor
area: view, kiosk requirement
how to reproduce: |
  Open file:///<repo>/src/view/boot.html?port=8138 in the 1280x400 emulator, start the server (page goes live),
  stop the server, wait 1.5 s, reload the page (page.reload()), start the server again, wait 3 s.
expected: |
  NO LINK and recovery by itself, as on every other path.
evidence: |
  Playwright: `page.reload: net::ERR_CONNECTION_REFUSED`, page URL `chrome-error://chromewebdata/`, a plain white
  1280x400 panel (/tmp/qa2-shots/c-04-reload-while-server-down.png); still white 3 s after the server is back
  (c-05). The boot page only helps when Chromium starts on it; once on http://127.0.0.1:8138/, anything that reloads
  the document (a renderer crash recovered by reloading, Chromium restoring its last session URL after an unclean
  exit, a touch gesture or key that reloads) while the server is away ends on the white error page with no retry.
  DECISIONS says "a Chromium restart starts from the boot page again", which holds only if the kiosk unit always
  passes boot.html and Chromium does not restore the session; neither is written down as a requirement or a bench
  item (H1/H2 only cover a normal boot).
---
