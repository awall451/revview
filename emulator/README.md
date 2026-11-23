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
| `playwright.config.js`, `tests/` | Config and specs (`mm`, `layout`, `screenshots`, `buttons-tag`, `devpage`, `live`); `live` is the end-to-end test: it starts the live server (`src/server`), POSTs the recorded sessions in `fixtures/sessions/` to it and checks what the page shows, plus the starting, late-join, reconnect and malformed-POST cases; `tests/harness.js` starts a server per worker on a free port. |
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
FreeSans here); the Pi's fonts may measure differently. Example: "the state word's cap height is between
5.8 and 6.3 mm" (the real ranges are `RANGE_MM` in `src/view/type.js`: 5.8-6.3 mm state word, 3.3-3.7 mm any
other text; the design sizes are `TYPE_MM`, 6.05 and 3.55 mm).

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

`tests/buttons-tag.spec.js`: the NO BUTTONS tag (`buttons: 'missing'` over every fixture: shown except starting and no-link, band unchanged, size and fit, the worst band without overlap); screenshots `out/shots/no-buttons.png` and `no-buttons-permission.png`.

## Worst cases

`worst-case/<id>.json` are hand-written CONTENT objects (repo, branch, tool, file, command, output, diff) that stress the renderer: far over the state core's limits, unbroken tokens, CJK and emoji, exactly at the limits in the widest letter, and a 999999999 diff. They are NOT reducer output and live outside `fixtures/` (every file there needs a screenshot). `worst-case.js` exports `WORST_CASE_IDS` and `loadWorstCase(id)`; the layout and screenshot specs merge each over every fixture state (`out/shots/worst-<id>.png`, `worst-<id>-permission.png`).

## WB4 looks (`emulator/wb4/`, `tests/wb4.spec.js`)

The bar's session looks. Every state is produced by the real board: `emulator/wb4/recipes.js` copies the recordings in
`fixtures/sessions/*.jsonl` once per session (own `session_id` and cwd) and adds the internal events (RevviewOwned,
RevviewSelect, RevviewNav, RevviewProjects, RevviewInput); `wb4State(id)` is `replayView(...).at(-1)`. The one merge is
`wb4/worst-band.json` (`others: 12`, position 12/13), because the board holds at most 8 sessions. `tests/unit/emulator-wb4.test.js`
checks each recipe yields the fields its look shows; `tests/wb4.spec.js` renders each (texts, cap heights in RANGE_MM, no
overlap or overflow, inverted row with its bar, scroll marks, the old look without any mic) and writes the screenshots:
`wb4-mic-position`, `wb4-not-target`, `wb4-no-session`, `wb4-none`, `wb4-elsewhere`, `wb4-list`, `wb4-list-long`
(8 sessions, scrolled), `wb4-menu`, `wb4-projects`, `wb4-new-session`, `wb4-settings`, `wb4-worst-band`,
`wb4-worst-band-permission` (all 1280x400 in `out/shots/`).

`tests/wb4-live.spec.js`: the same looks driven by key presses (dev key bridge, `/?devkeys=1`) against a live server with a
fake session runner (no tmux): switch, list, back, home, New session, list timeout, and the 403 for posted internal events.

## Laptop (Linux / WSL2)

The step-by-step guide, from clone to window, with troubleshooting: [`docs/EMULATOR-LAPTOP.md`](../docs/EMULATOR-LAPTOP.md).

`bash emulator/run.sh [--scale 1.5]` starts the server with the dev key bridge and the laptop key map
(`config/buttons.laptop.json`) and opens the 1280x400 page in its own Chromium, Chrome or Edge window. It needs only
Node 22+ and one of those browsers (`REVVIEW_BROWSER` picks one). Closing the window, or Ctrl+C, stops everything and
removes the temp profile. `--keys` prints the one-screen key cheatsheet (generated by `emulator/keys-sheet.js` from the key map; the words for
each tap / hold / long hold are in its `LABELS` table, and a mapped button or gesture without a label fails the
test), `--print-aliases` prints a bashrc block (`revview`, `revview-keys`, `revview-stop`; it only prints),
`--stop` stops EVERY `run.sh` of yours that is running, from another terminal (it finds them by their pid files in a private directory of yours, looking in `$XDG_RUNTIME_DIR/revview-emu`, `/run/user/<uid>/revview-emu`, `${TMPDIR:-/tmp}/revview-emu-<uid>` and `/tmp/revview-emu-<uid>`; a `run.sh` killed with `kill -9` leaves its server and demo player running, see the guide),
`--no-browser` only serves, `--port N` fixes the port, `--help` (or `-h`) lists the rest. Tested only against a stand-in browser
(`tests/unit/emulator-run.test.js`): nothing has run on a real laptop or a real WSL2 yet, and the WSL2 / Windows browser
paths are from memory.

### Demo mode (the default)

Without `--live`, `run.sh` also starts the demo player (`emulator/demo/player.js`, scenes in `emulator/demo/scenes.js`): it
posts the recorded sessions in `fixtures/sessions/*.jsonl` (re-addressed as three sessions, revview, garden and notes) to
the server at a watchable pace and loops until the window closes. Scenes: 1 working, 2 permission, 3 done, 4 waiting,
5 offline, 6 insert-key, 7 ended. Demo keys, handled by the player and not by the bar (the server sends them to the
player over `GET /dev/demo`, present only with `--dev-bridge --dev-demo`): 1-7 jump to a scene, P pause/continue, `[`
slower, `]` faster; `--keys` lists them under their own heading. `--live [DIR]` starts a real Claude Code session in DIR
instead (no player): see `docs/EMULATOR-LAPTOP.md`, "Live: a real Claude Code session". It needs `tmux` and `claude`, runs
Claude in a private tmux server of the run with a per-run `--settings` file, and prints the `attach:` line. Tested only with
a stand-in claude, never with a real one.

**What demo mode cannot show:** nothing is sent to a Claude, and no real session is behind the demo. Left/Right (switch
session), Up/Down (list), M (menu) and a held Backspace (home) change the screen; Enter, N, Esc (held: Ctrl+C), Space and R
on the permission and done scenes only log the gesture (`GET /buttons`) and leave the screen unchanged: with `--live` they
are sent to the run's own Claude session. Read aloud (R) speaks only after a session was chosen with Left/Right (before that the server says "no
session selected"), and only with espeak-ng or Piper installed as `config/speech.json` says (no setting; the server reads
that file by default); `run.sh` installs nothing. Compaction is not a scene: the bar has no compaction view
(a compacting session shows WORKING). Tested only against a server on the build VM with an injected clock
(`tests/unit/emulator-demo.test.js`), the stand-in browser (`tests/unit/emulator-run.test.js`) and headless Chromium
(`tests/demo-keys.spec.js`); not on a real laptop.
