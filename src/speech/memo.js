// The last thing Claude said at the end of each session's turn (a Stop hook's last_assistant_message), kept
// so the read-aloud button can speak it. It lives here, outside the state core, on purpose: the board and the
// view stay as they are. Bounded: at most `max` sessions, `maxChars` each, oldest dropped first.

const nonEmpty = (v) => typeof v === 'string' && v !== '';

export function createClosingMemo({ max = 16, maxChars = 8000 } = {}) {
  const map = new Map(); // insertion order = oldest first

  return {
    // a raw hook event; junk is ignored, never thrown at
    note(event) {
      if (event === null || typeof event !== 'object') return;
      const id = event.session_id;
      if (!nonEmpty(id)) return;
      if (event.hook_event_name === 'SessionEnd') {
        map.delete(id);
      } else if (event.hook_event_name === 'Stop' && typeof event.last_assistant_message === 'string') {
        map.delete(id); // re-inserting makes it the newest
        map.set(id, event.last_assistant_message.slice(0, maxChars));
        while (map.size > max) map.delete(map.keys().next().value);
      }
    },
    get: (sessionId) => (map.has(sessionId) ? map.get(sessionId) : null),
    size: () => map.size,
  };
}
