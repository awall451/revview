// Read aloud (wheel button F14). See config/speech.json for the engines.
import { pendingPrompts } from '../state/index.js';
import { spokenText, closingText, askText } from './text.js';

export { permissionText, askText, closingText, spokenText, SPEECH_LIMITS, NOTHING_TO_READ } from './text.js';
export { createClosingMemo } from './memo.js';
export { DEFAULT_SPEECH_CONFIG_PATH, DEFAULT_CUE_PLAYERS, hasProgram, loadSpeechConfig, pickEngine, describeChoice, SpeechConfigError } from './config.js';
export { createSpeaker } from './speaker.js';

const BEFORE_SPEAK_MS = 2000;

// Ties the speaker, the memo of closing messages and the board together.
//   textFor(board, id)             what a press would say for session id (a pending prompt, else the closing words)
//   speakFor(board, id)            says it; resolves with the speaker's result plus { text }
//   onEvent(event, board, selectedId)  remembers Stop messages; with speakOnStop it also reads a new question or plan of the selected session, and reads the selected session's
//                                  closing words when its turn really ended. `board` is the board after the event.
//   speakOnStop: a boolean or a function returning one (read at each event). beforeSpeak: an async function awaited (at most 2 s)
//   before an automatic speech (not before speakFor: a button press speaks at once).
export function createReadAloud({ speaker, memo, speakOnStop = false, beforeSpeak = null, log = () => {}, timers = { setTimeout, clearTimeout } }) {
  const on = () => (typeof speakOnStop === 'function' ? speakOnStop() === true : speakOnStop === true);
  const lastStop = new Map(); // session id -> JSON of its last Stop, while no other event of that session came after it
  const auto = async (text) => {
    if (beforeSpeak) {
      let t;
      try { await Promise.race([Promise.resolve(beforeSpeak()), new Promise((r) => { t = timers.setTimeout(r, BEFORE_SPEAK_MS); })]); } catch { /* speak anyway */ } finally { timers.clearTimeout(t); }
    }
    return speaker.speak(text);
  };
  const textFor = (board, id) => {
    let closing = null;
    try { closing = memo.get(id); } catch { /* nothing remembered */ }
    const prompt = pendingPrompts(board).find((p) => p.session === id) ?? null;
    return spokenText({ prompt, closing });
  };

  const speakFor = async (board, id) => {
    const text = textFor(board, id);
    return { ...(await speaker.speak(text)), text };
  };

  // returns the speak promise when it speaks, else null; never throws
  const onEvent = (event, board, selectedId) => {
    try {
      memo.note(event);
      const sid = event?.session_id;
      const stopJson = event?.hook_event_name === 'Stop' ? JSON.stringify(event) : null;
      const repeated = stopJson !== null && lastStop.get(sid) === stopJson;
      if (stopJson === null) lastStop.delete(sid); // any other event of the session starts afresh
      // a question or plan that waits for the driver is read out the same way (same switch)
      if (on() && event?.hook_event_name === 'PermissionRequest' && typeof selectedId === 'string' && event.session_id === selectedId
        && (event.tool_name === 'AskUserQuestion' || event.tool_name === 'ExitPlanMode')) {
        const first = pendingPrompts(board).find((p) => p.session === selectedId);
        if (!first || !first.ask) return null;
        return auto(askText(first.ask)).catch((e) => { log(`read aloud failed: ${String(e?.message ?? e)}`); });
      }
      if (!on() || event?.hook_event_name !== 'Stop' || typeof selectedId !== 'string' || event.session_id !== selectedId) return null;
      // a Stop with background subagents still running leaves the session working: that is not the end
      if (board?.sessions?.[selectedId]?.state?.activity === 'working') return null;
      const text = closingText(memo.get(selectedId));
      if (text === '') return null;
      if (repeated) return null; // the same Stop posted again: spoken once
      lastStop.set(sid, stopJson);
      return auto(text).catch((e) => { log(`read aloud failed: ${String(e?.message ?? e)}`); });
    } catch (e) {
      log(`read aloud failed: ${String(e?.message ?? e)}`);
      return null;
    }
  };

  return {
    textFor, speakFor, onEvent,
    stop: () => speaker.stop(),
    close: () => speaker.close(),
  };
}
