# Bench tests

Steps that can only be proven on the real Pi, screen, mic, button or car. Each item says what to try, what
should happen, and its state: `untested` until the owner reports back. The team adds items as it builds;
these are the first ones.

**Service and hand-started servers.** On the installed Pi the revview service already listens on port 8138 (and, with
`--input`, holds the dongle exclusively). Items that start `npm start` or `node src/server/index.js` by hand (20, 21,
28, 32, W3, W5) need: stop the service first, `systemctl --user stop revview` as the kiosk user, and
`systemctl --user start revview` afterwards. Every First afternoon item uses the running service; none starts a server by hand, so the service stays up for the whole list. Or use another port, e.g. `node /opt/revview/src/server/index.js 8139`
(not with `--input`: the service's grab of the dongle would conflict).

All ids are unique. The Stage 2 hook series is `HW1`-`HW7`; `H1`-`H10` are the Honest states. Every item stays
`untested` until the owner reports back; nothing here has been run on the Pi.

## First afternoon

Do these, in this order, before the first useful drive. Each line says what it needs first. **Every other section
below is reference, to do later**, in any order. The owner's dongle ids and key map now live in
`/etc/revview/buttons.json` (the installer writes it only when it is missing, so updates keep it).

1. **P1** install on a fresh flash (`/opt/revview/pi/install.sh`). Needs: the steps of `pi/README.md` before it.
2. **P3** quiet boot. Needs: P1.
3. **P4** screen rotation and touch. Needs: P1.
4. **P5** automatic login, no desktop. Needs: P1.
5. **P6** kiosk look. Needs: P5.
6. **D1** the service runs as the user unit, also after a reboot. Needs: P1.
7. **D5** real dongle ids, written to `/etc/revview/buttons.json`. Needs: D1, the dongle in.
8. **D6** each key's code, one press one release. Needs: D5.
9. **D13** the edited ids survive an installer re-run. Needs: D5.
10. **W1** and **27** the dongle block and the key map in `/etc/revview/buttons.json`. Needs: D5, D6.
11. **P14** audio and groups: the USB mic from inside the service's tmux session. Needs: D1.
12. **P21** SoX present (`rec`) and `/voice tap` works. Needs: P1, P14.
13. **S1** voice tap by the push-to-talk button, in the service's own session (service running). Needs: D1, D6, W1/27, P14, P21.
14. **HW1** hook install (service running; this also installs the hooks S3 needs), a small task shown on the bar. Needs: P1, D1.
15. **P13** key-on session and hooks from a real task. Needs: HW1, D1, S1.
16. **S3** allow and deny by button, in the key-on session of P13 (service running; hooks already installed by HW1). Needs: HW1, D6, W1/27, P13.
17. **S4B-1** the read-only overlay, last: every later test then runs under it. Needs: all the above done; the data set-up (S4B-9) first if it is used.
18. **26** the in-car glance at the sizes. Needs: P4, P5, P13.


| # | Try | Should happen | State |
|---|---|---|---|
| 1 | Plug in the 2.4 GHz remote's dongle, run `sudo evtest`, pick the remote, press its button | One key event per press; note the key name for keyd | untested; superseded by 27 and 29 |
| 2 | Leave the remote untouched for 10 minutes, then press once | The first press is seen (no lost wake-up press) | untested; superseded by 27 and 29 |
| 3 | Pull the power while Claude Code is working, then power on | Boots to the view; no file system repair, no lost repository | untested; superseded by S4B-3 |
| 4 | Screen on HDMI0 through the micro-HDMI cable, rotated to 1280×400 | Picture and touch both the right way round | untested |
| 5 | Hotspot off, then press push-to-talk | The view says offline; nothing is lost silently | untested; superseded by P12 |
| 6 | Boot without the key stick, then plug it in | The view says "insert key"; with the stick in, the data unlocks with no typing | untested; superseded by S4B-4 + S4B-5 |
| 7 | Boot with the stick, pull it out while running | Nothing breaks while driving; the next boot without it stays locked | untested; superseded by S4B-6 |
| 8 | On the Pi, let Claude finish a turn and do nothing for two minutes | The view goes to done at once, then to waiting about a minute later (Claude Code's idle notification) | untested |
| 9 | On the Pi, with its real permission settings, ask for something that needs permission | The view shows needs-permission with the tool; after the answer it goes back to working | untested |
| 10 | On the Pi, start a session in a repository on a branch other than main | The view shows the repository and that branch (hook wiring built in stage 2, see HW1) | untested |
| 11 | Show each state on the Pi (Chromium kiosk) and compare with the emulator's screenshots | Same layout, nothing cut off; text sizes as the emulator measured them. The emulator uses headless Chromium on this VM with its fonts (DejaVu/FreeSans); the Pi's fonts, hinting and rendering differ, so type sizes and line fits are not proven | untested |
| 12 | In the car, by day (sun on the screen) and at night, glance at each state from the driving position | State word and colour readable in a one-second glance; not dazzling at night. The emulator cannot judge contrast, brightness or glare | untested |
| 13 | Measure the panel's active area with a ruler | About 190 x 60 mm; if not, correct `src/view/panel.js` (re-exported by `emulator/panel.js`; all mm figures depend on it) | untested |
| 14 | On the Pi, check the screen is really driven at 1280x400 with no scaling (device pixel ratio 1, no overscan or black border) | The page fills the panel exactly, like the 1280x400 viewport in the emulator | untested |
| 15 | Hold the developer page's strip (`emulator/dev/`, calibrated) next to the real panel | Same size and text size by eye; if not, the calibration or the panel size is off | untested |
| 16 | In the car, by day with sun on the screen, glance for about one second at each state (gallery screenshots as reference) from the driving position | The state word, its colour and its shape are recognised in one glance; the two detail lines are readable when you choose to look a little longer. Type was 10.6 mm (state word) and 6.1 mm (other text) cap height when this item was written; since 2026-11-22 it is 6.05 / 3.55 mm design (owner's choice, see item 26) | untested |
| 17 | At night, same glance | The coloured band does not dazzle; if it does, note which states (a dimmer night palette or panel brightness is the fix) | untested |
| 18 | On the Pi, show each state (`?fixture=<state>` through `node emulator/serve.js`) and measure the cap height of a capital letter on the glass with a ruler or calipers | State word about 6.0 mm, other text about 3.5 mm (design 6.05 / 3.55; the emulator measured 5.94 and 3.41 mm; changed on 2026-11-22 from 10.6 / 6.1); the band text fits on one line, "NEEDS PERMISSION" included | untested |
| 19 | Check the Pi has the fonts the view asks for: `fc-list | grep -i dejavu` (and a CJK font such as `fonts-wqy-zenhei` if Chinese/Japanese file names matter) | DejaVu Sans, DejaVu Sans Bold and DejaVu Sans Mono present; without a CJK font such names show as boxes | untested |
| 20 | Run `npm start` on the Pi (stop the service first: `systemctl --user stop revview` as the kiosk user, `systemctl --user start revview` afterwards; or use another port, e.g. `node /opt/revview/src/server/index.js 8139`), open `http://127.0.0.1:8138/` in Chromium kiosk, then POST a line of `fixtures/sessions/working-turn.jsonl` with `curl -s -X POST --data-binary @- http://127.0.0.1:8138/event` | The page goes from NO LINK (briefly) and UNKNOWN to the posted state within about a second; the first paint is the NO LINK look, never an empty grey band | untested |
| 21 | With the kiosk showing the live page, stop the server (Ctrl-C if started by hand, else `systemctl --user stop revview`), wait 10 s, start it again (`systemctl --user start revview` if the service) | The page shows NO LINK while the server is away, then UNKNOWN once it is back (a restarted server knows nothing), and follows events again by itself, with no reload and no touch | untested; superseded by H3 |
| 22 | Boot the Pi with the server started before Chromium, and once with Chromium started first | Both end with the live page following events; with Chromium first (started on `boot.html`) it shows NO LINK until the server is up (if Chromium shows an error page instead, the kiosk start script must wait for the server) | untested; superseded by H1 + H2 + P10 |
| 23 | On the Pi, measure the time from a curl POST to the change on the screen, and the CPU use of Chromium while idle on the page | Change well under a second; idle CPU near zero (the page has no animation or polling) | untested |
| 24 | Check the Pi has a colour-emoji font: `fc-list | grep -i emoji` (e.g. `fonts-noto-color-emoji`) | A colour emoji font is present; without one, emoji in commands or output render as boxes or monochrome glyphs of other widths and the layout is not proven (the emulator VM has Noto Color Emoji; see `emulator/worst-case/cjk-wide.json`) | untested |
| 25 | On the Pi run `node --version` (and note how Node was installed: the Debian / Raspberry Pi OS package may be older, not checkable here) | Version 22 or newer (`package.json` engines; DECISIONS pins Node 22); otherwise `npm start` fails or misbehaves | untested |
| 26 | On the Pi, in the car at the driving position (about 700-800 mm from the eyes, on the dash), by day (sun on the screen) and at night, with each of `?fixture=working`, `permission`, `done`, a long Bash command and one with 3 output lines: read the 3.5 mm text (tool, file, command, output, diff) and glance for one second at the 6 mm state word | At a one-second glance the state word, colour and shape are recognised; with a deliberate look the command and the last output lines are readable without leaning in; the 7-row layout is not too cramped (rows distinguishable, nothing cut off). Fail if the 3.5 mm text needs more than a short look or leaning in: then the sizes (`TYPE_MM` in `src/view/type.js`) go up. Only the emulator measured the sizes (5.94 and 3.41 mm cap height); legibility at distance, glare and night is not proven | untested |
| 27 | Wheel buttons (docs/BUTTONS.md). Plug in the dongle, run `sudo evtest`, press each button and each combo of both pods | One key code per button; write the codes into the key map in `/etc/revview/buttons.json` (the owner's copy, kept across updates; `buttons[].key`, `buttons[].key`, e.g. `"F13"` or `"Shift+F24"`; only F1-F24 with Ctrl/Shift/Alt/Meta are accepted, other codes need a code change). Compare with the keymap table in BUTTONS.md section 1 | untested |
| 28 | Hold one key for 3 s in `evtest` | Exactly one press and one release; kernel auto-repeat lines (value 2) may appear, note them. The gesture detector ignores value 2 (unit-tested on synthetic traces only). Then, with `node src/server/index.js --input` (stop the service first, see the note at the top: with `--input` the service's exclusive grab of the dongle would conflict too), hold F14 for 1 s and tap F13: `curl -s http://127.0.0.1:8138/buttons` lists one `read-aloud` `hold` and one `push-to-talk` `tap`, nothing else | untested |
| 29 | Leave each pod untouched for 10+ minutes (it sleeps), then press once | The first press is seen, not lost (extends item 2 to the pods) | untested |
| 30 | Switch the car on and off: pods, dongle and Pi start from cold | Buttons work again; note how many seconds after the Pi boots the first press is seen | untested |
| 31 | Measure the time from a button press to the action (key at the terminal, hook answer at Claude) | Under 100 ms; note the median and the worst of 20 presses | untested |
| 32 | With the reader running inside the server (`node src/server/index.js --input` (stop the service first, see the note at the top: with `--input` the service's exclusive grab of the dongle would conflict too); the grab is taken by `src/input/grab.py`, python3 `fcntl.ioctl` EVIOCGRAB), press F13-F24 at the console and in Chromium. Then run `sudo evtest --grab` on the dongle's node while revview runs | The keys reach neither the console nor Chromium nor any terminal; only revview sees them (`GET /buttons`). evtest's second grab fails while revview holds it. If the server logs `cannot grab`, note the error | untested |
| 33 | Unplug the dongle while the view runs, then plug it in again | A small NO BUTTONS tag (outlined, right end of the band) shows within about a second while it is away (the reader retries every 1 s), the bar still shows Claude, and buttons work again after replug with no restart. Hold F15 and pull the dongle mid-hold: no cancel gesture appears in `GET /buttons`. The tag is not shown during STARTING | untested |
| 34 | `/voice tap` mode, push-to-talk button sends Space to the selected session (input empty) | The first press starts recording, the second stops and submits the transcript | untested; superseded by S1 |
| 35 | `/voice hold` mode with the button imitating key auto-repeat (Space about every 50 ms while held) | Recording starts while held and stops on release. Hold mode is NOT BUILT (see S2): revview sends one Space per tap only, so this will not record | untested; superseded by S2 |
| 36 | Two sessions, select the second by button, press push-to-talk | Only the selected session gets the transcript; the bar shows which one it is | untested |
| 37 | On the Pi, with a permission prompt shown, press allow, then in a second prompt deny (waiting PermissionRequest hook) | Allow runs the command, deny shows "Denied by PermissionRequest hook"; the dialog goes away within about 1.5 s | untested; superseded by S3 |
| 38 | Read aloud over the 3.5 mm jack into the car's AUX; stop it with the hold; press push-to-talk while it speaks | Speech is clear over cabin noise, stops on the hold, and push-to-talk stops it first. Also note: the push-to-talk key can be delayed up to about 1-2 s while speech is being stopped; note whether the delay felt | untested |
| 39 | Coin-cell pod battery life: note the voltage or the date it stops working | Several weeks of normal use; note the number | untested |
| | Note | Items 1 and 2 (a single 2.4 GHz remote) are superseded by items 27 and 29 if the owner confirms the pods. | |

## Wheel buttons input layer, WB2 (2026-11-22)

What the input layer (`src/input/`) assumes and could not test without the dongle. Items 27, 28, 32 and 33
above cover the key codes, repeat, the grab and replug. Ids `W1`... are new.

| # | Try | Should happen | State |
|---|---|---|---|
| W1 | With the dongle in: `cat /proc/bus/input/devices` and find its blocks (one per event node) | Note `Vendor`, `Product` and `Name` of each, and which node has `kbd` in `Handlers` and F13-F24 in its `B: KEY=` bits. Put vendor/product (or the name) into `/etc/revview/buttons.json` `device` (the owner's copy, kept across updates) (shipped: ZMK's default 1d50:615e, unverified). The reader picks the first `kbd` node that has a bound key in its bits; the server log must not say `device not found` | untested |
| W2 | On the Pi: `uname -m`, `getconf LONG_BIT`, `python3 --version`, and `id` of the user that runs the server | `aarch64` and `64` (the 24-byte `input_event` layout and 64-bit `B: KEY=` words are assumed), a python3 (the grab helper uses only its standard library), and the user is in the `input` group or can otherwise read the node. On a 32-bit image the parser size must change to 16 | untested |
| W3 | Run the server with `--input` (the service itself does: just `journalctl --user -u revview -f`; for a hand run stop the service first, see the note at the top) and watch its stderr while unplugging and replugging the dongle 5 times | One `lost` / `device not found` line per unplug, no line repeated every second, no crash; `curl -s http://127.0.0.1:8138/state` shows `"buttons":"missing"` and `"present"` to match | untested |
| W4 | In the car, tap and hold each pod button (cancel for over 1 s; back and read aloud for about half a second) | Taps are never read as holds and holds fire when expected (400 ms hold, 1000 ms long hold, 30 ms debounce). If not, change `timing` in `config/buttons.json` and note the values | untested |
| W5 | Hold the grab (server running with `--input`, the service or a hand run after stopping the service), then `kill -9` the server (`pgrep -f grab.py` before and after) | The grab helper exits within about 1-2 s, `evtest` on the device (or the keys reaching the console) shows it free within about 1 s, including when the server dies right at startup (the helper gets the server's pid as an argument and exits when that pid is gone), and a restarted server grabs without `cannot grab` | untested |

## Wheel buttons 3: sessions and actions, WB3 (2026-11-22)

What WB3 could not prove here (no microphone, no Pi, no pods). Proven here instead: keys reach only the chosen
tmux window (stand-in and real Claude Code 2.1.330), allow/deny through the real hook for a main-session and a
subagent prompt, Esc and one Ctrl+C (`fixtures/buttons/README.md`, WB3). Ids `S1`... are new.

| # | Try | Should happen | State |
|---|---|---|---|
| S1 | Voice tap mode in a revview session: a revview session of the running service (the key-on one from `REVVIEW_START`, or New session from the menu; no hand-started server needed, so no stop of the service; if you do start one by hand with `--input`, stop the service first, see the note at the top), then `tmux -L revview attach` once to run `/voice tap` in it (and set up the microphone), detach; tap push-to-talk, speak, tap again | First tap starts recording (the pane shows it), second stops and submits the transcript, only in the chosen session. Push-to-talk sends one Space by `send-keys`; voice inside tmux was never tried | untested |
| S2 | Voice hold mode (`/voice hold`) with the push-to-talk button held | NOT BUILT: revview sends one Space per tap only, so hold mode will not record (it needs imitated key repeat). Note what the pane shows | untested |
| S3 | On the Pi, with the hooks installed (done in HW1: `node /opt/revview/hooks/install.mjs`; PermissionRequest `timeout` 600) run a session of the running service (the key-on one of P13); let Claude ask for a Bash permission; wait 2 s, press allow; next prompt: deny | Allow runs the command ("Allowed by PermissionRequest hook"); deny shows "Reason: Denied with the wheel button."; a press within 1.5 s of the prompt appearing does nothing | untested |
| S4 | Same, stop the revview server while the dialog is shown, then answer in the terminal | The dialog stays and the terminal answer works (the hook prints nothing when the server is down) | untested |
| S5 | Cancel by pod while a long command runs: tap; another run: hold over 1 s, then hold again within 5 s | Tap: Claude shows "Interrupted" and the bar leaves WORKING at once. Hold: one Ctrl+C (Interrupted, Claude does not exit); the second hold within 5 s does nothing | untested |
| S6 | A subagent's permission prompt (ask Claude to use a subagent for a command that needs permission) | The bar shows NEEDS PERMISSION; the main pane may show no dialog at all (recorded here); allow by button works. Note what happens if nobody answers for 10 minutes (not recorded) | untested |

## Honest states (2026-11-22)

These replace what items 21 and 22 expect while the server is away: the page now shows NO LINK (black band,
white outline, broken-link shape), not STARTING, and a restarted server shows UNKNOWN until Claude's next
hook. Ids are `H1`... so they do not clash with numbers added elsewhere (H8-H10 were moved here from "Several sessions"; the Stage 2 series is `HW1`-`HW7`).

| # | Try | Should happen | State |
|---|---|---|---|
| H1 | Kiosk on `file://<install>/src/view/boot.html?port=8138`, boot with Chromium started before the server | NO LINK "Waiting for the revview server" (never a white page), then the live view by itself within about a second of the server being up | untested |
| H2 | Same, server started first | The boot page is replaced by the live view after about a second | untested |
| H3 | With the live page showing WAITING FOR ME, stop the server, wait 10 s, start it again | NO LINK while it is away, then UNKNOWN ("Push-to-talk may still work"); push-to-talk then works and the next hook shows the real state | untested |
| H4 | Stop the server (`systemctl --user stop revview`, as the kiosk user) and use Claude for a turn with tools; start it again (`systemctl --user start revview`) | Claude works normally, nothing is printed by the hooks, no delay you notice; after the start the bar shows the session from its next event | untested |
| H5 | Run a second Claude session (another terminal) while the first works | The bar shows `+1`; a permission prompt in either session shows NEEDS PERMISSION | untested |
| H6 | At night and by day, glance at UNKNOWN, CLAUDE EXITED and NO LINK (gallery: `unknown.png`, `ended.png`, `no-link.png`, `boot.png`) | Each is recognised as itself in one glance and not mistaken for STARTING or a working state; the black NO LINK band is not taken for a switched-off screen | untested |
| H7 | Check that Chromium on the Pi lets `boot.html` (a `file://` page) fetch `http://127.0.0.1:8138/state` (it does in the emulator's Chromium; a newer Chromium's local-network rules may differ) | H1 works; if not, note the Chromium version and console error | untested |
| H8 | With the kiosk on the live page (loaded once from the running server), stop the server, wait 2 s, reload the page (F5 on a keyboard, or kill the Chromium renderer so it reloads), then start the server | NO LINK instead of Chromium's white error page, and live again within about 2 s of the server being up. If a white page shows, the service worker is not active on the Pi (check `chrome://serviceworker-internals`) and the kiosk must always start on `boot.html` with session restore off | untested |
| H9 | On the Pi, with another Claude session open, let each session in turn ask for permission and finish its turn | WAITING FOR ME and NEEDS PERMISSION show `+1` and the repo of the session that needs you (in the band, or bold at the right end of row A), readable in a glance | untested |
| H10 | Reboot the Pi and film the screen from the start of Chromium to the first live state | No frame is an empty coloured band: boot NO LINK, then NO LINK of the live page, then UNKNOWN. How long the NO LINK frames last on the Pi is not known | untested |

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

## Wheel buttons 4: selection, list and menu, WB4 (2026-11-22)

What WB4 could not prove here: it was built and screenshotted in the emulator with a stand-in and replayed boards
only. Run with `--input --sessions --projects <file>` (see `config/projects.example.json`), at least two revview
sessions, on the pods. Ids `V1`... are new.

| # | Try | Should happen | State |
|---|---|---|---|
| V1 | Two or three revview sessions running. Tap right and left on the pod, past the last and the first | The bar swaps to the next session each tap and wraps; the band shows the position ("2/3") and the mic; push-to-talk and cancel then act on the shown session only | untested |
| V2 | Tap up, down, then press to open the list; move with up and down; press on a row; open it again and press back | The list shows one row per session (chip, repo, state word); the highlighted row is clear in a glance (inverted, bar at its left edge); press selects that session and closes the list; back closes it with no change | untested |
| V3 | Open the menu with the menu button; choose New session, then a project row from the projects file, and press | `claude` starts in that directory in the private tmux server (`tmux -L revview ls`), the list closes, and the bar selects the new session at once, showing STARTING (then its own state from the first hook). Projects and Settings show their rows and a press changes nothing | untested |
| V4 | Hold back, with the selected session not the neediest (another one asking for permission or waiting) | The selection goes to home: needs permission, then waiting, then done, then working | untested |
| V5 | Open the list and leave the wheel alone for 10 s; then do the same in the menu and in Projects | Each closes to the normal bar by itself after about 10 s; a gesture within the 10 s starts the time again | untested |
| V6 | With the real PermissionRequest hook (as S3): switch to a session that is asking, then press allow at once (under 1.5 s); repeat after a list was open and closed by the 10 s timer | Nothing is allowed by the early press; a press 2 s after the switch (or after the close) allows. While the list is open, a press or a deny never answers anything | untested |
| V7 | Start `claude` by hand in another terminal (not through revview) and select it with left or right | The bar shows it with a crossed mic and the bottom note ("not a revview session"); push-to-talk, cancel, allow and deny do nothing for it; the crossed mic is visible at a glance | untested |
| V8 | By day and at night, from the driving position: read the list rows (3.55 mm), the highlight, the state chips, the mic glyph and the crossed mic, and the `+N` hint with the triangle | Each is recognised in about one second; the highlighted row and the crossed mic are told apart by shape, not by colour. The emulator cannot judge size, contrast or glare | untested |
| V9 | Put the projects file on the data partition (`--projects` or `REVVIEW_PROJECTS` in the service) with one good path, one relative path and one path with a `#`; reboot | The server log names the two refused entries; the menu lists only the good one; with the file missing the bar still runs and New session says "No projects" | untested |
| V10 | Choose New session on a project folder Claude Code has never been started in (a fresh folder, not under one it already trusts) | Not recorded, nothing is claimed about what Claude Code does. Check: does a folder-trust question appear in the new tmux window (`tmux -L revview attach`)? Does any hook fire before it is answered (the bar shows STARTING for up to 30 s, then UNKNOWN with the note "No events from this session yet" while the trust question is unanswered)? Can the driver see the question on the bar, and can any wheel button answer it (allow and deny only answer a permission prompt, push-to-talk sends Space)? If not, write down what the driver has to do | untested |

## Wheel buttons 6: dongle and pods, WB6 (2026-11-22)

Set-up files: `pi/` (udev rule, unit, install script) and `docs/zmk/` (ZMK reference). All written without a Pi,
dongle or pods; the ZMK details are from memory. Do the parts in order: (a) with an ordinary USB keyboard, (b) the
dongle on the desk, (c) the pods. Items 27-39 and W1-W5 already cover key codes, repeat, sleep, reconnect, latency,
the grab, replug and battery; the items below only add the steps they do not cover. Ids `D1`... are new.

| # | Try | Should happen | State |
|---|---|---|---|
| D1 | (a) Any USB keyboard. On the Pi, as root: `sudo bash /opt/revview/pi/install.sh --user NAME`; then as the kiosk user NAME: `systemctl --user status revview`, `journalctl --user -u revview -n 50`, `id` | The user unit (`/etc/systemd/user/revview.service`, enabled through `default.target.wants`) is active in NAME's manager, after a reboot too (lingering: `ls /var/lib/systemd/linger/NAME`, `loginctl show-user NAME -p Linger` says `yes`). NAME is in group `input`. No `--dev-bridge` in `ps aux \| grep index.js`; the log says `input: reading wheel buttons` and `sessions: private tmux server`. The install script runs to the end with no error | untested |
| D2 | (a) With the keyboard's USB ids (`/proc/bus/input/devices`) and keys it has (F1-F12 if it has no F13) in a copy of the config, run W1-W5 and 32-33 against the service (`ExecStart` with the copy). Then unplug it before boot and reboot the Pi; plug it in 30 s after the view is up | Same results as W1-W5, 32 and 33 as a service. With the keyboard absent at boot: the service starts without delay, the kiosk shows the view with NO BUTTONS, nothing waits (compare `systemd-analyze blame` with and without it); plugging in clears NO BUTTONS with no restart. Also boot once with the kiosk disabled and once with the service stopped until after the kiosk: no hang either way | untested |
| D3 | (a) Run a revview session, then as the kiosk user `systemctl --user restart revview`, and `tmux -L revview ls` as the same user | The session is still listed afterwards and comes back on the board (`KillMode=process` in the user unit). If the session died, note it: the unit needs another way to keep tmux apart | untested |
| D4 | (a) `pgrep -f grab.py` while the service runs, then `systemctl --user stop revview` (as the kiosk user) and `pgrep -f grab.py` | No grab helper left within about 2 s; `evtest` on the node shows it free (extends W5 to the service) | untested |
| D5 | (b) Dongle in, pods off. `lsusb`, `cat /proc/bus/input/devices`, `ls -l /dev/input/` | Note the real vendor:product (ZMK default 1d50:615e is from memory), the `Name`, and every event node it makes. Edit vendor/product in `/etc/revview/buttons.json` (the owner's copy; the installer keeps it across updates), re-run `sudo bash /opt/revview/pi/install.sh --user NAME` (it writes `/etc/udev/rules.d/70-revview-dongle.rules` from those ids; see D13), `sudo udevadm control --reload && sudo udevadm trigger --subsystem-match=input`, replug: the nodes are `root:input 0660`, and if used, `/dev/input/revview-dongle` points to the keyboard node (not the consumer control or mouse node). Server log has no `device not found` (W1) | untested |
| D6 | (b) Pods on the desk next to the dongle, paired. `sudo evtest` on the dongle's keyboard node (service stopped), press each of the 12 keys once, then hold each for 3 s | The code for each key is F13-F24, one code per key and no other key (no modifier, no extra codes). One press (value 1) and one release (value 0) per hold; list any value 2 lines (extends 27 and 28). The same through the service: `curl -s http://127.0.0.1:8138/buttons` shows taps and holds | untested |
| D7 | (b) Same, both pods pressed together, and keys of one pod pressed fast one after another | No key is lost or stuck down; no combo is sent unless one is configured; note what you see. A stuck key (press with no release) is a firmware bug to fix before the car | untested |
| D8 | (c) Pods in the car's real place. Leave them 10+ minutes (the configured idle sleep time; `docs/zmk/wheel.conf`), then press push-to-talk once. Repeat after 1 h | The first press shows up (extends 29: note the sleep time used, and whether the first press took longer than later ones) | untested |
| D9 | (c) Switch the car off and on (pods stay on the wheel, the dongle loses and regains power) | The pods reconnect by themselves and keys work; note the seconds from the Pi's view being up (extends 30). No re-pairing needed | untested |
| D10 | (c) Press and watch the screen by eye, then film the pod and screen with a phone at 60 fps or more and count frames | No delay you can notice by eye; note the frames from press to change (extends 31, which measures it). Try a shorter connection interval in `wheel.conf` if slow | untested |
| D11 | (c) Range with hands on the wheel: drive or sit in the car, hands holding the pods on the wheel, dongle at its real place; press every key 20 times, turn the wheel through its whole range | No lost or doubled presses; note any key position that fails. If it does, move the dongle or try a USB extension cable | untested |
| D12 | (c) Note the battery voltage (or the date) of both coin cells when new, after 1 week, and when a pod stops (extends 39) | A number for each pod; the owner decides whether weeks are enough | untested |
| D13 | (b) Dongle ids kept: edit vendor/product in `/etc/revview/buttons.json`, re-run `sudo bash /opt/revview/pi/install.sh --user NAME` (with the same options as the first time, e.g. `--rotate 270`), then `systemctl --user restart revview` (as the kiosk user) | The edit in `/etc/revview/buttons.json` is still there after the install, and `/etc/udev/rules.d/70-revview-dongle.rules` has the new ids; the service runs with them. (The id is D13 because D7 was already taken by the two-pods item) | untested |

## Wheel buttons 5: read aloud, WB5 (2026-11-22)

Read aloud was built and tested only with a stand-in engine. There was no audio device and no engine in the VM:
nothing here has been heard. The Piper command line and paths are from memory. Config: `config/speech.json`; the
server log says which engine it found. Ids `R1`... are new (`S1`-`S6` are taken).

| # | Try | Should happen | State |
|---|---|---|---|
| R1 | Pi with `espeak-ng` installed and no Piper: start the service, `journalctl --user -u revview -n 30` (as the kiosk user) | The log has `read aloud: espeak-ng (...)` | untested on the Pi. In the dev VM (espeak-ng 1.51, no sound card) the shipped command line was run for real into wav files: text on stdin works, exit 0 (no sound heard) |
| R2 | Pi with Piper and its voice at the `config/speech.json` paths (and alsa-utils), also with espeak-ng: start the service | The log has `read aloud: piper (...)`. Remove the voice file: the log then names espeak-ng | untested |
| R3 | Pi with neither: start the service, then tap read aloud | The log has `read aloud: no speech engine found (tried piper, espeak-ng): the read-aloud button does nothing`; the tap puts the note "Read aloud: no speech engine installed" on the screen; nothing else breaks | untested |
| R4 | Both engines, one after the other (change the order in the config): a closing message, over AUX at driving noise, from the driver's seat | Say how well each is understood on the first hearing, and which one the owner prefers. Not recorded here | untested |
| R5 | The volume: the ALSA mixer level on the headphone card (`alsamixer`, `amixer`) and the car's volume knob | Note the mixer level and the car volume where it is clear but not loud. If the level has to be set, say where (install script?) | untested |
| R6 | Tap read aloud and measure the time to the first sound (phone video, 60 fps or more). Both engines; for Piper also the first speech after a reboot and the next ones | A number in seconds for each. Note Piper's first-start cost on the Pi 4B and whether it is too slow | untested |
| R7 | While it speaks, hold read aloud. Then `pgrep espeak-ng`, `pgrep piper`, `pgrep aplay` | Silence within about 0.5 s; all three `pgrep` empty. Same with a long-hold, and with a list open | untested with sound or on the Pi. In the dev VM a real espeak-ng blocked on a full pipe was ended by stop (SIGTERM to the group) and no process was left (`tests/unit/speech-real-engine.test.js`) |
| R8 | While it speaks, tap read aloud again | The first speech stops and the new one starts; never two voices at once | untested |
| R9 | While it speaks, tap push-to-talk (tap mode), then speak. Read the transcript | The speech stops before Claude's mic opens (Space is sent only after the stop). Is there any bleed of the speech in the transcript? Note what is heard | untested |
| R10 | A permission prompt with a long Bash command (over 100 characters) on the selected session, then tap read aloud | "Permission: Bash ..." cut at a word, with "..." at the end; understandable. Also an Edit prompt (file base name) and an MCP tool. Note what is heard | untested |
| R11 | A closing message with a code block, inline code, a URL, a link and file paths | Only the prose is heard (at most 3 sentences and 300 characters); nothing spells out code or a path. With no closing message yet: "Nothing to read." is heard | untested by ear. Measured in the VM: `[[ ]]` is phoneme input in real espeak-ng (removed by text.js); `< >` are not markup without `-m` |
| R12 | Set `"speakOnStop": true` in a copy of the config (`--speech <file>` or `REVVIEW_SPEECH`), restart. Let the selected session finish a turn; let another session finish; let a session with background subagents finish its main turn | The closing message is spoken once per Stop of the selected session only; another session's Stop and the subagent case are silent. "Nothing to read." is never spoken this way | untested |
| R13 | Restart the service (`systemctl --user restart revview` (as the kiosk user)) while it speaks; then `pgrep espeak-ng`, `pgrep piper`, `pgrep aplay` | No speech process is left. Also try `kill -9` of node while it speaks and note whether a child finishes its sentence (known, not handled) | untested |
| R14 | As the kiosk user (no `sudo -u`): `aplay -l` and `speaker-test -t sine -l 1` (or play a short wav), and `systemctl --user show revview -p Environment` after `pi/install.sh` | The user can open the audio device (group `audio`: `id` lists it); the user unit's environment has `XDG_RUNTIME_DIR`, so PipeWire audio works from inside the server's tmux session | untested |

## Stage 2: hook wiring (2026-11-22)

Built and run here with real Claude Code 2.1.330 sessions (`fixtures/sessions/hook-wiring/`); nothing ran on the Pi.
Install: `node $REVVIEW_DIR/hooks/install.mjs` as the user that runs Claude (see `hooks/README.md`).

| # | Try | Should happen | State |
|---|---|---|---|
| HW1 | On the Pi, as the sessions' user: `node /opt/revview/hooks/install.mjs`, then run it again; start a session in a repository on a branch other than main and give it a small task with an Edit and a Bash command | The install prints `installed`, the second run `not changed`; `~/.claude/settings.json.revview-backup` exists if there was a file before. The bar shows the repo and branch, follows the tools, `+N -N`, DONE at the end | untested |
| HW2 | In that session, run `git switch -c test-branch` through Claude; then ask Claude to `cd` into a subdirectory and run `ls` | The branch on the bar changes after the Bash command; the repo name stays the repository's name (not the subdirectory) | untested |
| HW3 | Measure the hook cost on the Pi: `time (head -1 fixtures/sessions/working-turn.jsonl \| node hooks/event.mjs)` with the server up and with it stopped, ten times each | Note the seconds. Here it is about 0.1 s. If it is over about 0.3 s, a tool call feels slow (two hooks per tool): report it so a lighter hook can be made | untested |
| HW4 | Stop the server (`systemctl --user stop revview`, as the kiosk user) and use Claude for a turn with tools; start it again (`systemctl --user start revview`) | Claude works normally, nothing is printed by the hooks, no delay you notice; after the start the bar shows the session from its next event | untested; superseded by H4 |
| HW5 | Take the hotspot away while Claude works (or wait for a real API error) | Note what the bar shows: today WAITING FOR ME (QA r3-05, recorded here as StopFailure `server_error`); the terminal says "API Error ... Resend your message". Say whether that is acceptable while driving | untested |
| HW6 | With the wiring installed and `"speakOnStop": true` in a copy of `config/speech.json` (`REVVIEW_SPEECH`), finish a turn | Same as R12: the closing message is spoken once for the selected session | untested |
| HW7 | Kill a Claude in its tmux window (`tmux -L revview kill-window -t ...` or `kill -9` of its pid) | Note how long its session stays on the bar. A window started by revview (`--sessions`): it leaves after two polls that no longer list it (about 10 s; emulator: about 4 s). A Claude not started by revview stays until a new session pushes it out (DECISIONS "owned window gone"; a posted `RevviewStarting` is refused, 403, on the installed server without `--dev-bridge`) | untested |

## Stage 4A: the Pi appliance (2026-11-22)

Set-up: `pi/README.md` (owner's steps), `sudo bash /opt/revview/pi/install.sh --user NAME /opt/revview`. Written without a Pi; the
file edits were tested only against a fake root (`tests/unit/pi-*.test.js`). Chromium flags, package names, the lightdm
key, the labwc autostart behaviour and the systemd user-unit layout are from memory. DECISIONS "stage 4A".

Since stage 4A the server is a systemd USER unit of the kiosk user, not a system unit of user `revview`: every item
uses `systemctl --user ... revview` and `journalctl --user -u revview`, run as the kiosk user (the log is in that user's
journal; lingering starts the unit at boot). Script paths are `/opt/revview/pi/...`.
Ids `P1`... are new.

| # | Try | Should happen | State |
|---|---|---|---|
| P1 | Fresh Trixie flash, the steps of `pi/README.md` up to the install; run `sudo bash /opt/revview/pi/install.sh --user NAME --dry-run /opt/revview`, then without `--dry-run`, then again | The dry run lists what it would do and changes nothing; the real run ends with "done. Next:"; the third run prints only `unchanged` lines for files (packages "all present"). `/boot/firmware/cmdline.txt` is still ONE line; `cmdline.txt.revview-backup` and `config.txt.revview-backup` exist; note any `skipped` or `warning` line | untested |
| P2 | Power off, power on; time with a stopwatch from power to (a) the first picture, (b) NO LINK, (c) STARTING, (d) the session shown (with `REVVIEW_START` set), (e) a working push-to-talk | Note the five times. DESIGN expects roughly 40-50 s or more to the UI on a Pi 4B; faster is a goal, not a given | untested |
| P3 | Watch the boot on the panel | No rainbow splash, no Raspberry logos, no scrolling kernel text, no blinking cursor (quiet boot); the console text that does show is the right way round (cmdline `video=...,rotate=90`) | untested |
| P4 | After login, look at the panel and touch it in each corner | The bar fills the 1280x400 panel the right way round (wlr-randr transform 90); a touch lands where the finger is (udev matrix `0 -1 1 1 0 0`). If the touch is mirrored or turned, note which way. With the mount flipped: re-run the install with `--rotate 270` and check again | untested |
| P5 | Boot and watch the desktop | It logs in by itself as the kiosk user (lightdm autologin, or raspi-config's Desktop Autologin when there is no lightdm.conf); no desktop icons, no panel, no wallpaper before Chromium covers the screen | untested |
| P6 | Kiosk look | Chromium is full screen with no address bar, no "restore pages?" bubble, no first-run or default-browser question, no translate bar, no keyring password dialog; pinch and swipe do not zoom or go back | untested |
| P7 | `pkill -f chromium` (over SSH, as the kiosk user) three times, 20 s apart; then three times within 15 s | Each time Chromium comes back by itself within about 1-2 s, on the boot page then the live bar; after quick deaths the wait grows (2, 4, 8 s ...) up to 30 s. `journalctl --user` or labwc's log shows `revview-kiosk:` lines | untested |
| P8 | Pause: `mkdir -p ~/.config/revview && touch ~/.config/revview/kiosk-paused`, then `pkill -f chromium`; later remove the file. Also put the SD card in another computer and create `revview-kiosk-paused` in the boot partition, then boot | Chromium stays away while a marker exists (the desktop shows); within about 5 s of removing it Chromium is back. With the boot-partition marker the Pi boots to the empty labwc session | untested |
| P9 | Pull the power while the bar shows a session, power on | No "Chromium did not shut down correctly" bubble, no restore question; the bar comes back through NO LINK and STARTING | untested |
| P10 | Order: stop the server (`systemctl --user stop revview`), `pkill -f chromium`; wait for the kiosk; then start the server | The kiosk shows NO LINK "Waiting for the revview server" (never a white error page), then STARTING and the live bar by itself within about a second of the server being up (extends 22 and H1 of the honest-states section) | untested |
| P11 | Server log after boot: `journalctl --user -u revview -b` as the kiosk user | Lines `netmon: online = default route + TCP connect to api.anthropic.com:443 every 10 s` and `boot: STARTING ...`; the bar is not OFFLINE with the hotspot up and working | untested |
| P12 | Network drop and return: with the hotspot up, (a) switch the phone's hotspot off; (b) keep the hotspot on but turn the phone's mobile data off (or drive into a dead zone); then restore. Also once with only the PoE Ethernet cable and no Wi-Fi | OFFLINE within about 10-25 s of the drop in (a) and (b), not for one lost connect; the bar's state returns within about 5 s of the network coming back. With Ethernet only the bar is online (nothing depends on Wi-Fi either). Note the times | untested |
| P13 | Hooks from a real session: with `REVVIEW_START=/path/to/repo` in `/etc/revview/server.env`, reboot; on the bar, give a voice task with an Edit and a Bash command. Also `cat ~/.claude/settings.json` | The key-on session starts by itself in that folder (`tmux -L revview ls` lists it); the bar shows STARTING, then the session, which shows STARTING until its first hook (up to the 30 s launch limit, as in P20) and then the hook's state, then follows the tools and ends DONE. The settings file has the revview hooks (`# revview-hook`), owned by the kiosk user | untested |
| P14 | Audio and groups as the kiosk user: `id` (groups `input`, `audio`), `systemctl --user show revview -p Environment`, `/voice` in the key-on session, read aloud | Groups present; the unit's environment has `XDG_RUNTIME_DIR` set; Claude's `/voice` hears the USB mic from inside the server's tmux session and read aloud is heard. If not, note the error: the user unit was chosen for this (DECISIONS "stage 4A") | untested |
| P15 | Key-on with `REVVIEW_START` unset (commented out in `/etc/revview/server.env`): reboot, no session in `tmux -L revview ls` | The bar leaves STARTING once the boot is done and shows the note "No session yet: open the menu for New session"; it does not stay on STARTING. The menu opens (buttons or touch) and New session starts one, which the bar then follows | untested |
| P16 | `REVVIEW_START` wrong, twice: (a) `REVVIEW_START=/no/such/folder`, (b) `REVVIEW_START=relative/folder`; `systemctl --user restart revview` (or reboot) after each | The bar leaves STARTING and shows a short note ("Key-on session not started: ..."); no session starts; the menu works and New session starts one. The note names the reason (missing, relative); `journalctl --user -u revview -b` has the same | untested |
| P17 | Claude not signed in (as the kiosk user: `claude /logout` or move the sign-in away; `REVVIEW_START` set to a good folder), reboot | The key-on session's Claude exits. If it exits at once or while still STARTING, the bar shows "Key-on session ended at once: see the server log", and the server log (`journalctl --user -u revview`) has the line "boot sessions: Claude exited at once, its window disappeared before it could be set up" or "owned sessions: window of session ... disappeared". If it was the only session and it ends later: "<repo> ended: open the menu for New session". A push-to-talk tap then shows "Push-to-talk does nothing: no revview session". The bar does not stay on STARTING; the menu works. Note which text you saw and the time. Sign in again afterwards | untested |
| P18 | With the data set-up done (part B): boot without the stick, then plug it in with `REVVIEW_START` set to a folder whose start fails (a missing folder) | Locked: INSERT KEY with the buttons and the menu working. After the unlock the bar goes to STARTING, the start fails, and STARTING ends with the "Key-on session not started: ..." note (it does not stay on STARTING) | untested |
| P19 | Put `REVVIEW_NETMON_HOST=not a host` (and once `[::1]:443`) in `/etc/revview/server.env`, restart the server, `journalctl --user -u revview -b` | The server stays up (no crash loop in `systemctl --user status revview`); the log line says the value is not accepted and the default `api.anthropic.com:443` is used; the bar works and shows no OFFLINE tag while the network is up | untested |
| P20 | Key-on with `REVVIEW_START` set to a good folder, watch the bar from power-on until the session's first hook (give a short task if the session is idle) | The bar shows STARTING until Claude's first hook arrives, then the session's own state; after the session's window appears, at most 30 s of STARTING (then UNKNOWN "No events from this session yet" if no hook came; the refusal note below is gone by then). A push-to-talk tap during STARTING sends nothing and shows "Claude is still starting: push-to-talk not sent". Note the time to the first hook | untested |
| P21 | SoX present: `command -v rec` as the kiosk user; then `/voice tap` in the revview session (`tmux -L revview attach`) | `command -v rec` prints a path (the installer now installs `sox`; Claude Code's voice needs SoX to record), and in the revview session `/voice tap` answers `Turned on voice mode (tap)` | untested |

## Stage 4B: power cuts, read-only root, locked data (2026-11-22)

Set-up: `pi/README.md` ("Encrypted data and the key stick", "Read-only root", "Updating", "Piper"). Written without a
Pi; the scripts were tested only against a fake root and stub commands. Everything about raspi-config, cryptsetup,
udev, systemd, Piper and Adiantum speed is from memory. DECISIONS "stage 4B". Try the data set-up on a spare
partition and a spare stick first, not on data you need.

| # | Try | Should happen | State |
|---|---|---|---|
| S4B-1 | `sudo bash /opt/revview/pi/readonly.sh status`, then `enable`, reboot, then `status`, `mount \| grep ' / '`, `grep overlayroot /boot/firmware/cmdline.txt`, `findmnt /boot/firmware` | Before: overlay off. After the reboot: `/` is an `overlay`, `cmdline.txt` has `overlayroot=tmpfs`, `/boot/firmware` is `ro`. If `enable` warns that raspi-config did not do what we expected, its command names (from memory) are wrong: note them | untested |
| S4B-2 | With the overlay on, write a file in the home outside the data (`touch ~/gone.txt`), reboot | The file is gone. Files in `~/repos` and `~/.claude` (on the data) are still there | untested |
| S4B-3 | Pull the power 20 times at random moments: during boot, while Claude writes, while idle. Afterwards: `journalctl -u 'revview-unlock*' -b`, `sudo e2fsck -n /dev/mapper/revview-data` (only with the data unmounted: `sudo umount /srv/revview-data` first, or use the unlock's own check), and `git fsck` in a repository | Boots to the bar every time. The unlock's `e2fsck -p` fixes anything small; the data check is clean or was fixed; `git fsck` is clean (note any dangling objects or a broken last commit). The system itself never needs repair | untested |
| S4B-4 | Boot WITHOUT the key stick | The bar shows INSERT KEY ("Data locked"). The buttons, the list and the menu work; read aloud works. New session from the menu is refused. `pgrep -a claude` shows no claude process; no key-on session started | untested |
| S4B-5 | Insert the stick late (a minute after boot) | Within seconds the bar leaves INSERT KEY and shows STARTING; the key-on session starts exactly once. `mount \| grep revview-data` shows the mapper device on `/srv/revview-data` | untested |
| S4B-6 | Pull the stick while a session runs; later pull the power and boot again without the stick | Nothing changes at the pull: the session keeps working, the bar stays. After the power cut and boot without the stick: locked (INSERT KEY) | untested |
| S4B-7 | Boot with a wrong stick, then with the right stick but `revview/data.key` deleted | Stays locked. `journalctl -u 'revview-unlock*'` says why. No key bytes (no dump of the key) anywhere in that journal | untested |
| S4B-8 | `udevadm monitor --udev --property` while plugging in the key stick | The add event for the stick's partition shows `ID_FS_UUID` equal to the one in `/etc/revview/data.conf`; `systemctl status revview-unlock` shows it ran (rule `72-revview-key.rules`) | untested |
| S4B-9 | On a SPARE partition and a spare stick: `sudo bash /opt/revview/pi/data-setup.sh --user NAME --device /dev/X --key-device /dev/Y --dry-run`, then with `--format` | The dry run lists every command and changes nothing. `--format` asks `Type /dev/X to ERASE it:`; a wrong answer ends with nothing done; the right one asks for the recovery passphrase and ends with "done. Next:" and the WARNING. Then reboot: it unlocks by itself | untested |
| S4B-10 | `data-setup.sh --dry-run` with a wrong device: the root partition, a mounted partition, a whole disk (`/dev/mmcblk0`), the key stick as the data device | Each is refused with a plain reason, exit 2, nothing written | untested |
| S4B-11 | `sudo cryptsetup open --test-passphrase /dev/X` and type the recovery passphrase | Exit 0 (no output). A wrong passphrase gives a non-zero exit | untested |
| S4B-12 | In a terminal on the Pi: `echo $CLAUDE_CONFIG_DIR`, `ls ~/.claude/.claude.json`, `ls ~/.claude.json` | `$CLAUDE_CONFIG_DIR` is `/home/NAME/.claude` (from `/etc/profile.d/revview-claude.sh`); `~/.claude/.claude.json` exists after a Claude run; there is no `~/.claude.json` in the home | untested |
| S4B-13 | The update procedure with the overlay on: run `install.sh` first (must refuse), then `readonly.sh disable`, reboot, `disable` again, then `sudo apt update && sudo apt full-upgrade`, `git pull` in `/opt/revview`, `claude update`, `install.sh`, `readonly.sh enable`, reboot | `install.sh` refuses under the overlay (exit 2, nothing written) and when `/boot/firmware` is read-only. After the procedure the update is still there after a reboot; the overlay is on again; the bar and the sessions work | untested |
| S4B-14 | `swapon --show` | Note what is used. Trixie may use zram (fine). A swap FILE on the root makes no sense under the overlay: if one is shown, turn it off | untested |
| S4B-15 | Adiantum speed: `systemd-analyze blame \| grep revview-unlock` after boot, and `cryptsetup benchmark -c xchacha12,aes-adiantum-plain64` | Note the unlock time at boot (expected: a second or a few) and the benchmark's MiB/s. If the unlock is slow, note it: the key slot uses `--pbkdf pbkdf2 --iter-time 500` (from memory) | untested |
| S4B-16 | Piper, steps from `pi/README.md` "Piper": run the test command, restart the server, `journalctl --user -u revview -b \| grep speech` | The test command makes a sound; the log shows `speech: piper`. Without Piper the log shows `speech: espeak-ng` | untested |
| S4B-17 | While LOCKED, post a fake unlock: `curl -s -X POST --data-binary '{"hook_event_name":"RevviewDataLock","locked":false}' http://127.0.0.1:8138/event` | Answer 204, but the bar still shows INSERT KEY and no session starts: the post is only a poke, the mount table decides | untested |
| S4B-18 | After a `git pull` that changes `pi/data.mjs`: the Updating order (update with the stick in, reboot without it, `data-setup.sh` without `--format`, reboot with it) | `data-setup.sh` refuses while the data is open and works with it locked; the new unit/rule files are in place; the data unlocks at the next boot | untested |
| S4B-19 | `docs/REVOKE.md` (c) on a SPARE card and stick: `luksKillSlot` the stick's slot, make a new stick by hand, `luksAddKey --pbkdf pbkdf2 --iter-time 500`, `data-setup.sh` without `--format`, reboot with the new stick | The new stick unlocks at boot and the old one does not; `luksDump` shows the new slot as `pbkdf2`. Note any cryptsetup option that failed (all from memory) | untested |

## Emulator on your laptop 1 (2026-11-23)

Written and tested only with a stand-in browser and headless Chromium on the build VM; nothing has run on a real
laptop desktop or WSL2. WSL2 detection and the Windows browser paths are from memory. DECISIONS "Emulator on your
laptop 1".

| # | Try | Should happen | State |
|---|---|---|---|
| L1 | Linux laptop with Chromium or Chrome: `bash emulator/run.sh`, then `--scale 1.5`; press M, arrows, Backspace, Enter; close the window | A window without browser bars opens on the empty bar; M opens the menu, arrows move, Backspace closes, Enter opens the list ("No sessions"); Space and arrows do not scroll. With `--scale 1.5` it is 1.5 times bigger and the bar still fits (note whether the title bar eats part of the 400 px). Closing the window ends the script; `pgrep -af src/server/index.js` shows nothing, no `revview-emu.*` dir is left in `/tmp`. If Chrome hands the URL to a running instance, note the message | untested |
| L2 | WSL2 on Windows 11: `bash emulator/run.sh` with a Linux Chromium under WSLg, then without one (Windows Chrome or Edge) | WSLg: as L1. Windows browser: the window opens via `localhost`, keys work, closing it ends the script and the `revview-emu.*` profile under the Windows `%TEMP%` is gone. Note any wrong path or detection | untested |

## Emulator on your laptop 2: demo mode (2026-11-23)

Tested only on the build VM (in-process server with an injected clock, stand-in browser, headless Chromium); nothing has
run on a real laptop. DECISIONS "Emulator on your laptop 2".

| # | Try | Should happen | State |
|---|---|---|---|
| L3 | Linux laptop: `bash emulator/run.sh`, watch one full loop, then press 1-7, P, `[` and `]`; close the window | The bar shows working, permission, done, waiting, offline, insert key, ended at a pace you can follow and loops; the terminal prints one `demo: N scene` line per scene. Each digit jumps to its scene, P freezes and resumes, `[` `]` slow down and speed up; the bar's own keys (M, arrows, Enter, Backspace) still work during the demo. Closing the window ends the script; `pgrep -af 'demo/player.js\|src/server/index.js'` shows nothing | untested |
| L4 | Same, `bash emulator/run.sh --live` | No `demo:` lines; the bar stays on its empty state until real Claude Code hooks post to the port; digits do nothing | untested |
