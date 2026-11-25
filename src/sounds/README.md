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
