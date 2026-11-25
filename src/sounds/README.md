# Sounds

Short audio cues for the bar, made by a deterministic generator with no downloaded assets.

## Cue files

Four cues, each a canonical 44-byte-header PCM WAV: mono, 16-bit little-endian, 22050 Hz, well under one second.
They differ by pattern, not only by pitch.

| Cue | Meaning | Pattern |
| --- | --- | --- |
| `needs` | Claude needs you (a permission prompt or a question) | two rising pairs, 660 then 880 Hz |
| `done` | a turn finished | one 880 Hz bell-like tone with a decay |
| `failed` | a turn failed | a falling pair, 523 then 330 Hz |
| `other` | a change in a session that is not the selected one | one short, quiet 600 Hz tone |

The generator is `wav.js` (`cueWav(name)`); `npm run cues` rewrites `cues/*.wav` from it.
`tests/unit/sounds-wav.test.js` holds the committed bytes equal to the generator and checks the format, the
length, the loudness order and the tone pattern of each cue. The cues were never heard on hardware (no audio
device on the VM): only the format and the bytes are checked.

## Player and queue

`player.js`: `createCuePlayer({ argv, dir, spawn, timers, log, maxMs = 3000, waitBefore })`. `argv` is the player command (for example `['aplay', '-q']`), or null
(no player found: `play()` returns `{ played: false, reason: 'no player' }`). The file `<dir>/<cue>.wav` is the last argument. It is started with
`shell: false`, `detached: true` (own process group) and `stdio: 'ignore'`.

- Queue of one: one cue plays, one may wait. A newer cue replaces the waiting one, except that a waiting needs/done/failed cue is never replaced by `other`.
  A burst gives at most two sounds, never overlapping.
- Before a cue starts it awaits `waitBefore()` (the server passes `speaker.idle()`: a cue does not talk over speech), at most 30 s, then the cue is dropped silently.
- A child running longer than `maxMs` gets SIGKILL to its group. All timeouts use the injected `timers`.
- A spawn error logs `sounds: cue player <program> could not start (<code>); cues are off` once and the player stays off. A non-zero exit logs once per
  distinct code and goes on. Nothing throws. `idle()` resolves when nothing plays or waits; `close()` kills the child and clears the slot and the timers.

## Which change gives which cue

`classify.js` (pure). `cueClass(board, key)` is `needs` (a pending prompt or `activity === 'permission'`: a permission prompt, a question or a plan),
else `failed` (`state.failed`, a StopFailure), else `done` (`activity === 'done'`), else null. Working, waiting (also after `idle_prompt`: the done cue already said
it), starting and quiet placeholders give no cue. `cueFor(prev, next)` looks at every session whose class changed to a non-null one. The selected session
(else the one the bar shows, `shownKey`) gives its own cue; any other session gives `other`; the selected one wins when both change in one step. Selection,
navigation, notes, compaction marks and a repeated identical event do not change a class, so they give nothing. `createSounds({ player, log }).observe(prev, next)`
plays the result when `board.sounds` is `cues` or `speech`, and logs `sounds: <mode>` when the mode changes.

## Config keys

In `config/speech.json`: `sounds` (`off`, `cues`, `speech`; default `cues`; `speakOnStop: true` alone means `speech`) and `cuePlayers` (1 to 4 argument lists; default
`aplay -q`, `pw-play`, `paplay`). `pickPlayer(players)` takes the first whose program is found. The mode is on the board: the Settings row cycles it until the restart.

## Stand-in for tests

`tests/unit/fixtures/sounds/fake-player.sh` records its last argument and the start and end time into `$REVVIEW_FAKE_PLAYER_DIR` (`start.<pid>`, `end.<pid>`),
plays for `$REVVIEW_FAKE_PLAYER_MS` and exits with `$REVVIEW_FAKE_PLAYER_EXIT`. `sounds-player.test.js` uses an injected `spawn` and this script;
`server-sounds.test.js` runs the server with it and the speech stand-in.
