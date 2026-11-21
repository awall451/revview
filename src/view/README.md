# View

The glance view: one static HTML/CSS/JS page shown by Chromium kiosk at 1280x400. No build step, no
framework.

**Current state: a placeholder**, not the real design (that is a later job). It shows the state word large
and the state's fields as plain lines, so the emulator, its tests and screenshots have something real to
drive.

- `index.html`, `view.css`, `view.js` (ES module).
- Input: `?fixture=<id>` loads `../../emulator/fixtures/<id>.json`; `?state=<URL-encoded JSON>` takes a
  state object as the reducer emits it; `window.revviewRender(state)` renders one directly. Bad or missing
  input shows "no state".
- After rendering it sets `document.documentElement.dataset.rendered` and `body[data-view]` to the view id.
- Needs an HTTP server (ES modules and `fetch` do not work from `file://`): `node emulator/serve.js`, then
  `http://127.0.0.1:8137/src/view/?fixture=working`.

The live data feed (hooks to the page) is not built yet.
