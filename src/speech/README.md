# Speech (read aloud)

Reads the selected session's permission prompt or closing message aloud through a program on the Pi. Built for
the read-aloud wheel button (`docs/BUTTONS.md` section 5, DECISIONS "wheel buttons 5"). Node standard library only.
**Untested with a real engine or sound:** there is no audio device and no engine in the development VM.

## Files

- `text.js`: what is spoken. A pending permission prompt wins ("Permission: Bash <command>", cut at a word to 100
  characters plus "..."; other tools "Permission: <tool> <file base name>"). Else the last Stop message: code
  blocks, inline code, URLs, links (text kept), file paths and markdown removed, at most 3 sentences and 300
  characters. Nothing to say gives "Nothing to read." (`NOTHING_TO_READ`).
  Path rule: a word is dropped if it starts with /, ./, ../, ~/ or a drive letter, has two or more slashes, is one slash plus a file extension, or is name.ext (index.js, README.md); and/or, input/output stay spoken (slash as a space), Node.js and Next.js (Capitalized.js) are names, .env is spoken. [[ ]] and < > are replaced by spaces.
- `memo.js`: the last Stop message per session, kept outside the state core (the board and view stay unchanged).
  At most 16 sessions and 8000 characters each; forgotten on SessionEnd.
- `config.js`: loads and checks `config/speech.json`; `pickEngine` takes the first engine whose programs and `needs`
  files exist; `describeChoice` makes the log line.
- `speaker.js`: one utterance at a time. A new speak stops the old one first. Calls are serialized. Failures are
  logged, never thrown.
- `index.js`: `createReadAloud({ speaker, memo, speakOnStop, log })` with `textFor`, `speakFor`, `onEvent`, `stop`, `close`.

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
exactly as written: there is no placeholder substitution. `speakOnStop` is false by default. The Piper entry in
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
Not covered, bench R1-R14: any real engine, the sound, the volume, the start delay, the `audio` group.
