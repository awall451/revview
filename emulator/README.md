# Panel emulator

Emulator of the 7.9" 1280x400 panel: headless Chromium driven by Playwright with a fixed 1280x400 viewport
at device scale factor 1, one fixture and one screenshot per view state, and a developer page that shows
the strip at its physical size on a desktop monitor.

It proves layout in Chromium at 1280x400 (fits, no scrollbars, type sizes in mm by this Chromium's fonts).
It does **not** prove how the panel looks: fonts, rendering and daylight on the Pi are bench tests
(`docs/BENCH-TEST.md`).

## Run

    bash tests/emulator.sh          # npm ci + all Playwright tests (what the gate runs)
    npm run test:emulator           # the same without npm ci

Chromium comes from `PLAYWRIGHT_BROWSERS_PATH` (the script defaults it to `/opt/ms-playwright`). Never run
`playwright install`.

Screenshots: one `<state>.png` per state, exactly 1280x400 px, written to `out/shots/` (git-ignored) or to
`$REVVIEW_SHOTS_DIR` if set. Playwright's own output goes to `out/test-results/`.

## Files

| Path | What |
|---|---|
| `panel.js` | Re-exports `src/view/panel.js`, the ONE place for the panel's size: `PANEL` (1280x400 px, 190x60 mm, `pxPerMm`), `pxToMm`, `mmToPx`. Browser-safe. |
| `mm.js` | `textSizeMm(locator)`, `boxSizeMm(locator)`: sizes in panel mm (see below). |
| `fixtures.js` | `FIXTURE_IDS` (= `VIEWS` from `src/state/states.js`: the reducer's `STATES` plus the page-only `no-link`), `REDUCER_FIXTURE_IDS` (= `STATES`), `loadFixture(id)`. |
| `fixtures/<state>.json` | One state per view: the board's view state (`boardView`) for each reducer state; `no-link.json` is just `{"view":"no-link"}` (drawn by the page when its link is down). |
| `fixtures/recipes.js` | The events each fixture is produced from (recorded sessions + synthetic `Revview*` events). |
| `serve.js` | Dependency-free static server for the repository root (`node:http`). |
| `playwright.config.js`, `tests/` | Config and specs (`mm`, `layout`, `screenshots`, `devpage`, `live`); `live` is the end-to-end test: it starts the live server (`src/server`), POSTs the recorded sessions in `fixtures/sessions/` to it and checks what the page shows, plus the starting, late-join, reconnect and malformed-POST cases; `tests/harness.js` starts a server per worker on a free port. |
| `worst-case/` | Stress content for the renderer (see Worst cases). |
| `dev/` | The developer page. |

## Millimetres

The panel's active area is about **190 x 60 mm** (docs/DESIGN.md; not measured on the real panel). 1280/190
= 6.737 px/mm, 400/60 = 6.667 px/mm: about 1% apart. One uniform scale is used, **1280/190 = 6.737 px/mm**
(the larger one, so a converted size is never overstated); at that scale 400 px are 59.4 mm.

**"Text height" means cap height**: the ink height of a capital H, baseline to top, in the element's
computed font, measured in the page with canvas `measureText('H').actualBoundingBoxAscent`. A test checks it
against the rows of ink of an H painted on a canvas (within 1.5 px). `fontSizeMm` (the CSS font-size, the em
box) is returned too but is always larger than any letter. Both come from this Chromium's fonts (DejaVu /
FreeSans here); the Pi's fonts may measure differently. Example: "the state word's cap height is at least
10.5 mm" (the real thresholds are `MIN_MM` in `src/view/type.js`: 10.5 mm state word, 6.0 mm any text).

## Fixtures

Each reducer fixture is exactly the view state the server sends (`boardView`, same fields, same types). None
is hand-written: each is the board's output (`replayView`) for the events in `fixtures/recipes.js` (`unknown`
is the empty recipe: a fresh or restarted server; `ended` a whole recording up to its SessionEnd), which takes Claude events from the real
recordings in `fixtures/sessions/*.jsonl` and adds only the synthetic `Revview*` events (context, starting,
network, data lock). `offline` and `insert-key` are overlays: their `activity` is the Claude state
underneath. `tests/unit/emulator-fixtures.test.js` checks each fixture equals its replay and is a valid
state; regenerate after an intended reducer change with `REVVIEW_UPDATE_EXPECTED=1 npm run test:unit` and
review the diff.

## Developer page (physical size on a monitor)

    node emulator/serve.js            # port 8137 (or: node emulator/serve.js 9000)

Open `http://127.0.0.1:8137/emulator/dev/` (add `?state=permission` to start on a state). It shows the view
in a 1280x400 iframe scaled to 190 x 59.4 mm. CSS millimetres are not real millimetres on most monitors,
so calibrate once (saved in the browser's localStorage): either enter the monitor's diagonal in inches and
its resolution in CSS px (prefilled from the screen; with OS scaling, the CSS resolution is the physical one
divided by the device pixel ratio shown), or hold a credit card (85.60 x 53.98 mm) to the screen and adjust
the outline until it matches. Check the 100 mm ruler with a real ruler.

## Worst cases

`worst-case/<id>.json` are hand-written CONTENT objects (repo, branch, tool, file, command, output, diff) that stress the renderer: far over the state core's limits, unbroken tokens, CJK and emoji, exactly at the limits in the widest letter, and a 999999999 diff. They are NOT reducer output and live outside `fixtures/` (every file there needs a screenshot). `worst-case.js` exports `WORST_CASE_IDS` and `loadWorstCase(id)`; the layout and screenshot specs merge each over every fixture state (`out/shots/worst-<id>.png`, `worst-<id>-permission.png`).
