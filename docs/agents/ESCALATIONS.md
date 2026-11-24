# ESCALATIONS

## 2026-11-22: wheel buttons go beyond charter stage 3 (owner decision needed)

Resolved: 2026-11-22, the owner approved all of it (message 20261122T064434Z-o-942fed: build as phased in docs/BUTTONS.md section 8); WB1-WB6 are merged. Line added 2026-11-23.

The charter's stage 3 is "Mapping a button (USB/Bluetooth keyboard key or GPIO) to Claude Code's push-to-talk
key". The owner's request 20261122T060852Z-p-dcd34d adds a menu, starting sessions, projects, settings,
session switching and read-aloud on demand. These go beyond stage 3. The team has NOT widened scope and builds
nothing beyond stage 3 until the owner decides. The lead will also ask through the owner inbox. The design is in
`docs/BUTTONS.md`.

Inside stage 3:
- Reading the button device (input layer, exclusive grab, key map in config).
- Mapping a button to push-to-talk in tap mode.
- revview owning the session's terminal as far as needed to deliver that key (one session).
- Bench items for the button itself (`docs/BENCH-TEST.md` 27-35; 36-38 belong to the parts beyond stage 3).

In the owner's DESIGN.md but not in the charter text (owner to confirm):
- A button for "yes" on permission prompts (DESIGN.md, the "second button" note, now allow and deny).

Beyond stage 3:
- Deny button.
- Cancel (Esc, and Ctrl+C on a hold).
- Navigation pod: list, left/right session switching, back and home.
- Menu: new session, projects, settings.
- Starting and managing several sessions.
- Read-aloud on demand. (The spoken summary on Stop is stage 2 and inside.)

Ask: approve widening the scope to these, or keep to stage 3.

## 2026-11-22: the cycle schedule skips slots (kit behaviour, the team cannot change it)

Asked by the owner (message 20261122T174730Z-o-27fe95). Details in JOURNAL.md, same date. For the owner or the kit's maintainer to decide:

- The daily cap counts owner-started one-shots and planning cycles, and scheduled slots are skipped once it is reached ("skipped: daily cap (11/8)" at 12:00 and 12:45 New York time on 2026-11-22). Either keep the cap well above slots + expected jobs, or have the kit not count owner-started cycles against scheduled slots.
- The cap's day is the UTC day; the schedule's day is the `tz` day. In New York the count resets at 19:00 local.
- Saving the schedule marks slots of the last 10 minutes as used with no log line (`daily@01:00` on 2026-11-22).
- Slots closer together than a cycle lasts (cycles here took 12-114 minutes) are skipped while the earlier cycle runs.

## 2026-11-24: archive domains show `installed` but the proxy still refuses them (blocks the Pi-facts job)

Requests 20261123T223049Z-k-b88da2 (`domain:deb.debian.org`) and 20261123T223049Z-k-9f5df3 (`domain:archive.raspberrypi.com`) show `installed`. At 2026-11-24T01:09Z (cycle 37, at least two cycles after the approval) the proxy still answers 403 for both:

    curl -sS -o /dev/null -w '%{http_code}' -m 20 http://deb.debian.org/debian/dists/trixie/Release           -> 403
    curl -sS -o /dev/null -w '%{http_code}' -m 20 http://archive.raspberrypi.com/debian/dists/trixie/Release  -> 403
    (https: "CONNECT tunnel failed, response 403"; header `X-Squid-Error: ERR_ACCESS_DENIED`, from `agent-gw`)

Other allowed domains work (`registry.npmjs.org` gives 200). So the allow-list the proxy reads does not contain the two domains, or the proxy was not reloaded.

Blocked by this: steps 3-6 of owner message 20261123T223057Z-o-c4f87f (backlog f59dbf, owner issue 20261123T223054Z-i-7afd33). The team does not use another route to the packages.

Ask: make the two domains really reachable through the proxy (http and https). The team tests them at the start of every cycle and runs the job in the first cycle where both give 200.
