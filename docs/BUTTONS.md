# Wheel buttons: design note

Owner request 20261122T060852Z-p-dcd34d. A design and a plan. Nothing here is built and nothing was tried on
hardware.

1. Two coin-cell pods on the wheel and a USB dongle make one USB keyboard for the Pi. revview reads it itself.
2. Most actions reach Claude Code 2.1.330 as keys through tmux. Allow and deny go through a hook instead.
3. One session is selected by the driver. The bar shows it and every action goes to it.
4. Navigation, list, menu and read aloud are revview's own work. Claude Code needs nothing for them.
5. Scope beyond charter stage 3 is an open escalation (`docs/agents/ESCALATIONS.md`). Until the owner answers,
   only stage 3 is built.

## Evidence labels

| Label | Meaning |
|---|---|
| **[recorded]** | Seen on this VM with Claude Code 2.1.330. The file is in `fixtures/buttons/` (see its README). |
| **[source]** | Read from the installed 2.1.330 binary with `strings`. Not run. May change in any update. |
| **[untested hardware]** | Needs the Pi, the pods or the car. Nothing is claimed to work. A bench item exists. |
| **[proposal]** | A design choice of the team. The owner can change it. |

Bench items are in `docs/BENCH-TEST.md`, numbers 27 to 39 (and `D1`... for the dongle and pods, section 9).

## 1. Input layer

**Keymap.** The pods send unused keys. The map from key code to button name lives in a config file, not in
firmware. **[proposal]**

| Button | Key | Pod |
|---|---|---|
| Push-to-talk | F13 | voice |
| Read aloud (hold: stop speaking) | F14 | voice |
| Cancel (tap: Esc, hold 1 s: Ctrl+C) | F15 | voice |
| Deny | F16 | voice |
| Up | F17 | navigation |
| Down | F18 | navigation |
| Left (previous session) | F19 | navigation |
| Right (next session) | F20 | navigation |
| Press (enter; allow on a permission prompt) | F21 | navigation |
| Back (hold: home) | F22 | navigation |
| Menu (hold: night/day look) | F23 | navigation |
| Spare, or combos | F24 | either |

**Reader.** **[proposal]** A small revview input service reads the dongle's `/dev/input/event*`.
- It takes an exclusive grab (`EVIOCGRAB`), so F13-F24 reach neither the console nor Chromium nor a terminal.
- It picks the device by USB vendor, product and name from the config file.
- Node core cannot call `ioctl`. The grab needs python3-evdev (a Debian package) or a tiny C helper. That is a
  new dependency, so it gets its own DECISIONS entry when phase WB2 is built, not now.
- The page must not depend on key events. On the Pi the grab keeps keys away from Chromium.
- **Built in WB2 (2026-11-22), with changes:** the reader runs inside the server, not as a separate service. The
  grab is a python3 standard-library helper (`src/input/grab.py`), not python3-evdev or C. See DECISIONS "wheel
  buttons 2" and `src/input/README.md`. Not tried on hardware.

**keyd.** DESIGN.md names keyd for the single button. keyd remaps one key to another key for whatever window has
focus. With several sessions, and with actions that are not keys (hook answers, menu, speech), that is not
enough. So keyd is replaced by revview's own reader. **[proposal]** This supersedes the DESIGN.md text; the
owner to confirm.

**Gestures.** A pure function: timestamped press and release in, gestures out. **[proposal]**
- Ignore kernel auto-repeat (event value 2).
- Debounce: ignore a press within 30 ms of the last release, and ignore a release within 30 ms of the press of a hold/long-hold button (contact bounce: such a release is provisional; a re-press inside the window continues the same press, otherwise it resolves as a tap when the window ends). The firmware (ZMK) debounces too.
- Tap: released before 400 ms. Hold: fires at 400 ms while still held. Long hold: fires at 1000 ms, for cancel only.
- A button with no hold action fires on press, for the lowest latency: push-to-talk, deny, up, down, left, right.
- **[proposal]** Menu has a hold action (400 ms: toggle night/day look; from `auto` it goes to the opposite of what
  shows and leaves `auto`). So a menu tap fires on release (before 400 ms), not on press. Cost: the menu opens a little
  later than the buttons above. Owner issue #30; bench N4, N5.

**Dongle missing.** **[proposal]** The service watches hotplug (udev, or inotify on `/dev/input`) and tells the
server with a `RevviewInput` presence event. The view shows a small NO BUTTONS tag at 3.55 mm. It is not a state
takeover: the bar still shows Claude. **[untested hardware]** (bench 33)

**Boot order.** **[proposal]** The input service starts early and does not wait for the view. During `starting`
presses are dropped, not queued. A queued Esc or allow that arrives minutes later could hit the wrong thing.
The bar briefly marks a dropped press.

**Open on hardware.** How the dongle shows up (one keyboard, or also a mouse or consumer device), the key codes,
repeat behaviour, reconnect time and the lost first press after sleep: bench 27 to 31. **[untested hardware]**

## 2. Actions to Claude Code

Verdicts: **supported** (a documented way, or revview's own work), **workaround** (works by typing keys, can
break with an update), **missing** (Claude Code offers nothing).

| Button | Route | Verdict | Evidence |
|---|---|---|---|
| Push-to-talk, tap mode | `tmux send-keys -t <window> Space` with the input empty | workaround | Default `space` -> `voice:pushToTalk` **[source]**. Keys reach only the chosen pane **[recorded]** (`pane-e-3-attached-after-esc.txt`). Voice itself not recorded. **Not sent while the selected session has a pending permission prompt:** the bar note says "Answer the prompt first" (cycle 47). |
| Push-to-talk, hold mode | Space repeatedly (about every 50 ms) while held, imitating auto-repeat | workaround that an update can break; **not built in WB3** | Hold is detected from terminal key repeat, with timers in the minified code **[source]**. A terminal has no key-up. Not recorded. |
| Cancel, tap | Esc by send-keys | workaround | **[recorded]** `events-a-esc.jsonl`, `pane-a-2-after-esc.txt` |
| Cancel, hold 1 s | One Ctrl+C by send-keys | workaround | **[recorded]** `events-b-ctrlc-once.jsonl` |
| Allow (press on a prompt) | Waiting PermissionRequest hook answers `allow` | supported | **[recorded]** `pane-c2-2-after-answer-file.txt` |
| Deny | Same hook answers `deny` with a message | supported | **[recorded]** `pane-d-1-after-deny.txt` |
| Allow, deny by key | Enter or Esc into the pane | workaround (fallback) | Dialog keys **[source]**, see below |
| Left, right, up, down, press, back, home | revview's own view and state | supported, but not built | No Claude Code input needed |
| Menu: new session | `tmux new-window` in a project dir running `claude` | supported (plain CLI), not built | **[proposal]** |
| Menu: projects | A config list of repo paths | supported, not built | **[proposal]** |
| Menu: settings (voice mode) | Write `voice.mode` to the settings file, or send `/voice tap` as keys | workaround | `/voice [hold|tap]` writes user settings **[source]** |
| Read aloud | revview's own speech (section 5) | supported, not built | **[proposal]** |
| Interrupt a turn without keys | none | missing | No command or socket found **[source]** |

**Cancel.**
- Esc mid-turn stops the turn at once. The pane shows "Interrupted · What should Claude do instead?". The
  hooks fire SessionStart, UserPromptSubmit, PreToolUse and then nothing: no Stop, no PostToolUse. The next
  prompt ran normally. **[recorded]** `events-a-esc.jsonl`, `pane-a-1-before-esc.txt`, `pane-a-3-next-prompt.txt`
- On a permission dialog Esc is `confirm:no` (reject and interrupt) **[source]**. The existing
  `fixtures/sessions/permission-interrupted.jsonl` shows an Esc reject gives no Stop.
- One Ctrl+C mid-turn interrupts like Esc and does not exit. **[recorded]** `pane-b-1-ctrlc-once.txt`
- Two Ctrl+C 0.4 s apart mid-turn: the first interrupts, the second shows nothing. **[recorded]**
  `pane-b-3-ctrlc-twice.txt`
- At an idle prompt one Ctrl+C shows "Press Ctrl-C again to exit", and a second one within that window exits
  (SessionEnd). Two presses 4 s apart do not. **[recorded]** `pane-b-6-ctrlc-idle-first-of-fast-pair.txt`,
  `pane-b-5-ctrlc-idle-twice.txt`
- So the long-hold button must send ONE Ctrl+C per hold, never two. Esc does the same job mid-turn, so Ctrl+C
  adds little. **[proposal]**

**Permission prompts.**
- With a waiting PermissionRequest hook the terminal dialog is shown at once ("Do you want to proceed? 1. Yes
  2. Yes, and always allow... 3. Yes, and switch to auto mode 4. No"). **[recorded]** `pane-c2-1-hook-waiting.txt`
- The hook's `allow` answer dismissed the dialog within about 1.5 s. The pane shows "Allowed by
  PermissionRequest hook" and the command ran. **[recorded]** `pane-c2-2-after-answer-file.txt`
- A `deny` with message "denied by wheel button" shows "Denied by PermissionRequest hook" and the reason. No
  file was written. Claude said it was denied and stopped. Events: PreToolUse, PermissionRequest, Stop; no
  PostToolUse and no PermissionDenied. **[recorded]** `pane-d-1-after-deny.txt`,
  `events-c2-d-d2-allow-deny-terminal.jsonl`
- Contrast: an Esc reject gives no Stop. **[recorded]** `fixtures/sessions/permission-interrupted.jsonl`
- With `"timeout": 5` and a hook that never answers, the hook was killed at 5 s. Nothing was allowed or denied
  and the dialog stayed. Pressing 1 in the terminal approved it. Nothing is lost on a timeout. **[recorded]**
  `events-c1-hook-timeout5.jsonl`, `pane-c1-2-after-timeout-8s.txt`, `pane-c1-3-after-terminal-1.txt`
- An answer in the terminal while the hook waits wins at once. The hook is not killed and its late answer has no
  effect. **[recorded]** `pane-d2-1-after-terminal-1-while-hook-waits.txt`, `permhook-log.txt`
- Space on the open dialog (push-to-talk's key), Claude Code 2.1.331: did nothing, both while the hook waited and
  after a 5 s hook timeout. `1. Yes` stayed highlighted, nothing ran, no hook event, and no space was left in the
  input afterwards. **[recorded]** `fixtures/buttons` (f). Even so revview sends no Space while a prompt is
  pending (cycle 47 rule below): the dialog does take keys, and a later version could map Space to select.
- Decision schema: `{"behavior":"allow", updatedInput?}` or `{"behavior":"deny","message":"..."}`, with an
  optional `interrupt: true` that aborts the turn. The hook `timeout` is in seconds. There seems to be an
  overall cap of 20 min on hook run time. **[source]**
- The default timeout of a command hook without `timeout` was not pinned down. So revview's hook sets an
  explicit `timeout`. **[proposal]** 600 s.

**Voice.**
- Setting `voice.mode`: "hold" (default, hold to talk) or "tap" (tap to start, tap to stop and submit). Also
  `voice.enabled` and `voice.autoSubmit` (hold mode only). `/voice [hold|tap]` writes the mode. **[source]**
- Default key: Chat context `space` -> `voice:pushToTalk`. A warning says binding it to a plain key prints into
  the input during warmup, and suggests space or a modifier combo. Tap hint: "Tap ${key} (with input empty) to
  start, tap again to send." **[source]**
- Hold mode reads the hold from the terminal's key auto-repeat: about a 120 ms gap timer, 5 repeats to start, 2
  to warm up, a 300 ms double-tap window. Inferred from minified code; it may change in any update. **[source]**
- Needs a claude.ai login, the server flag `allow_voice_mode`, a microphone, and SoX or arecord. **[source]**
- Not recorded: `/voice` itself (no microphone on this VM). **Recommend tap mode** (the charter and DESIGN.md
  already say tap). **[proposal]**

**Keybindings.** `~/.claude/keybindings.json`, `{"bindings":[{"context":"Chat","bindings":{"key":"action"}}]}`;
`null` unbinds. No project-level file was found. Defaults: `chat:cancel` = escape, `app:interrupt` = ctrl+c,
`app:exit` = ctrl+d, `voice:pushToTalk` = space, `chat:submit` = enter, `confirm:yes` = enter, `confirm:no` =
escape, `confirm:previous` and `confirm:next` = up and down. **[source]**

**Sending input to a session.**
- A plain interactive `claude` in a tmux pane takes `send-keys`. **[recorded]** (the whole recording ran this way)
- `claude --bg`, `agents`, `attach`, `logs`, `stop`, `rm`, `respawn` exist. No command or socket to send input
  to, or interrupt, a `--bg` session was found. `--input-format stream-json` is for `--print` only (no
  `/voice`). **[source]**
- `claude remote-control` is an external service with a phone UI and needs claude.ai. It is not a button route.
  Whether it can interrupt or answer permissions was not checked. **[source]**

## 3. Multiple sessions

**Where sessions run.** **[proposal]** revview owns plain interactive sessions in a private tmux server
(`tmux -L revview`, one window per session, `claude` run directly in the pane). Keys go by `tmux send-keys -t
<window>`. Why this over the owner's hub pattern (`--bg` plus `attach`):
- One hop fewer. `attach` works **[recorded]** (`pane-e-1-attached.txt`, `pane-e-3-attached-after-esc.txt`), but a
  pane holding `attach` adds a client layer: Left opens the agent list (`pane-e-4-after-left-arrow.txt`) and
  Ctrl+Z detaches. **[source]** for Ctrl+Z.
- `/voice` with a local microphone inside an attached `--bg` session is unknown (where is the audio captured?).
  A plain terminal session is the case the docs describe.
- tmux is installed. `claude agents --json` still lists interactive sessions **[source]**, so the owner's hub
  tools keep working for reading.
- `--bg` stays as the fallback if tmux sessions turn out to be a problem.

What `claude agents --json` returns **[recorded]** (`agents.json`): an array of `{pid, id (8 characters), cwd,
kind: "background", startedAt (ms), sessionId, name, status: "busy"|"idle", state: "working"|"done"}`. After an
Esc in an attached session the list still said `state: "working"` (`agents-after-attach.json`), so it is not a
reliable source of truth. The hook events are.

**The rule: one selected session.** **[proposal]**
- The bar shows the SELECTED session. Every action (push-to-talk, cancel, allow, deny, read aloud) goes to it.
- The selection changes only by the driver: left/right; back-hold (home); a row chosen in the list; or starting
  a new session, which becomes selected. If the selected session ends, the selection falls to the neediest.
- Home is the session that needs the driver most: needs permission, then waiting, then done, then working; the
  oldest ask first among equals.
- Other sessions' events never move the selection. The band shows the `+N` hint that something else needs the
  driver (existing hint).
- A permission prompt in a non-selected session: allow and deny act only on the selected one. Home jumps to
  the prompt.
- When no session exists, push-to-talk does nothing and the bar says so.

**Built in WB4 (2026-11-22), with changes:** the rule is built as written, with these differences. A session
revview started becomes selected only when its first hook event arrives (`want`), not at once. Home is the
rule above (done before working); it differs on purpose from the cap's order in `board.js`. Press on a shown
NEEDS PERMISSION is an allow attempt and never opens the list; a refusal does nothing else. While a list or menu is
open no button sends a key or answers a request, and closing one restarts the 1500 ms shown time. `RevviewSelect`,
`RevviewNav`, `RevviewOwned` and `RevviewProjects` are refused on `POST /event` even under `--dev-bridge`. Emulator
only, nothing on hardware. See DECISIONS "wheel buttons 4".

**State core (`src/state/board.js`).**
- `focus` becomes driver-owned (call it `selected`). The `refocus` heuristics (pending permission pre-empts,
  working beats done, sticky focus) apply only when nothing is selected: a single session, or boot.
- `spokenTo` is no longer needed for focus, because the driver speaks only to the selected session.
- This closes the DECISIONS limit "cannot say where push-to-talk will land".

**What the bar shows.** The selected session's repo is already shown. Add its position ("2/3") and a mic mark in
the band. This is the answer to where push-to-talk goes.

## 4. View changes

All at the existing `TYPE_MM` (state word 6.05 mm, other text 3.55 mm; `src/view/type.js`). No new size.
**[proposal]** The dense layout has 7 rows of 40 px under an 84 px band (DECISIONS, "dense layout").

- **Home view.** The normal bar stays. State word first.
- **Switch.** Left and right swap the whole bar to the next session. The band shows the position "2/3".
- **List.** Up, down or press opens a list: up to 6 rows at 3.55 mm. One row per session: a state colour chip,
  the repo, a short state word.
- **Highlight.** The selected row is inverted (colours swapped) and has a bar at its left edge. Never colour
  alone.
- **Menu.** The same list widget with the items New session, Projects, Settings.
- **Back.** Closes one level. A view with no input for about 10 s returns to the bar.
- **Glance first.** The state word of the selected session stays visible in the list and menu views (the
  band is not replaced). Whether to use list and menu while moving is the driver's choice.

**Built in WB4 (2026-11-22), with changes:** the position and a mic mark sit in the band, but only when the server
runs with sessions. A crossed mic and a bottom note row show when push-to-talk does not go to the shown session.
The list shows a mic on the selected session's row. Back closes one level; the menu button (tap, on release; **[proposal]** hold: night/day look) opens and closes the
menu. Menu items: New session (choose a project row, press), Projects (read-only), Settings (four facts, and rows for Sounds, Lights and Look when the server has them; the
choices are kept over a restart when the server keeps settings, `--settings`). The list and menu auto-close after 10 s. All at `TYPE_MM`. The glance-first line is built as: the lower
area is replaced, the band stays. Legibility on the dash is not proven (bench V8). See DECISIONS "wheel buttons 4".

Describe only: the exact pixel layout is for whoever builds it, within the 7-row budget.

## 5. Read aloud

**Built (WB5), untested with sound.** `src/speech/` and `config/speech.json`; see DECISIONS "wheel buttons 5" and
bench R1-R14. Read-aloud tap speaks for the selected session (a pending prompt first, else the last Stop message,
else "Nothing to read."); hold or long-hold stops; a push-to-talk press stops speech before it sends Space. The
engines are chosen in the config (Piper first, espeak-ng as the fallback; the first one installed is used). Neither
is installed in the VM and nothing was heard: the Piper command line is from memory. The built limit is 3 sentences
and 300 characters, not 2. The spoken Stop summary (`speakOnStop`) is built and off by default. No "speaking" mark
on the view yet. The proposal text below stays where it is still true.

Engines on a Pi 4B **[proposal]**:

| Engine | Notes |
|---|---|
| espeak-ng | Debian package, tiny, robotic, instant. |
| Piper | Neural, natural. Claimed faster than real time on a Pi 4B with low or medium voices (the project's claim, not verified here). About 60 MB per voice. Not a Debian package in every release. |
| pico2wave | non-free. |

Recommend Piper with one English medium voice and espeak-ng as the fallback. Either is a new dependency and needs
a DECISIONS entry with a pinned version.

**What is spoken.** **[proposal]**
- After a Stop: the `last_assistant_message` field (it is in `fixtures/sessions/working-turn.jsonl`), cut to
  about 2 sentences or 300 characters, with markdown and code removed.
- A pending prompt: "<repo> wants to run <tool>: <command>", from the PermissionRequest. Built as "Permission: Bash <command, cut at 100 characters>".

**Stopping.**
- The read-aloud hold kills the player.
- A new speak replaces the old one.
- A push-to-talk press stops speech first, so the microphone does not hear the car speakers.

**Output.** ALSA to the Pi's headphone card (3.5 mm) into AUX. **[untested hardware]** (bench 38, R4-R6)

**Scope.** The spoken summary on Stop is charter stage 2. Read aloud on demand by a button goes beyond stage 3.

## 6. Tests

**[proposal]** throughout.
- **Gesture detector:** unit tests with timestamped traces. Until the bench gives real `evtest` output, the
  traces are synthetic and labelled so.
- **Fake device:** the input service has a mode that reads press and release lines from a file or stdin, so
  tests and the emulator need no `/dev/input`.
- **Semantic events over HTTP:** the service posts button events to the server (a new endpoint or an event
  type such as `RevviewButton`). Playwright injects these over HTTP, not as page keyboard events. On the Pi the
  grab keeps keys away from Chromium, so the page must not depend on key events.
- **Fake tmux:** a script that records `send-keys` calls checks which keys go to which window.
- **Recorded tmux test:** like the recording made on 2026-11-22, for the real path. Opt-in, not in
  `tools/check`, and it costs usage.
- **New fixtures:** `fixtures/buttons/` exists (today). Later: `evtest` traces from the dongle; a two-session
  hook recording with a permission prompt in the non-selected session.

## 7. Bench items

Added to `docs/BENCH-TEST.md` (all `untested`):

| # | Topic |
|---|---|
| 27 | One key code per button and combo (`evtest`) |
| 28 | A held key gives one press and one release (note repeat events) |
| 29 | First press after 10+ minutes of pod sleep is not lost |
| 30 | Reconnect after key-on, and how long it takes |
| 31 | Latency, press to action (target under 100 ms) |
| 32 | The exclusive grab: F13-F24 reach neither console nor Chromium |
| 33 | Unplug and replug the dongle: NO BUTTONS tag, recovery without restart |
| 34 | `/voice` tap mode by button |
| 35 | `/voice` hold mode by button (imitated repeat; may fail) |
| 36 | Two sessions: push-to-talk reaches only the selected one |
| 37 | Allow and deny by button through the waiting hook |
| 38 | Read aloud over 3.5 mm to AUX; stop by hold; push-to-talk stops speech |
| 39 | Coin-cell pod battery life |

Items 1 and 2 (a single 2.4 GHz remote) are superseded by 27 and 29 if the owner confirms the pods.

## 8. Phases, risks, open questions

Sizes: S small, M medium, L large. Aligned with the owner's items Wheel buttons 2 to 6. **[proposal]**

| Phase | What | Size |
|---|---|---|
| WB2 | Input layer with an ordinary USB keyboard: service, config key map, gesture detector, NO BUTTONS tag, fake device. Needs the dependency decision. | S-M |
| WB3 | Sessions the Pi owns, and the actions: tmux-owned sessions, Space/Esc/Ctrl+C by send-keys, waiting PermissionRequest hook, new session from a project list. | M-L |
| WB4 | State core and bar: selected rule, position, list, menu, home. **Built 2026-11-22 (emulator only; bench V1-V9 untested).** | M |
| WB5 | Read aloud (new dependency). | M |
| WB6 | Dongle and pod set-up: docs and the ZMK keymap reference (section 1). Hardware by the owner. **Written 2026-11-22 (section 9, `pi/`, `docs/zmk/`; all untested).** | S for the team |

**Order.** The order stays. The smallest slice that meets charter stage 3 is WB2 plus the push-to-talk part of
WB3 for ONE session, and it can go first. Allow and deny by hook is cheap and well evidenced. Multi-session work
(rest of WB3, WB4) waits for the owner's scope answer.

**Risks.**
- Keystroke routes depend on default keybindings and dialog layout. An update can break them. Mitigation: a
  recorded test per Claude Code update.
- Hold-to-talk by imitated auto-repeat depends on minified timing.
- Voice inside tmux is not proven.
- A double Ctrl+C exits a session (recorded). One per hold only.
- The default hook timeout is unknown. Set it explicitly.
- Presses are dropped during `starting`.
- Pi 4B CPU load from speech, Chromium and Claude together.
- Driver distraction with list and menu.

**Open questions for the owner**, with the recommended default.

| # | Question | Default |
|---|---|---|
| 1 | Scope beyond stage 3 | Build only stage 3 until answered |
| 2 | Voice tap or hold | Tap |
| 3 | tmux-owned sessions or the `--bg` hub | tmux |
| 4 | Deny: hook deny with a message (the turn ends with Stop, Claude asks what next), or Esc reject plus interrupt | Hook deny |
| 5 | Cancel hold: Ctrl+C or drop it | Keep, a single Ctrl+C |
| 6 | TTS engine | Piper, espeak-ng as fallback |
| 7 | Where the projects list comes from | A config file of repo paths on the data partition |
| 8 | List and menu while moving | Allowed, auto-return after 10 s |
| 9 | Which F-key per button | The table in section 1 |

## 9. Pods and dongle: choices and what to check before buying

WB6 (2026-11-22). Files: `pi/` (udev rule, systemd unit, install script) and `docs/zmk/` (reference ZMK keymap
and options). Written without hardware; the ZMK parts are from memory, not checked against the ZMK docs (not
reachable from the build VM). Bench items D1 to D12 in `docs/BENCH-TEST.md`. **[proposal]** for everything below;
the defaults are suggestions, the owner decides.

| # | Question | Default (suggestion) |
|---|---|---|
| 10 | Which nRF52840 boards for the dongle and the pods | Dongle: any nRF52840 board with USB that ZMK already supports (a ready board, no soldering). Pods: a small nRF52840 board with a coin-cell holder or a battery pad and a sleep-friendly regulator, also ZMK-supported. Fewer custom parts means fewer surprises. Check each is in ZMK's list of boards before buying |
| 11 | Which 5-way switch part | A through-hole or side-mount tactile 5-way (up, down, left, right, press) that fits a pod case and can be pressed with a glove-free thumb without looking. Take two samples of two parts and try them on the wheel before ordering more. The press must be easy to tell from a nudge |
| 12 | Ask for a domain for the ZMK docs (`zmk.dev`) | Yes: request `zmk.dev`. Without the docs a builder writes ZMK options from memory, which is what WB6 had to do |
| 13 | Does the dongle keep ZMK's default USB ids (1d50:615e, from memory) | Keep them at first. Bench W1 and D5 read the real ids. Change them only if another device with the same ids is on the Pi |
| 14 | Hold detection: firmware or Pi | Pi (as built). The firmware sends only plain keys |

**What to check before buying.**
- The boards are on ZMK's supported list, with USB (dongle) and the nRF52840 radio (both).
- The dongle board has a stable USB port position near the Pi and the BLE radio is not blocked by a metal case.
- The pods can wake from deep sleep on a key press (the key pins can be wake-up sources) and the board's idle
  current on a coin cell is low. Datasheet values only: it is not proven (bench D8, D12).
- A CR2032 can supply a Bluetooth radio's peak current: a coin cell with a low internal resistance, or a small
  capacitor next to it. Check the cell datasheet. Bench 39 and D12 measure the result.
- The 5-way switch's contacts have a low bounce time (the Pi also debounces, 30 ms) and a life of many presses.
- Two pods on one dongle is supported by the ZMK version you build (from memory: recent versions; check).
- One spare of each part: a dead pod in the car is a real cost.

## 10. Answering questions and plans from the wheel (cycle 60, owner issue #28)

Built and tried on this VM with Claude Code 2.1.332 (recordings in `fixtures/answers/`, its README says what was
seen). Nothing tried on the Pi, the pods or in a car ([untested hardware], bench QA2-1 to QA2-5). The state and the
bar are part 1 (section 4 and DECISIONS "Questions and plans 1"). Same pods, no new button.

**Gestures while CLAUDE ASKS shows for the selected session** (no list or menu open):

| Ask on the bar | up / down tap | press tap (allow) | deny tap | push-to-talk |
|---|---|---|---|---|
| one question, one answer, 1-4 options (`pick`) | move the highlighted choice one option (no wrap; starts on 1, like the terminal's cursor) | answer the highlighted option | cancel the question | refused: "Answer the prompt first" (part 1) |
| a plan (ExitPlanMode, `plan`) | open the session list (as before) | approve: "Yes, manually approve edits" | keep planning | same |
| anything else (`terminal`): several questions in one call, "pick any" (multi-select), no options, a payload with too little | open the session list | nothing sent; the note "Answer in the terminal when parked" | cancel the whole call | same |

"Other" (the terminal's "Type something") stays a voice or terminal answer: the bar does not offer it.

**What the bar shows** (1280x400; the part 1 size rules hold: the question never under 4.0 mm, the options one line
each with an ellipsis):

- The highlighted option is an inverted block: lime `#e6f25a` background, black text, a 3 px white frame. Not by
  colour alone: the block and the frame show it in black and white too. Only one option is ever highlighted; a plan
  or a `terminal` ask has none. Gallery: `asking-choice.png` (option 3), `asking.png` (option 1).
- Row A says `Question` (AskUserQuestion) or `Plan` (ExitPlanMode), not the tool name (cycle 80).
- A hint row under the options says what the buttons do: "Allow picks · Deny cancels", for a plan "Allow approves ·
  Deny keeps planning", for a `terminal` ask "Answer in the terminal when parked" (`asking-terminal.png`). When the
  offline and voice notes take the room, the hint row goes first (the question keeps its 4.0 mm).
- After the answer the prompt leaves the bar at once (as allow/deny of a permission prompt): "Answered" / "Question
  cancelled", "Plan approved" / "Kept planning" in the row where "Allowed: Bash" shows for a permission prompt.

**How the answer reaches Claude** (DECISIONS "Questions and plans 2" weighs the routes):

- **A question** is answered through revview's held PermissionRequest hook, never by keys: the decision is
  `{behavior: allow, updatedInput: {questions: <the request's own questions>, answers: {<question>: <exact label>}}}`.
  The label comes from the held request, by the highlighted index, and must equal the bar's (cut) label. Recorded:
  the picker closes, the pane says `Which fruit? → Plum` and `Allowed by PermissionRequest hook`, and Claude gets
  the answer as if picked in the terminal. The hook itself checks the answer again: the questions must be its own
  stdin's, and every answer one of that question's option labels (`hooks/permission-request.mjs`).
- **Cancel** (deny on a question) is a hook deny ("Denied with the wheel button."): the pane says `Denied by
  PermissionRequest hook`, Claude goes on without an answer. Not the terminal's Esc (which ends the turn and fires no
  event).
- **Keep planning** (deny on a plan) is a hook deny with "Not yet: keep planning. Denied with the wheel button.":
  Claude stays in plan mode (recorded: it then asked what to change, or said it would wait for changes).
- **Approve a plan** is the key `2` sent into the owned tmux pane: a hook allow does not approve a plan in 2.1.332
  (recorded: the dialog stayed). `2` picks "2. Yes, manually approve edits" at once whatever the cursor (recorded,
  also for questions: a digit picks that option directly, arrows are relative). Manual approval keeps later edits
  as permission prompts the wheel can answer; "auto mode" is never chosen by the buttons.

**Guard: nothing is sent unless** (each refusal has a note on the bar, kind `ask`, gone when the question changes or
at the next gesture):

| Case | Bar says |
|---|---|
| the question on the bar changed between the gesture and the send (another `since`, the choice moved, a list opened, another session selected), or the label in the held request differs from the bar's | Not sent: the question changed |
| the question is no longer held (answered in the terminal: Claude ends the hook; 16 requests already held; after an Esc or the 540 s timeout the bar has dropped the question, so there is nothing to press) | Not sent: the question is not waiting any more |
| shown for less than 1.5 s | Too early: press again (as for permission prompts) |
| the session is not one revview started (no tmux window of its own) | Not sent: not a session revview started |
| several questions, multi-select, a request with no questions | Answer in the terminal when parked (plan: Approve in the terminal when parked); note kind `terminal`, not drawn under a `terminal` ask whose hint row already says it |
| plan: the pane does not show the dialog's three choices `1. Yes…`, `2. Yes, manually approve edits`, `3. Tell Claude what to change` on consecutive lines (read with `capture-pane` just before the key) | Not sent: the terminal does not show the plan |

The held request releases its slot in every case: answered by the hook (the registry finishes it), or ended by
Claude when the terminal answered or the key approved the plan (the hook process is killed, the server sees the
connection close and drops it). There is never a second answer: a question gets no key, a plan gets no hook allow.

**A held request that ends unanswered (cycle 60, QA r11-02).** No hook fires on Esc, but Claude closes the hook
connection at once (`fixtures/answers/events-esc.jsonl`). When the long poll ends without revview answering, the server
applies the internal event `RevviewAskGone {session_id, agent, since, how}` (refused over HTTP) and the board drops exactly
that entry, so push-to-talk works again (no cue plays; a later question cues once). For `closed` the server first waits
1.5 s (cycle 80): answering in the terminal closes the connection too, and its PostToolUse, which comes within that time,
removes the entry first, so the late `RevviewAskGone` does nothing. When it still finds the main agent's entry, the
question was dismissed with Esc, which ends Claude's turn without any event: the session shows WAITING FOR ME, as after
revview's own Esc (`RevviewInterrupted`). A subagent's entry is only dropped (not recorded). The two cases are told apart by who ended the poll: `closed` (the connection closed before revview answered:
Esc, or a killed hook; the hook's own 600 s timeout is later than our 540 s, so that never comes first) says nothing, the
question is gone; `timeout` (our 540 s wait ran out and the 204 gave the question to the terminal, where the picker may
still be open) leaves the note "Question left for the terminal" ("Plan left for the terminal"), kind `left`, gone with the
next gesture or when a question is on the bar again. It never fires for an answered request, nor for another entry of the
session (the entry is found by session, agent and `since`). Not tried on a real Claude after this change.

**Not solved:** which of several questions is on screen (several are refused). A terminal answer whose PostToolUse
comes more than 1.5 s after the picker closed shows WAITING FOR ME until that event (never seen; DECISIONS cycle 80).

## Not recorded / not proven

- `/voice` in any mode (no microphone on the recording VM), hold-to-talk, and voice inside tmux.
- Anything on hardware: pods, dongle, key codes, latency, reconnect, the grab, the 3.5 mm output.
- The default timeout of a command hook with no `timeout` field.
- Whether the `claude agents` state resolves after an interrupt (it still said "working").
- Whether `claude remote-control` can interrupt or answer permissions.
- Whether a `--bg` session has any input channel other than `attach`.
- ~~Two sessions with a permission prompt in the non-selected one.~~ Recorded in WB3
  (`fixtures/buttons/wb3/`, `wb3-two-sessions`): allow on the chosen session does nothing to it; the terminal
  answer works. WB3 also recorded allow and deny by button through the real hook and server, a subagent prompt
  (the main pane shows no dialog while the hook waits; what happens when nobody answers is not recorded), Esc and
  a single Ctrl+C by button. See DECISIONS "wheel buttons 3".
- The timing constants of hold mode (from minified code; may change).
- That 3.5 mm text is readable on the dash (bench 26).
