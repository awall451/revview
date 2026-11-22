# View

The glance view: one static HTML/CSS/JS page shown by Chromium kiosk at 1280x400. No build step, no
framework. It renders a reducer state (see `src/state/README.md`).

Files: `index.html`, `boot.html` (kiosk start page, see Boot page), `view.css`, `view.js` (ES module), `type.js` (type sizes), `fit.js` (text fitting),
`panel.js` (panel size and mm/px conversion; the emulator's `emulator/panel.js` re-exports it).

## What it shows

- **Band** (top): a shape, the state word, and `repo · branch` (branch left out when null). `repo · branch`
  is hidden when both are null, or when it would be squeezed to a stub (under about 8 characters).
- **Line 2**: the tool and the file (the file is shortened in the middle when it does not fit), and the diff
  as `+N −N` (U+2212) at the right, shown only when added or removed is above 0. Very large counts are
  abbreviated.
- **Line 3**: the last command (after a `$`) and the last line of output.
- **Bash**: the tool name and file are left out; the command takes line 2 and the output stays on line 3.
- **starting**, **offline**, **insert-key** show short notes instead of tool, file and command:
  starting "Not ready for voice yet"; offline "Claude: <activity>" and "No network: voice input will not
  work"; insert-key "Data locked" and "Insert the key stick to unlock". Starting and insert-key show no diff.
- **unknown**, **ended**, **no-link** show fixed notes too: unknown "Not known until Claude's next step" /
  "Push-to-talk may still work"; ended "No Claude Code session running" / "Voice input goes nowhere" (repo and
  branch stay in the band); no-link "Display lost the revview server" / "Claude may still be running" (no repo,
  no diff). None of the three shows a diff.
- **More sessions**: `#others` in the band, before `#where`, shows `+N` when `others` (number of other live
  Claude sessions) is a positive integer; `data-full` is `N more Claude session(s)`. It never shrinks (`#where`
  gives way first; next to NEEDS PERMISSION the band's padding is tightened, class `tight`). Not shown in
  no-link, unknown, starting, insert-key. Two digits would not fit next to NEEDS PERMISSION; the state core keeps at most 8 sessions (`MAX_SESSIONS`), so N is at most 7.
- **Diff lower bound**: when `diffIncomplete` is `true` (an event of the turn was too large to read) the diff
  shows a white bold `≥` (`#diff-approx`) before `+A −R`, and `#diff` `data-full` is `at least +A −R`. With no
  counted lines it still shows `≥ +0 −0`.
- Anything that is not a valid state shows "NO STATE".

Colour is never the only cue; each state has its own shape:

| View | Word | Shape | Colour |
| --- | --- | --- | --- |
| working | WORKING | filled circle | blue `#5eb1ff` |
| waiting | WAITING FOR ME | two bars (pause) | purple `#c8a2ff` |
| permission | NEEDS PERMISSION | triangle | amber `#ffb020` |
| done | DONE | check mark | green `#4fdc7a` |
| starting | STARTING | ring | grey `#e0e0e0` |
| offline | OFFLINE | cross | red `#ff6b6b` |
| insert-key | INSERT KEY | key | pink `#ff8ad8` |
| unknown | UNKNOWN | question mark | cyan `#5ce1e6` |
| ended | CLAUDE EXITED | power-off symbol | sand `#d8c28a` |
| no-link | NO LINK | broken chain link | inverted: black band, white word, shape and 0.6 mm outline |

## Type sizes

Sizes are cap heights (ink height of a capital H) in panel mm, set in `type.js`. Design: state word
10.6 mm, all other text 6.1 mm. The tests assert minimums of 10.5 mm (state word) and 6.0 mm (any text).
At runtime `view.js` measures the real font's cap-height ratio and sets the font sizes from it, so the cap
height holds whatever font the browser picks. Mm are converted at the panel's 1280/190 = 6.737 px/mm.

## Input

- Static: `?fixture=<id>` loads `../../emulator/fixtures/<id>.json`; `?state=<URL-encoded JSON>` takes a
  state object; `window.revviewRender(state)` renders one directly. Bad or missing input shows "NO STATE".
  `html[data-link]` is `static`. Needs an HTTP server (ES modules and `fetch` do not work from `file://`):
  `node emulator/serve.js`, then `http://127.0.0.1:8137/src/view/?fixture=working`.
- Live: with neither `?fixture` nor `?state`, the page opens an `EventSource` on `/events` of the server
  that served it (`src/server/README.md`) and renders every `{seq, state}` message. Before the first message
  it shows `starting`. If the link is down (also before the first message) it shows `no-link` (never the
  stale state, never `starting`) and reconnects (re-created after 1 s if the browser gave up); the next message
  replaces it.

## Boot page

`boot.html` is what the kiosk should open first: `file:///<repo>/src/view/boot.html?port=8138`. Chromium may
start before the server, and a failed load of `http://127.0.0.1:8138/` would leave Chromium's own error page.
The boot page is self-contained (inline CSS and script; ES modules and fetch of local files do not work from
`file://`), shows the no-link look with "Waiting for the revview server" / "Retrying every second", and every
second does `fetch('http://127.0.0.1:<port>/state', { mode: 'no-cors', cache: 'no-store' })` (no Origin header
is sent for a no-cors GET, so the server's Origin check accepts it; the promise resolves only when the server
answers). On success it does `location.replace('http://127.0.0.1:<port>/')`: the live view. `port` is digits
only (1 to 65535), default 8138. Its shape markup and sizes are copies of `view.js`'s; the boot test compares
them.

## Attributes (for tests)

| Attribute | Meaning |
| --- | --- |
| `body[data-view]` | the view id being shown |
| `html[data-rendered]` | set after each render, to the view id |
| `html[data-link]` | `static`, `connecting` (live, nothing yet), `up`, `down` |
| `html[data-seq]` | `seq` of the last message rendered; removed when the link goes down |
| `[data-full]` on each field | the full text before any shortening |

## Fitting

Long values never wrap or overflow. The file path is cut in the MIDDLE (`fit.js`, `middleEllipsis`) so
the file name stays visible: first as much of the leading directories as fits, then `…/` and the whole file
name (`src/compo…/Button.tsx`, or `…/Button.tsx`); only if the file name alone does not fit is it cut in
its own middle, about a third from the front and two thirds from the back, so the extension stays
(`Very…Button.tsx`). Code points are never split. Other fields are clipped with an ellipsis at the end.
`data-full` always holds the whole text.
