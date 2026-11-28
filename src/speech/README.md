# Speech (read aloud)

Reads the selected session's permission prompt or closing message aloud through a program on the Pi. Built for
the read-aloud wheel button (`docs/BUTTONS.md` section 5, DECISIONS "wheel buttons 5"). Node standard library only.
**Never heard:** the development VM has espeak-ng 1.51 (the shipped command line was run for real into wav files and pipes) but no audio device, so no sound was ever played. Piper, the Pi and the `audio` group are untested.

## Files

- `text.js`: what is spoken. A pending permission prompt wins ("Permission: Bash <command>", cut at a word to 100
  characters plus "..."; other tools "Permission: <tool> <file base name>"). Else the last Stop message: code
  blocks, inline code, URLs, links (text kept), file paths and markdown removed, at most 3 sentences and 300
  characters. Nothing to say gives "Nothing to read." (`NOTHING_TO_READ`).
  A pending prompt whose `ask` is set (a question or plan waiting for the driver, see `src/state/ask.js`) is read by
  `askText` instead: "Claude asks: <question> Options: 1, <label>. 2, <label>. ... And <n> more. Pick one or more."
  (several questions: "Claude asks 2 questions. First: ..."; no question text: "Claude asks a question. Look at
  the terminal when parked."), or "Claude has a plan: <title>. <n> steps. Approve it in the terminal when parked."
  (title or steps missing: left out). Same cleaning as other text, whole text cut at a word to 300 characters.
  Path rule: a word is dropped if it starts with /, ./, ../, ~/ or a drive letter, has two or more slashes, is one slash plus a file extension, or is name.ext (index.js, README.md); and/or, input/output stay spoken (slash as a space), Node.js and Next.js (Capitalized.js) are names, .env is spoken. [[ ]] and < > are replaced by spaces.
- `memo.js`: the last Stop message per session, kept outside the state core (the board and view stay unchanged).
  At most 16 sessions and 8000 characters each; forgotten on SessionEnd.
- `config.js`: loads and checks `config/speech.json`; `pickEngine` takes the first engine whose programs and `needs`
  files exist; `describeChoice` makes the log line.
- `speaker.js`: one utterance at a time. A new speak stops the old one first. Calls are serialized. Failures are
  logged, never thrown.
- `index.js`: `createReadAloud({ speaker, memo, speakOnStop, beforeSpeak, timers, log })` (`speakOnStop` is a boolean or a function read at each event; `beforeSpeak` is awaited, at most 2 s on `timers` = `{ setTimeout, clearTimeout }`, before an automatic speech but not before a button press; an identical Stop posted again with no other event of that session between is not spoken again; a file name in a plan title is spoken: last part of a path, dots read "dot") with `textFor`, `speakFor`, `onEvent`, `stop`, `close`.

## Config (`config/speech.json`)

    {
      "engines": [
        { "name": "espeak-ng",
          "stages": [["espeak-ng", "-v", "en-us", "-s", "165"]],
          "needs": [] }
      ],
      "speakOnStop": false
    }

Engines are in order of preference. An engine is a list of stages (argv arrays); `needs` is an optional list of
absolute files that must exist. The first engine whose programs and files exist is used. Arguments are used
exactly as written: there is no placeholder substitution. `speakOnStop` is false by default; with it on, a PermissionRequest for AskUserQuestion or ExitPlanMode of the selected session is read aloud too. The Piper entry in
the shipped file is from memory and untested.

## Safety rules

- The text goes only to stdin of stage 1; each stage's stdout is piped to the next stage's stdin.
- Spawned from an argv array with no shell. Each stage is detached, so it is its own process group.
- Stop sends SIGTERM to the groups, then SIGKILL after 500 ms. A new speak, a push-to-talk and `close()` all stop it.
- A hard kill (SIGKILL) of node itself can leave a speech child that finishes its sentence. Not handled.

## Tests

`tests/unit/speech-text.test.js`, `speech-config.test.js`, `speech-speaker.test.js`. The speaker test runs the stand-in
`tests/unit/fixtures/speech/fake-engine.sh`, which records its arguments, its stdin and its pids in a temp
folder and then sleeps, so tests can check the text arrives only on stdin and that no process is left after a stop.
`speech-real-engine.test.js` runs the shipped espeak-ng command line against the real program when it is on PATH
(the test names say so; without it each test only notes that and passes, so the passed count does not depend on the
machine). It uses `-w` files and an unread pipe, never the sound card. Measured with it: text on stdin works, exit 0
(ALSA errors on stderr without a card, ignored); stop ends a blocked espeak-ng and its pipe partner; `[[ ]]` is
phoneme input (confirmed, so text.js removes it); `< >` are not markup without `-m` (spoken as words), scrubbed anyway.
Not covered, bench R1-R14: the sound, Piper, the volume, the start delay, the `audio` group, anything on the Pi.

## Sounds keys in the same file

`sounds` (`"off"`, `"cues"` or `"speech"`) and `cuePlayers` (1 to 4 argument lists, checked like an engine stage) are read by
`loadSpeechConfig` too, and returned as `sounds` and `cuePlayers`. `sounds` wins over the older `speakOnStop`; without either it is `"cues"`;
`speakOnStop: true` alone means `"speech"`. The returned `speakOnStop` is `sounds === 'speech'`. `speaker.idle()` resolves when no utterance is alive
(the cue player waits for it; see `src/sounds/README.md`).
