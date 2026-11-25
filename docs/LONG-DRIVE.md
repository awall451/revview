# A whole drive in the emulator (cycle 59, owner issue 33)

Every other test is a short scene. The appliance runs for hours. `tools/long-drive` replays the recorded sessions
for a simulated 4 hours against the real server and the real bar page, disturbs them on the way, and measures
memory. It is run on request. `tools/check` and the gate never run it (nothing in `tools/check`, `tests/unit/` or
`emulator/tests/` references `tests/long/drive.js`).

## Run it

    bash tools/long-drive                 # 4 simulated hours at 30x: about 8 minutes, results in /tmp/long-drive
    bash tools/long-drive --smoke         # a 1 minute pass to see that the tool works
    bash tools/long-drive --sim-hours 2 --speedup 60 --streams 3 --samples 5 --out /tmp/my-drive

Needs `npm ci` (the script does it when `node_modules` is missing) and the preinstalled Playwright Chromium
(`PLAYWRIGHT_BROWSERS_PATH`; nothing is installed). It prints one line per step, writes `long-drive.json` (every
number below, plus the page's console errors) and `server.log`, and exits 0 when the page agreed with the server
after every disturbance and sample, 1 when it did not, 2 when the tool itself failed.
The tool cleans up after itself: on a normal end, an error, SIGINT/SIGTERM/SIGHUP it stops its server and Chromium (and
if it is killed with SIGKILL they end with it); `node --test tests/long/cleanup.test.js` checks that (run on request).

## Method

| Part | What |
|---|---|
| Replay (`tests/long/replay.js`) | The six recordings in `fixtures/sessions/*.jsonl`, 4 streams at once. A stream plays one recording after the other, in a loop; each loop is a NEW session (new session id, also inside `transcript_path`; the rest of each event is the recording's). The recordings have no timestamps, so the timing is made up and fixed: 4 s (simulated) between two events of a session, 60 s (plus 5 s per stream number) between sessions. Nothing is random: two runs post the same events in the same order. Events go to `POST /event` as the hooks do. A refused or unanswered POST is counted and NOT retried (a hook that cannot reach the server loses its event). |
| Simulated clock | Simulated time runs `--speedup` times faster than wall time (default 30). It is paused while the page is compared with the board, so a comparison never sees a half-delivered event. It keeps running during a disturbance. |
| Server | `node src/server/index.js PORT` as its own process, started with `tests/long/clock-skew.js` preloaded, with none of the Pi's flags (`--input`, `--sessions`, `--boot`, `--netmon`, `--thermal` need the wheel, tmux, the network, the Pi's sensors). |
| Page | Playwright's Chromium, headless, 1280x400, the real `src/view/` page loaded from the server through a small proxy (`startProxy` in `tests/long/drive.js`) that forwards with the Host and Origin the server expects. The proxy is what makes "the network" cuttable; the hooks do not go through it. |
| Comparison | After each disturbance and at each sample, with the replay stopped and every POST answered: `GET /state` of the server against what the page shows: `data-seq`, `data-view`, the state word, and for the four working views the tool and file lines. It polls for up to 20 s and counts a miss as a FAILED comparison (the run goes on). It does not compare the output lines, the command or the diff counts. |
| Measurements | Server RSS and peak RSS from `/proc/PID/status`. Page JS heap and node counts from CDP `Performance.getMetrics`, read before and after a forced garbage collection (`HeapProfiler.collectGarbage`), plus `document.getElementsByTagName('*').length`. At the start, at 7 evenly spread points and at the end. |

Disturbances (`PLAN` in `drive.js`; positions are a fraction of the simulated run, outage lengths are wall time):

| Kind | What it does |
|---|---|
| `sse-reset` | The proxy destroys every connection of the page (the open event stream too); new ones are accepted at once. |
| `sse-drop` | The same, and for 4 s new connections are refused. |
| `network-loss` | The same, refused for 25 s. The server keeps receiving events. |
| `server-kill` | `kill -9` of the server, down 3 s (or 20 s), started again on the same port. Board and sequence number start from zero (no persistence, by design). Events posted meanwhile are lost. |
| `server-term` | `SIGTERM` (the clean stop), down 2 s, started again. |
| `clock-jump` | `Date.now()` of the server jumps by +6 h, later by -2 h (a `SIGUSR2` makes the preload re-read the offset), and `Date.now()` of the page the same. Only `Date.now()` moves; timers stay monotonic. The kernel clock is not touched (that needs root). |

## The run (2026-11-25, dev VM, 4 cores, Node 22, Playwright Chromium)

"Simulated 4 hours" really was: **240 simulated minutes in 480 s of running time (481 s total), speed-up factor 30**
(wall clock time at 30 times its speed), **7805 events posted** (0.54 per simulated second, about 16 per wall second)
from 4 streams over **420 sessions** (69 to 71 of each of the 6 recordings). 7366 were accepted; **439 were refused
because the server was down** (48 + 50 + 341 across the three restarts, equal to the failures counted). Nothing was
tuned after seeing a result; the plan and the numbers are those of the first full run.

Memory (all from `long-drive.json`; the heap is the page's JS heap, "after GC" is after a forced collection):

| Point | Sim min | Wall s | Events | Server RSS kB | Server peak RSS kB | JS heap kB | JS heap after GC kB | DOM nodes | JS listeners |
|---|---|---|---|---|---|---|---|---|---|
| start | 0 | 0 | 0 | 69012 | 69012 | 1884 | 1268 | 42 | 16 |
| middle 1 | 30 | 61 | 990 | 70936 | 71616 | 1868 | 1448 | 41 | 16 |
| middle 2 | 60 | 121 | 1939 | 69864 | 72004 | 1872 | 1453 | 42 | 16 |
| middle 3 | 90 | 180 | 2928 | 70576 | 72004 | 1735 | 1457 | 41 | 16 |
| middle 4 | 123 | 246 | 4010 | 71032 | 72252 | 2050 | 1470 | 41 | 16 |
| middle 5 | 150 | 301 | 4886 | 69684 | 70712 | 1737 | 1473 | 42 | 16 |
| middle 6 | 180 | 361 | 5866 | 70416 | 70848 | 1581 | 1473 | 41 | 16 |
| middle 7 | 210 | 421 | 6836 | 70060 | 70652 | 1910 | 1475 | 41 | 16 |
| end | 240 | 481 | 7805 | 70860 | 71956 | 1963 | 1475 | 41 | 16 |

What the numbers show: nothing grew. DOM nodes stayed at 41 to 42 and listeners at 16 (one document). The heap after
GC went from 1268 to 1448 kB in the first 30 minutes (the first states drawn) and then rose by 27 kB over the next
3.5 hours (1448 to 1475, in steps of 0 to 13 kB per half hour; it is flat at the end). Server RSS moved between
69.0 and 71.0 MB with no trend (the server was restarted three times; each sample is of the process running then, so
"RSS at the end" is 70.9 MB of a server that had run since 202 simulated minutes). The one thing that grows with
the board is the size of `/state` (391 to 435 bytes, depending on which sessions are on it, no trend). The server's own log held only its four start banners.

Disturbances (each: the page was compared with `GET /state` afterwards, replay stopped):

| # | Sim min | Disturbance | Page saw | Link back after | Events lost | Page agreed with the board |
|---|---|---|---|---|---|---|
| 1 | 20 | sse-reset | NO LINK | 1030 ms (the 1 s EventSource retry) | 0 | yes (view permission, seq 644) |
| 2 | 50 | server-kill, 3 s down | NO LINK | 925 ms after the server listened | 48 | yes (working, seq 16: a fresh board) |
| 3 | 80 | clock-jump +6 h | no change | 3 ms (never down) | 0 | yes (working, seq 986) |
| 4 | 123 | network-loss, 25 s | NO LINK | 108 ms after it came back | 0 | yes (working, seq 2385) |
| 5 | 141 | server-term, 2 s down | NO LINK | 826 ms after the server listened | 50 | yes (working, seq 11) |
| 6 | 169 | clock-jump -2 h | no change | 3 ms | 0 | yes (working, seq 911) |
| 7 | 202 | server-kill, 20 s down | NO LINK | 125 ms after the server listened | 341 | yes (working, seq 3) |
| 8 | 218 | sse-drop, 4 s | NO LINK | 112 ms after it came back | 0 | yes (permission, seq 518) |

Start, the 7 samples and the end were compared too: 0 failed comparisons of 17. The page raised no uncaught error and
did not crash. It logged 56 console errors, all `Failed to load resource: net::ERR_...` of the event stream being cut
(connection reset, empty response, incomplete chunked encoding); the smoke run shows the same kinds.

## What this does NOT show

- **Real-time timers.** The replay is 30 times faster than a drive, but the server's own timers run in real time and
  were not stretched: the 180 s compaction limit, the 30 s launch limit, the 60 s boot limit, the 15 s SSE ping, the
  5 s and 10 s polls, the permission "too early" interval. At 30x a session's events come faster than those timers
  tick. Only a real-time run (bench LD-4) exercises them.
- **Chromium's own long-run behaviour on the Pi.** This is Playwright's Chromium on x86 in headless mode, not the
  kiosk's Chromium on the Pi's ARM and GPU. The JS heap and node count are the page's; the browser's total memory
  (renderer, GPU process, caches, the compositor) was not measured, and the Pi's compositing and its fonts are not
  here (bench LD-1, LD-2).
- **A real clock jump.** Only `Date.now()` was moved, in the server and in the page; neither the page's code nor
  the server's state path reads the wall clock (the permission and action timers use `performance.now()`; the only
  `Date.now()` users are the gesture log and the thermal monitor, which the run did not use). The kernel clock, the
  JavaScript timers' behaviour when it steps, TLS and cache expiry were not touched (bench LD-3).
- **A real network.** The "network" cut was the page's own link to the server (a proxy). The Wi-Fi, the netmon
  OFFLINE view and the hotspot were not involved (the server ran without `--netmon`), see bench LD-5.
- **The wheel, tmux, speech and the thermal monitor** (no `--input`, `--sessions`, `--boot`, `--thermal`), and any real
  Claude session. The events are the recorded ones, with made-up timing.
- **Hours.** 4 simulated hours were 8 minutes. Anything that grows by wall time rather than by events (a leak in a
  timer, in the service worker's cache, in the connection table) would not show in 8 minutes.
- What the comparison does not look at (the output lines, command and diff of the page) was not checked after the
  disturbances.

A restart of the server shows, by design (no persistence, `src/server/README.md`), a fresh board: after the restarts
the bar showed what the first events afterwards made of it (for example WORKING with sequence number 3), not what the
sessions had been doing before. The comparison is against the board the server has, as the task asked.

## Files

| Path | What |
|---|---|
| `tools/long-drive` | The command (bash; checks nothing, installs nothing). |
| `tests/long/drive.js` | The run: server, page, proxy, disturbances, comparison, measurements. Not under `tests/unit/` or `emulator/tests/`, so no test runner picks it up. |
| `tests/long/replay.js` | The replay (loading the recordings, new session ids, the simulated clock, the POSTs). |
| `tests/long/clock-skew.js` | The server's `Date.now()` offset preload. |
| `tests/unit/long-replay.test.js` | Smoke test of the replay (a fake wall clock, one test against a real in-process server): runs in under a second in the gate. 25 runs in a row under 6 busy loops on 4 cores passed. |
