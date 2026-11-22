# ESCALATIONS

## 2026-11-22: wheel buttons go beyond charter stage 3 (owner decision needed)

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
