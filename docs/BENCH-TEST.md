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
| 27 | Wheel buttons (docs/BUTTONS.md). Plug in the dongle, run `sudo evtest`, press each button and each combo of both pods | One key code per button; write the codes into the key map in the config (`config/buttons.json`, `buttons[].key`, e.g. `"F13"` or `"Shift+F24"`; only F1-F24 with Ctrl/Shift/Alt/Meta are accepted, other codes need a code change). Compare with the keymap table in BUTTONS.md section 1 | untested |
| 28 | Hold one key for 3 s in `evtest` | Exactly one press and one release; kernel auto-repeat lines (value 2) may appear, note them. The gesture detector ignores value 2 (unit-tested on synthetic traces only). Then, with `node src/server/index.js --input`, hold F14 for 1 s and tap F13: `curl -s http://127.0.0.1:8138/buttons` lists one `read-aloud` `hold` and one `push-to-talk` `tap`, nothing else | untested |
| 29 | Leave each pod untouched for 10+ minutes (it sleeps), then press once | The first press is seen, not lost (extends item 2 to the pods) | untested |
| 30 | Switch the car on and off: pods, dongle and Pi start from cold | Buttons work again; note how many seconds after the Pi boots the first press is seen | untested |
| 31 | Measure the time from a button press to the action (key at the terminal, hook answer at Claude) | Under 100 ms; note the median and the worst of 20 presses | untested |
| 32 | With the reader running inside the server (`node src/server/index.js --input`; the grab is taken by `src/input/grab.py`, python3 `fcntl.ioctl` EVIOCGRAB), press F13-F24 at the console and in Chromium. Then run `sudo evtest --grab` on the dongle's node while revview runs | The keys reach neither the console nor Chromium nor any terminal; only revview sees them (`GET /buttons`). evtest's second grab fails while revview holds it. If the server logs `cannot grab`, note the error | untested |
| 33 | Unplug the dongle while the view runs, then plug it in again | A small NO BUTTONS tag (outlined, right end of the band) shows within about a second while it is away (the reader retries every 1 s), the bar still shows Claude, and buttons work again after replug with no restart. Hold F15 and pull the dongle mid-hold: no cancel gesture appears in `GET /buttons`. The tag is not shown during STARTING | untested |
| 34 | `/voice tap` mode, push-to-talk button sends Space to the selected session (input empty) | The first press starts recording, the second stops and submits the transcript | untested |
| 35 | `/voice hold` mode with the button imitating key auto-repeat (Space about every 50 ms while held) | Recording starts while held and stops on release. Expect it may fail: it depends on Claude Code's own timing | untested |
| 36 | Two sessions, select the second by button, press push-to-talk | Only the selected session gets the transcript; the bar shows which one it is | untested |
| 37 | On the Pi, with a permission prompt shown, press allow, then in a second prompt deny (waiting PermissionRequest hook) | Allow runs the command, deny shows "Denied by PermissionRequest hook"; the dialog goes away within about 1.5 s | untested |
| 38 | Read aloud over the 3.5 mm jack into the car's AUX; stop it with the hold; press push-to-talk while it speaks | Speech is clear over cabin noise, stops on the hold, and push-to-talk stops it first | untested |
| 39 | Coin-cell pod battery life: note the voltage or the date it stops working | Several weeks of normal use; note the number | untested |
| | Note | Items 1 and 2 (a single 2.4 GHz remote) are superseded by items 27 and 29 if the owner confirms the pods. | |

## Wheel buttons input layer, WB2 (2026-11-22)

What the input layer (`src/input/`) assumes and could not test without the dongle. Items 27, 28, 32 and 33
above cover the key codes, repeat, the grab and replug. Ids `W1`... are new.

| # | Try | Should happen | State |
|---|---|---|---|
| W1 | With the dongle in: `cat /proc/bus/input/devices` and find its blocks (one per event node) | Note `Vendor`, `Product` and `Name` of each, and which node has `kbd` in `Handlers` and F13-F24 in its `B: KEY=` bits. Put vendor/product (or the name) into `config/buttons.json` `device` (shipped: ZMK's default 1d50:615e, unverified). The reader picks the first `kbd` node that has a bound key in its bits; the server log must not say `device not found` | untested |
| W2 | On the Pi: `uname -m`, `getconf LONG_BIT`, `python3 --version`, and `id` of the user that runs the server | `aarch64` and `64` (the 24-byte `input_event` layout and 64-bit `B: KEY=` words are assumed), a python3 (the grab helper uses only its standard library), and the user is in the `input` group or can otherwise read the node. On a 32-bit image the parser size must change to 16 | untested |
| W3 | Run the server with `--input` and watch its stderr while unplugging and replugging the dongle 5 times | One `lost` / `device not found` line per unplug, no line repeated every second, no crash; `curl -s http://127.0.0.1:8138/state` shows `"buttons":"missing"` and `"present"` to match | untested |
| W4 | In the car, tap and hold each pod button (cancel for over 1 s; back and read aloud for about half a second) | Taps are never read as holds and holds fire when expected (400 ms hold, 1000 ms long hold, 30 ms debounce). If not, change `timing` in `config/buttons.json` and note the values | untested |
| W5 | Hold the grab (server running with `--input`), then `kill -9` the server (`pgrep -f grab.py` before and after) | The grab helper exits within about 1-2 s, `evtest` on the device (or the keys reaching the console) shows it free within about 1 s, including when the server dies right at startup (the helper gets the server's pid as an argument and exits when that pid is gone), and a restarted server grabs without `cannot grab` | untested |

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
| H9 | On the Pi, with another Claude session open, let each session in turn ask for permission and finish its turn | WAITING FOR ME and NEEDS PERMISSION show `+1` and the repo of the session that needs you (in the band, or bold at the right end of row A), readable in a glance | untested |
| H10 | Reboot the Pi and film the screen from the start of Chromium to the first live state | No frame is an empty coloured band: boot NO LINK, then NO LINK of the live page, then UNKNOWN. How long the NO LINK frames last on the Pi is not known | untested |
