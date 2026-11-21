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
