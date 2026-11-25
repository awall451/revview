// Runs a speech engine: one utterance at a time. See config/speech.json.
// SAFETY. The text is Claude's output, so it is untrusted: it goes to the first program's stdin and nowhere
// else (never a shell, never an argument). Programs are started from an argument list with shell:false, each
// in its own process group, so stop() can end the program and everything it started. Whatever goes wrong
// (program missing, not allowed, exits with an error, closes its stdin early) is logged and never thrown.
import { spawn as nodeSpawn } from 'node:child_process';

const quiet = () => {};

// resolves with the promise's value, or undefined after `ms`; never leaves a timer behind
function within(promise, ms) {
  let t;
  const timeout = new Promise((r) => { t = setTimeout(r, ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

export function createSpeaker({ engine, spawn = nodeSpawn, log = () => {}, killWaitMs = 500 }) {
  let current = null; // the utterance being spoken: { stages, stopping, done }
  let closed = false;
  let chain = Promise.resolve();

  // speak, stop and close run one after the other, so two utterances can never be alive together
  const serial = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.then(quiet, quiet);
    return run;
  };

  // signal the process group of every stage still running (the group id is the stage's pid)
  function signalAll(utt, signal) {
    for (const st of utt.stages) {
      if (st.pid === undefined || st.exited) continue;
      try { process.kill(-st.pid, signal); } catch { /* already gone */ }
    }
  }

  async function terminate(utt) {
    utt.stopping = true;
    signalAll(utt, 'SIGTERM');
    await within(utt.done, killWaitMs);
    if (utt.stages.some((st) => !st.exited)) {
      signalAll(utt, 'SIGKILL');
      await within(utt.done, killWaitMs);
    }
    if (current === utt) current = null; // never wait forever
  }

  const stopNow = async () => { if (current !== null) await terminate(current); };

  function launch(text) {
    const utt = { stages: [], stopping: false, done: null };
    const last = engine.stages.length - 1;
    const waits = [];
    try {
      engine.stages.forEach((argv, i) => {
        const child = spawn(argv[0], argv.slice(1), {
          detached: true, shell: false, stdio: ['pipe', i === last ? 'ignore' : 'pipe', 'ignore'],
        });
        const st = { pid: child.pid, exited: false };
        utt.stages.push(st);
        child.stdin?.on('error', quiet); // EPIPE: the program closed its input early
        child.stdout?.on('error', quiet);
        waits.push(new Promise((resolve) => {
          const end = () => { st.exited = true; resolve(); };
          child.on('error', (e) => { // could not start (ENOENT, EACCES): end the whole utterance
            log(`read aloud: ${engine.name} could not start ${argv[0]}: ${e?.code ?? 'error'}`);
            end();
            if (!utt.stopping) { utt.stopping = true; signalAll(utt, 'SIGTERM'); }
          });
          child.on('exit', (code, signal) => {
            end();
            if (!utt.stopping && (code !== 0 || signal)) log(`read aloud: ${engine.name} exited with ${code ?? signal}`);
            // whatever this stage started and left running goes with it
            if (st.pid !== undefined) { try { process.kill(-st.pid, 'SIGTERM'); } catch { /* none left */ } }
          });
        }));
        if (i === 0) child.stdin?.end(`${text}\n`);
        else utt.stages[i - 1].child.stdout.pipe(child.stdin);
        st.child = child;
      });
    } catch (e) {
      utt.stopping = true;
      signalAll(utt, 'SIGKILL');
      log(`read aloud: ${engine.name} could not start: ${e?.code ?? e?.message ?? 'error'}`);
      return null;
    }
    utt.done = Promise.all(waits).then(() => { if (current === utt) current = null; });
    return utt;
  }

  async function doSpeak(text) {
    if (closed) return { spoken: false, reason: 'closed' };
    if (!engine) return { spoken: false, reason: 'no engine' };
    if (typeof text !== 'string' || text.trim() === '') return { spoken: false, reason: 'nothing to say' };
    await stopNow();
    if (closed) return { spoken: false, reason: 'closed' };
    const utt = launch(text);
    if (utt === null) return { spoken: false, reason: 'could not start' };
    current = utt; // utt.done clears it when every stage has ended
    return { spoken: true };
  }

  return {
    speak: (text) => serial(() => doSpeak(text)),
    stop: () => serial(stopNow),
    speaking: () => current !== null,
    // resolves when no utterance is alive
    idle: async () => { while (current !== null) await (current.done ?? Promise.resolve()); },
    close: () => { closed = true; return serial(stopNow); },
  };
}
