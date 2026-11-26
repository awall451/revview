---
id: qa-20261126-r11-00
title: QA round r11 (cycle 60) - stack/snd e2ec885: answering questions from the wheel, and sounds
severity: report
area: CLAUDE ASKS gestures (BUTTONS section 10), src/sounds, laptop guide
---
Checkout: worktree of e2ec885, `npm ci` there (dev tools only), no full tools/check (the gate runs it).
Driven with Playwright headless at 1280x400 (1 mm = 6.74 px), screenshots looked at.

## What was tested and seen

**A. Questions from the wheel**
- Demo (`emulator/run.sh --no-browser`, key 0): option 1 highlighted as an inverted lime block with a 3 px white frame;
  obvious in a glance and not colour alone. Question 8.28 mm, options and hint 4.86 mm (hint grey 184/255).
  Down/Down moves 1 -> 2 -> 3 (see r11-04). In the demo Enter/N only log (GET /buttons), as the guide says.
- Static states (`?state=`, `?fixture=`): four options, four long options with choice 4, long repo/branch, plan with a
  long title, offline + voice note, refusal note. Nothing outside 400 px; question min 6.74 mm; options cut with an
  ellipsis at about 28 characters (options that differ only after that would look the same; not filed, labels are
  usually short). Plan: "Allow approves · Deny keeps planning".
- Live trial (`run.sh --live` in a new folder, `claude` wrapper with `--model haiku`, sign-in from the kit's auth
  file; prompts typed into the tmux pane; bar driven by laptop keys): "Which fruit?" Down, menu open/close, press ->
  "Too early: press again" (the 1.5 s restarts after the menu hid the question: reasonable), press again -> pane
  "Which fruit? -> Banana / Allowed by PermissionRequest hook", bar DONE "Answered". "Which tea?" Esc in the terminal,
  then press/deny/talk -> stuck (r11-02). Multi-select -> press refused "Answer in the terminal when parked" (twice,
  r11-03), up/down open the list, deny -> "Question cancelled". Plan: deny -> "Kept planning", Claude then asked
  what to change; answered option 3 from the bar; new plan: press -> key 2 approved it, Write -> NEEDS PERMISSION,
  press -> hello.txt written. Keys sheet (`--keys`) matches what the keys did under CLAUDE ASKS.
- After the trial: no run.sh/server/tmux/Chromium of mine left (ps), ~/.claude/settings.json md5 unchanged
  (cleanupPeriodDays, theme only). The plan file Claude wrote under ~/.claude/plans was removed by me.

**B. Sounds** (no audio device: nothing was heard). Stand-in player logging its argv (`cuePlayers` in a config copy
via REVVIEW_SPEECH), a logging speech engine for the order check.
- WAVs read sample by sample: all RIFF/WAVE PCM 16-bit mono 22050 Hz, sizes consistent, no clipped samples, start/end
  at 0. needs 0.600 s four bursts ~655/876/633/867 Hz, peak -4.4 dBFS; done 0.200 s 879 Hz, -7.3 dBFS; failed
  0.390 s 520 -> 328 Hz, -4.4 dBFS; other 0.080 s 595 Hz, peak 6553 (= 1/5 full scale). Matches DECISIONS.
- Demo play: permission scene -> needs; done scene -> other then done; waiting -> none. A jump (keys 1-0) replays the
  scenes fast and gives up to two cues (queue of one) - demo only, not filed.
- Live trial: one needs per question/plan/permission, one done per turn; moving the choice, the menu, a refused
  press, Esc in the terminal and page reloads gave no cue. Two page reloads in the demo: no cue.
- Standalone server: selected session Stop -> done cue, then the spoken summary 0.3 s later (after the cue);
  other session's permission -> two `other` cues (needs, then done); StopFailure -> failed. The same Stop posted
  twice: no second cue, but the summary was spoken again (mode speech; hooks never retry, so only a replay does this;
  not filed).
- Settings row: cycles cues -> cues and speech -> off, title SETTINGS. In the demo with "off" three scene jumps gave
  no cue and R (read aloud) still ran (log "action read-aloud: done"). (My standalone "off" run was invalid: two
  presses cycled past off back to cues; the cues seen there were in mode cues.)
- No-player case: not seen in the terminal; the start line is only in the run's temp server log (r11-06).

## Not tested
- Anything heard, any volume, the Pi's audio (bench SC items). The 540 s hook timeout (r11-02 reasons from code).
- Moving the choice then switching to another session (the demo's asking scene has one session; the live run had one).
- Several questions in one call live (only multi-select tried). The "plan dialog not on screen" refusal.
- WSL2 / a real laptop desktop window (headless only).

## Findings
- should fix: r11-01 (hint row lost after menu/list), r11-02 (stale ask locks out the wheel incl. push-to-talk)
- small: r11-03, r11-04, r11-05, r11-06
None is a merge blocker: answering, cancelling, plan approve/keep planning and the cues all worked as documented.
