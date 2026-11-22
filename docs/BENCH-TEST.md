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
| 16 | In the car, by day with sun on the screen, glance for about one second at each state (gallery screenshots as reference) from the driving position | The state word, its colour and its shape are recognised in one glance; the two detail lines are readable when you choose to look a little longer. Type is set to 10.6 mm (state word) and 6.1 mm (other text) cap height, judged for roughly 700-800 mm viewing distance | untested |
| 17 | At night, same glance | The coloured band does not dazzle; if it does, note which states (a dimmer night palette or panel brightness is the fix) | untested |
| 18 | On the Pi, show each state (`?fixture=<state>` through `node emulator/serve.js`) and measure the cap height of a capital letter on the glass with a ruler or calipers | State word about 10.6 mm, other text about 6.1 mm (the emulator measured 10.69 and 6.23 mm); the band text fits on one line, "NEEDS PERMISSION" included | untested |
| 19 | Check the Pi has the fonts the view asks for: `fc-list | grep -i dejavu` (and a CJK font such as `fonts-wqy-zenhei` if Chinese/Japanese file names matter) | DejaVu Sans, DejaVu Sans Bold and DejaVu Sans Mono present; without a CJK font such names show as boxes | untested |
| 20 | Run `npm start` on the Pi, open `http://127.0.0.1:8138/` in Chromium kiosk, then POST a line of `fixtures/sessions/working-turn.jsonl` with `curl -s -X POST --data-binary @- http://127.0.0.1:8138/event` | The page goes from STARTING to the posted state within about a second | untested |
| 21 | With the kiosk showing the live page, stop the server (Ctrl-C), wait 10 s, start it again | The page shows STARTING while the server is away and follows events again by itself after it is back, with no reload and no touch | untested |
| 22 | Boot the Pi with the server started before Chromium, and once with Chromium started first | Both end with the live page following events; with Chromium first it shows STARTING until the server is up (if Chromium shows an error page instead, the kiosk start script must wait for the server) | untested |
| 23 | On the Pi, measure the time from a curl POST to the change on the screen, and the CPU use of Chromium while idle on the page | Change well under a second; idle CPU near zero (the page has no animation or polling) | untested |

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
