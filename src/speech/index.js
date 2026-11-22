// Read aloud (wheel button F14). See config/speech.json for the engines.
import { pendingPrompts } from '../state/index.js';
import { spokenText, closingText } from './text.js';

export { permissionText, closingText, spokenText, SPEECH_LIMITS, NOTHING_TO_READ } from './text.js';
export { createClosingMemo } from './memo.js';
export { DEFAULT_SPEECH_CONFIG_PATH, loadSpeechConfig, pickEngine, describeChoice, SpeechConfigError } from './config.js';
export { createSpeaker } from './speaker.js';

// Ties the speaker, the memo of closing messages and the board together.
//   textFor(board, id)             what a press would say for session id (a pending prompt, else the closing words)
//   speakFor(board, id)            says it; resolves with the speaker's result plus { text }
//   onEvent(event, board, selectedId)  remembers Stop messages; with speakOnStop it also reads the selected session's
//                                  closing words when its turn really ended. `board` is the board after the event.
export function createReadAloud({ speaker, memo, speakOnStop = false, log = () => {} }) {
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
      if (!speakOnStop || event?.hook_event_name !== 'Stop' || typeof selectedId !== 'string' || event.session_id !== selectedId) return null;
      // a Stop with background subagents still running leaves the session working: that is not the end
      if (board?.sessions?.[selectedId]?.state?.activity === 'working') return null;
      const text = closingText(memo.get(selectedId));
      if (text === '') return null;
      return Promise.resolve(speaker.speak(text)).catch((e) => { log(`read aloud failed: ${String(e?.message ?? e)}`); });
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
