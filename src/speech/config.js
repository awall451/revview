// config/speech.json: which programs can read text aloud. Checked strictly, because these are programs we run.
// The file lists engines in order of preference; the first one that is installed is used (pickEngine).
// There is no placeholder substitution: every argument is used exactly as written.
import { readFileSync, accessSync, existsSync, constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join, delimiter } from 'node:path';

export const DEFAULT_SPEECH_CONFIG_PATH = fileURLToPath(new URL('../../config/speech.json', import.meta.url));

export class SpeechConfigError extends Error {
  constructor(message) {
    super(`speech config: ${message}`);
    this.name = 'SpeechConfigError';
  }
}

const MAX_ENGINES = 8;
const MAX_STAGES = 3;
const MAX_ARGS = 32;
const MAX_ARG_CHARS = 512;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkKeys(obj, allowed, where) {
  for (const k of Object.keys(obj)) {
    if (!k.startsWith('_') && !allowed.includes(k)) throw new SpeechConfigError(`${where}: unknown key "${k}"`);
  }
}

function checkStage(stage, where) {
  if (!Array.isArray(stage) || stage.length === 0 || stage.length > MAX_ARGS) {
    throw new SpeechConfigError(`${where}: a stage is a list of 1 to ${MAX_ARGS} strings`);
  }
  for (const a of stage) {
    if (typeof a !== 'string' || a === '' || a.includes('\0') || a.length > MAX_ARG_CHARS) {
      throw new SpeechConfigError(`${where}: every argument is a non-empty string of at most ${MAX_ARG_CHARS} characters without NUL`);
    }
  }
  if (!isAbsolute(stage[0]) && !/^[A-Za-z0-9._+-]+$/.test(stage[0])) {
    throw new SpeechConfigError(`${where}: the program must be an absolute path or a bare command name, not "${stage[0]}"`);
  }
  return [...stage];
}

function checkEngine(e, i) {
  const where = `engines[${i}]`;
  if (!isObj(e)) throw new SpeechConfigError(`${where} must be an object`);
  checkKeys(e, ['name', 'stages', 'needs'], where);
  if (typeof e.name !== 'string' || !/^[a-z0-9-]{1,32}$/.test(e.name)) {
    throw new SpeechConfigError(`${where}: name must be 1 to 32 characters of a-z, 0-9 and -`);
  }
  if (!Array.isArray(e.stages) || e.stages.length === 0 || e.stages.length > MAX_STAGES) {
    throw new SpeechConfigError(`${where}: stages must be a list of 1 to ${MAX_STAGES} stages`);
  }
  const stages = e.stages.map((s, j) => checkStage(s, `${where}.stages[${j}]`));
  const needs = e.needs ?? [];
  if (!Array.isArray(needs) || !needs.every((n) => typeof n === 'string' && !n.includes('\0') && isAbsolute(n))) {
    throw new SpeechConfigError(`${where}: needs must be a list of absolute paths`);
  }
  return { name: e.name, stages, needs: [...needs] };
}

// A missing file means no engines (the button then does nothing). A file that is there but wrong throws.
export function loadSpeechConfig(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return { engines: [], speakOnStop: false };
    throw new SpeechConfigError(`cannot read ${file}: ${e?.message ?? e}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new SpeechConfigError(`${file} is not valid JSON: ${e.message}`);
  }
  if (!isObj(data)) throw new SpeechConfigError('the file must hold one object');
  checkKeys(data, ['engines', 'speakOnStop'], 'top level');
  if (!Array.isArray(data.engines) || data.engines.length > MAX_ENGINES) {
    throw new SpeechConfigError(`engines must be a list of at most ${MAX_ENGINES} engines`);
  }
  const speakOnStop = data.speakOnStop ?? false;
  if (typeof speakOnStop !== 'boolean') throw new SpeechConfigError('speakOnStop must be true or false');
  return { engines: data.engines.map(checkEngine), speakOnStop };
}

// mode 'exec': a program we can run; mode 'file': any file that is there
function defaultExists(p, mode) {
  if (mode !== 'exec') return existsSync(p);
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function hasProgram(name, exists) {
  if (isAbsolute(name)) return exists(name, 'exec');
  return (process.env.PATH ?? '').split(delimiter).filter((d) => d !== '').some((d) => exists(join(d, name), 'exec'));
}

// The first engine whose programs are all found and whose needed files are all there, else null.
export function pickEngine(config, { exists = defaultExists } = {}) {
  for (const e of config.engines) {
    if (e.stages.every((s) => hasProgram(s[0], exists)) && e.needs.every((n) => exists(n, 'file'))) return e;
  }
  return null;
}

// One plain line for the log.
export function describeChoice(config, engine) {
  if (engine) return `read aloud: ${engine.name} (${engine.stages[0][0]})`;
  if (config.engines.length === 0) return 'read aloud: no engines configured';
  return `read aloud: no speech engine found (tried ${config.engines.map((e) => e.name).join(', ')}): the read-aloud button does nothing`;
}
