# View

The glance view: one static HTML/CSS/JS page shown by Chromium kiosk at 1280x400. No build step, no
framework. It renders a reducer state (see `src/state/README.md`).

Files: `index.html`, `boot.html` (kiosk start page, see Boot page), `view.css`, `view.js` (ES module), `sw.js` (service worker, see Reload while the server is down), `type.js` (type sizes), `fit.js` (text fitting),
`panel.js` (panel size and mm/px conversion; the emulator's `emulator/panel.js` re-exports it).

## What it shows

- **Band** (top): a shape, the state word, and `repo · branch` (branch left out when null). `repo · branch`
  is hidden when both are null, or when it would be squeezed to a stub (under about 8 characters). When no
  piece of the branch fits, the repo alone is shown (never a bare `repo ·…`; the CSS end cut still applies to a
  repo that is too long). With other sessions (`+N`) and no room in the band (long state words), the repo moves
  to `#session`, bold at the right end of row A (at most 30% wide, `data-full` = repo), so the driver can tell
  which session needs them; not for the note views (offline, ended, ...).
- **Row A**: the tool and the file (the file is shortened in the middle when it does not fit), and the diff
  as `+N −N` (U+2212) at the right, shown only when added or removed is above 0. Very large counts are
  abbreviated.
- **Below row A**, a flow of 40 px rows without gaps (at most 7 rows below the band in all): the command after
  a `$` (monospace, wrapped; at most 6 minus the number of output lines shown, so 3 to 6 rows; cut with an
  ellipsis at its end only when it does not fit, `data-full` holds the full text), then the last up to 3 output
  lines (`#out1`..`#out3`, oldest first, one row each, cut with an ellipsis). In the note views `#note2` takes
  the command's place. An empty part takes no room.
- **starting**, **offline**, **insert-key** show short notes instead of tool, file and command:
  starting "Not ready for voice yet"; offline "Claude: <activity>" (`Claude exited` when the last activity was ended, `Claude: not known` when unknown) and "No network: voice input will not
  work"; insert-key "Data locked" and "Insert the key stick to unlock". Starting and insert-key show no diff.
- **unknown**, **ended**, **no-link** show fixed notes too: unknown "Not known until Claude's next step" /
  "Push-to-talk may still work"; ended "No Claude Code session running" / "Voice input goes nowhere" (repo and
  branch stay in the band); no-link "Display lost the revview server" / "Claude may still be running" (no repo,
  no diff). None of the three shows a diff.
- **More sessions**: `#others` in the band, before `#where`, shows `+N` when `others` (number of other live
  Claude sessions) is a positive integer; `data-full` is `N more Claude session(s)`. It never shrinks (`#where`
  gives way first; next to NEEDS PERMISSION the band's padding is tightened, class `tight`). Not shown in
  no-link, unknown, starting, insert-key. From 10 on it reads `9+` (two digits next to NEEDS PERMISSION ran off the panel; the state core may exceed its
  session cap with pending permissions); `data-full` always has the real number.
- **NO BUTTONS tag**: `#buttons-tag` at the right end of the band, shown only when `state.buttons === 'missing'` and the view is neither `starting` nor `no-link` (any other value: hidden). `data-full` is `Wheel buttons not found: the buttons do nothing`. Not a state takeover: band colour, shape, word and rows are unchanged. Detail size (`--detail-font`), bold, 2 px outline in the band's text colour, transparent fill, vertically centred; it never shrinks (`#where` gives way first, and `tight` is also set when the hint would reach the tag).
- **Diff lower bound**: when `diffIncomplete` is `true` (an event of the turn was too large to read) the diff
  shows a white bold `≥` (`#diff-approx`) before `+A −R`, and `#diff` `data-full` is `at least +A −R`. With no
  counted lines (a lower bound of zero says nothing) it shows `+? −?` without `≥` and `data-full` is
  `diff unknown (an event was too large to read)`.
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

Sizes are cap heights (ink height of a capital H) in panel mm, set in `type.js`. Design (`TYPE_MM`): state word
6.05 mm, all other text 3.55 mm (the owner's targets are 6 and 3.5 mm; the design sits a little above because the emulator's canvas
measurement reports the hinted cap height in whole pixels, rounded down). The tests assert a two-sided range (`RANGE_MM`): state word
5.8-6.3 mm, every other text 3.3-3.7 mm. The emulator measured 5.94 mm (40 px) and 3.41 mm (23 px) in all looks; nothing is measured on
the real panel.
At runtime `view.js` measures the real font's cap-height ratio and sets the font sizes from it, so the cap
height holds whatever font the browser picks. Mm are converted at the panel's 1280/190 = 6.737 px/mm.

## Input

- Static: `?fixture=<id>` loads `../../emulator/fixtures/<id>.json`; `?state=<URL-encoded JSON>` takes a
  state object; `window.revviewRender(state)` renders one directly. Bad or missing input shows "NO STATE".
  `html[data-link]` is `static`. Needs an HTTP server (ES modules and `fetch` do not work from `file://`):
  `node emulator/serve.js`, then `http://127.0.0.1:8137/src/view/?fixture=working`.
- Live: with neither `?fixture` nor `?state`, the page opens an `EventSource` on `/events` of the server
  that served it (`src/server/README.md`) and renders every `{seq, state}` message. `index.html` already contains the
  NO LINK look (data-view, shape, word, notes), so the very first paint is never an empty grey band. Before the
  first message and whenever the link is down it shows `no-link` (never the stale state, never `starting`;
  only a `RevviewStarting` event makes `starting`) and reconnects (re-created after 1 s if the browser gave up); the next message
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

## Reload while the server is down

Chromium shows its own white error page when a document load fails; a page cannot prevent that. What helps is
`sw.js`, a service worker the live page registers. After one successful load it holds the page and its
scripts, serves them network-first, and answers a navigation or script request from the cache when the server
does not answer, so a reload while the server is away starts the page (NO LINK) and it reconnects by itself.
Not fixable from the page: the very first load of a browser profile (nothing cached yet), a profile whose site
data was cleared, and Chromium's session restore if it restores a URL before the service worker is active. The
kiosk should therefore always start Chromium on `boot.html` (not on the live URL), keep session restore off
(a fresh profile per boot also clears the worker's cache: then only `boot.html` protects the first load) and use
`--disable-session-crashed-bubble`. Neither the service worker nor these flags are proven on the Pi
(BENCH-TEST H8).
A page loaded from the cache keeps its old scripts until the next reload after the server is back: the live page therefore reloads itself once when its link first comes up after it never saw it up (loaded while the server was away). `/state`, `/events` and `/event` are never answered by the worker (emulator tests).

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
