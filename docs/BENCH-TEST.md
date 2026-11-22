# Bench tests

Steps that can only be proven on the real Pi, screen, mic, button or car. Each item says what to try, what
should happen, and its state: `untested` until the owner reports back. The team adds items as it builds;
these are the first ones.

| # | Try | Should happen | State |
|---|---|---|---|
| 1 | Plug in the 2.4 GHz remote's dongle, run `sudo evtest`, pick the remote, press its button | One key event per press; note the key name for keyd | untested |
| 2 | Leave the remote untouched for 10 minutes, then press once | The first press is seen (no lost wake-up press) | untested |
| 3 | Pull the power while Claude Code is working, then power on | Boots to the view; no file system repair, no lost repository | untested |
| 4 | Screen on HDMI0 through the micro-HDMI cable, rotated to 1280×400 | Picture and touch both the right way round | untested |
| 5 | Hotspot off, then press push-to-talk | The view says offline; nothing is lost silently | untested |
| 6 | Boot without the key stick, then plug it in | The view says "insert key"; with the stick in, the data unlocks with no typing | untested |
| 7 | Boot with the stick, pull it out while running | Nothing breaks while driving; the next boot without it stays locked | untested |
| 8 | On the Pi, let Claude finish a turn and do nothing for two minutes | The view goes to done at once, then to waiting about a minute later (Claude Code's idle notification) | untested |
| 9 | On the Pi, with its real permission settings, ask for something that needs permission | The view shows needs-permission with the tool; after the answer it goes back to working | untested |
| 10 | On the Pi, start a session in a repository on a branch other than main | The view shows the repository and that branch (needs the hook wiring, not built yet) | untested |
| 11 | Show each state on the Pi (Chromium kiosk) and compare with the emulator's screenshots | Same layout, nothing cut off; text sizes as the emulator measured them. The emulator uses headless Chromium on this VM with its fonts (DejaVu/FreeSans); the Pi's fonts, hinting and rendering differ, so type sizes and line fits are not proven | untested |
| 12 | In the car, by day (sun on the screen) and at night, glance at each state from the driving position | State word and colour readable in a one-second glance; not dazzling at night. The emulator cannot judge contrast, brightness or glare | untested |
| 13 | Measure the panel's active area with a ruler | About 190 x 60 mm; if not, correct `src/view/panel.js` (re-exported by `emulator/panel.js`; all mm figures depend on it) | untested |
| 14 | On the Pi, check the screen is really driven at 1280x400 with no scaling (device pixel ratio 1, no overscan or black border) | The page fills the panel exactly, like the 1280x400 viewport in the emulator | untested |
| 15 | Hold the developer page's strip (`emulator/dev/`, calibrated) next to the real panel | Same size and text size by eye; if not, the calibration or the panel size is off | untested |
| 16 | In the car, by day with sun on the screen, glance for about one second at each state (gallery screenshots as reference) from the driving position | The state word, its colour and its shape are recognised in one glance; the two detail lines are readable when you choose to look a little longer. Type was 10.6 mm (state word) and 6.1 mm (other text) cap height when this item was written; since 2026-11-22 it is 6.05 / 3.55 mm design (owner's choice, see item 26) | untested |
| 17 | At night, same glance | The coloured band does not dazzle; if it does, note which states (a dimmer night palette or panel brightness is the fix) | untested |
| 18 | On the Pi, show each state (`?fixture=<state>` through `node emulator/serve.js`) and measure the cap height of a capital letter on the glass with a ruler or calipers | State word about 6.0 mm, other text about 3.5 mm (design 6.05 / 3.55; the emulator measured 5.94 and 3.41 mm; changed on 2026-11-22 from 10.6 / 6.1); the band text fits on one line, "NEEDS PERMISSION" included | untested |
| 19 | Check the Pi has the fonts the view asks for: `fc-list | grep -i dejavu` (and a CJK font such as `fonts-wqy-zenhei` if Chinese/Japanese file names matter) | DejaVu Sans, DejaVu Sans Bold and DejaVu Sans Mono present; without a CJK font such names show as boxes | untested |
| 20 | Run `npm start` on the Pi, open `http://127.0.0.1:8138/` in Chromium kiosk, then POST a line of `fixtures/sessions/working-turn.jsonl` with `curl -s -X POST --data-binary @- http://127.0.0.1:8138/event` | The page goes from NO LINK (briefly) and UNKNOWN to the posted state within about a second; the first paint is the NO LINK look, never an empty grey band | untested |
| 21 | With the kiosk showing the live page, stop the server (Ctrl-C), wait 10 s, start it again | The page shows NO LINK while the server is away, then UNKNOWN once it is back (a restarted server knows nothing), and follows events again by itself, with no reload and no touch | untested |
| 22 | Boot the Pi with the server started before Chromium, and once with Chromium started first | Both end with the live page following events; with Chromium first (started on `boot.html`) it shows NO LINK until the server is up (if Chromium shows an error page instead, the kiosk start script must wait for the server) | untested |
| 23 | On the Pi, measure the time from a curl POST to the change on the screen, and the CPU use of Chromium while idle on the page | Change well under a second; idle CPU near zero (the page has no animation or polling) | untested |
| 24 | Check the Pi has a colour-emoji font: `fc-list | grep -i emoji` (e.g. `fonts-noto-color-emoji`) | A colour emoji font is present; without one, emoji in commands or output render as boxes or monochrome glyphs of other widths and the layout is not proven (the emulator VM has Noto Color Emoji; see `emulator/worst-case/cjk-wide.json`) | untested |
| 25 | On the Pi run `node --version` (and note how Node was installed: the Debian / Raspberry Pi OS package may be older, not checkable here) | Version 22 or newer (`package.json` engines; DECISIONS pins Node 22); otherwise `npm start` fails or misbehaves | untested |
| 26 | On the Pi, in the car at the driving position (about 700-800 mm from the eyes, on the dash), by day (sun on the screen) and at night, with each of `?fixture=working`, `permission`, `done`, a long Bash command and one with 3 output lines: read the 3.5 mm text (tool, file, command, output, diff) and glance for one second at the 6 mm state word | At a one-second glance the state word, colour and shape are recognised; with a deliberate look the command and the last output lines are readable without leaning in; the 7-row layout is not too cramped (rows distinguishable, nothing cut off). Fail if the 3.5 mm text needs more than a short look or leaning in: then the sizes (`TYPE_MM` in `src/view/type.js`) go up. Only the emulator measured the sizes (5.94 and 3.41 mm cap height); legibility at distance, glare and night is not proven | untested |

## Honest states (2026-11-22)

These replace what items 21 and 22 expect while the server is away: the page now shows NO LINK (black band,
white outline, broken-link shape), not STARTING, and a restarted server shows UNKNOWN until Claude's next
hook. Ids are `H1`... so they do not clash with numbers added elsewhere.

| # | Try | Should happen | State |
|---|---|---|---|
| H1 | Kiosk on `file://<install>/src/view/boot.html?port=8138`, boot with Chromium started before the server | NO LINK "Waiting for the revview server" (never a white page), then the live view by itself within about a second of the server being up | untested |
| H2 | Same, server started first | The boot page is replaced by the live view after about a second | untested |
| H3 | With the live page showing WAITING FOR ME, stop the server, wait 10 s, start it again | NO LINK while it is away, then UNKNOWN ("Push-to-talk may still work"); push-to-talk then works and the next hook shows the real state | untested |
| H4 | Quit Claude Code (`/exit`) | CLAUDE EXITED within about a second | untested |
| H5 | Run a second Claude session (another terminal) while the first works | The bar shows `+1`; a permission prompt in either session shows NEEDS PERMISSION | untested |
| H6 | At night and by day, glance at UNKNOWN, CLAUDE EXITED and NO LINK (gallery: `unknown.png`, `ended.png`, `no-link.png`, `boot.png`) | Each is recognised as itself in one glance and not mistaken for STARTING or a working state; the black NO LINK band is not taken for a switched-off screen | untested |
| H7 | Check that Chromium on the Pi lets `boot.html` (a `file://` page) fetch `http://127.0.0.1:8138/state` (it does in the emulator's Chromium; a newer Chromium's local-network rules may differ) | H1 works; if not, note the Chromium version and console error | untested |

## Several sessions and subagents (2026-11-22)

Payload assumptions the state core rests on that no recording covers yet (see `src/state/README.md`,
"Payload assumptions"), plus the multi-session behaviour on the real terminal. Ids `B1`... are new.

| # | Try | Should happen | State |
|---|---|---|---|
| B1 | In a session, let Claude run a Bash command that needs permission and choose "No" (not Esc) | NEEDS PERMISSION ends at once (WORKING or DONE); if it stays until the next prompt, note which hook fired (a recording would show it) | untested |
| B2 | Ask Claude for two subagents in one message, one of them needing permission; press Esc on that prompt | NEEDS PERMISSION ends at the latest at the next Stop; if it stays longer, record the session | untested |
| B3 | Same as B2 but approve after the other subagent has finished | NEEDS PERMISSION the whole time until the approval, then WORKING, DONE when all results are in | untested |
| B4 | Two terminals: speak to the first (it works), open a second Claude in another repo and leave it at its prompt | The bar keeps showing the first one WORKING with `+1`; never WAITING FOR ME for the idle second one | untested |
| B5 | Two terminals both working; then let the one you spoke to finish | The bar stays on the session you spoke to (repo, tool and diff do not jump); DONE, and about a minute later the other one's WORKING | untested |
| B6 | A long task that triggers auto compaction (watch for "Compacting conversation") | WORKING the whole time, never WAITING FOR ME | untested |
| B7 | Let Claude ask for a Bash permission in the main thread and press Esc; wait about 70 s without typing | NEEDS PERMISSION turns into WAITING FOR ME when Claude Code sends `idle_prompt` (derived from the 2.1.330 binary, not recorded); if it stays, `idle_prompt` did not arrive: record the session | untested |
| H8 | With the kiosk on the live page (loaded once from the running server), stop the server, wait 2 s, reload the page (F5 on a keyboard, or kill the Chromium renderer so it reloads), then start the server | NO LINK instead of Chromium's white error page, and live again within about 2 s of the server being up. If a white page shows, the service worker is not active on the Pi (check `chrome://serviceworker-internals`) and the kiosk must always start on `boot.html` with session restore off | untested |
| H9 | On the Pi, with another Claude session open, let each session in turn ask for permission and finish its turn | WAITING FOR ME and NEEDS PERMISSION show `+1` and the repo of the session that needs you (in the band, or bold at the right end of line 3), readable in a glance | untested |
| H10 | Reboot the Pi and film the screen from the start of Chromium to the first live state | No frame is an empty coloured band: boot NO LINK, then NO LINK of the live page, then UNKNOWN. How long the NO LINK frames last on the Pi is not known | untested |
