import { pendingPrompts, selectedKey } from '../state/index.js';
import { text } from './http.js';
import { readBody } from './routes-event.js';

// The PermissionRequest hook's long poll. The request is bound to the prompt this very event put on the
// board (matched by session, agent and the board tick); nothing the client sends can name another prompt,
// and no route answers it: only a wheel button (src/sessions/actions.js) can.
export function postPermission(ctx, req, res) {
  readBody(ctx, req, res, (body) => {
    let ev;
    try {
      ev = JSON.parse(body);
    } catch {
      return text(res, 400, body.trim() === '' ? 'empty body' : 'malformed JSON');
    }
    if (ev === null || typeof ev !== 'object' || Array.isArray(ev) || ev.hook_event_name !== 'PermissionRequest'
      || typeof ev.session_id !== 'string' || ev.session_id === '' || typeof ev.tool_name !== 'string') {
      return text(res, 400, 'expected a PermissionRequest hook object');
    }
    const before = ctx.board;
    if (!ctx.apply(ev)) return text(res, 500, 'state core failed; event ignored');
    ctx.quietSeen?.(ev.session_id, ev.hook_event_name);
    try { // a new question or plan is read out as on /event; a speech failure never breaks this route
      ctx.readAloud?.onEvent(ev, ctx.board, selectedKey(ctx.board));
    } catch (e) {
      console.error('read aloud failed:', e instanceof Error ? e.message : e);
    }
    if (!ctx.sessions) return res.writeHead(204).end(); // no buttons can answer: the terminal dialog stays
    const agent = typeof ev.agent_id === 'string' && ev.agent_id !== '' ? ev.agent_id : '';
    // only an entry THIS event created (the board changed and the entry is from this tick) is bound, so its
    // text on the bar is this request's own tool and command
    const mine = ctx.board === before ? [] : pendingPrompts(ctx.board).filter((p) => p.session === ev.session_id
      && p.agent === agent && p.since === ctx.board.tick);
    let prompt;
    if (mine.length === 1) prompt = mine[0];
    else {
      prompt = { session: ev.session_id, agent, since: null, tool: ev.tool_name, file: null, command: null };
      console.error('permission request not bound to a prompt on the bar: buttons cannot answer it');
    }
    const input = ev.tool_name === 'AskUserQuestion' && ev.tool_input !== null && typeof ev.tool_input === 'object'
      && !Array.isArray(ev.tool_input) ? ev.tool_input : null;
    let over = false;
    // a question or a plan that revview did not answer and the terminal did not either (QA r11-02): the board drops
    // it. 'closed': Claude closed the hook connection first (Esc on the picker; the hook's own timeout of 600 s is
    // later than ours of 540 s), so the question is gone. 'timeout': our wait ran out and the 204 hands the question
    // to the terminal, where it may still be open: the bar says it is left there, never that it is gone.
    const gone = (how) => {
      if (prompt.since !== null && (ev.tool_name === 'AskUserQuestion' || ev.tool_name === 'ExitPlanMode')) {
        ctx.apply({ hook_event_name: 'RevviewAskGone', session_id: prompt.session, agent: prompt.agent, since: prompt.since, how });
      }
    };
    const id = ctx.registry.add(prompt, (decision, why) => {
      if (over || res.writableEnded) return;
      over = true;
      if (why === 'timeout') gone('timeout');
      if (decision === null) return res.writeHead(204).end();
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(decision));
    }, input);
    if (id === null) return text(res, 503, 'too many waiting permission requests');
    res.on('close', () => {
      const unanswered = !over;
      over = true;
      ctx.registry.remove(id);
      if (unanswered) gone('closed');
    });
  });
}
