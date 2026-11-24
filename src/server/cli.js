// Live server: hook scripts POST raw Claude Code hook JSON to /event, the state core
// (src/state) reduces it, and the new state is pushed to the page over Server-Sent Events.
// It also serves the view. Binds to 127.0.0.1 only; see src/server/README.md.
//   node src/server/index.js [port] [--input [path]] [--dev-bridge [--dev-keys file] [--dev-demo]] [--sessions] [--start dir]... [--projects file] [--speech file] [--boot] [--netmon] [--thermal] [--data-lock [dir]]   (port default 8138, or REVVIEW_PORT)
//   --boot: key-on start: show STARTING until the first session is on the board; with no tmux windows, start one session in $REVVIEW_START (or each --start dir)
//   --data-lock [dir]: the data is locked until the topmost mount on dir (default /srv/revview-data, or $REVVIEW_DATA_MOUNT) is ext4 from /dev/mapper/revview-data;
//     locked shows INSERT KEY, no session starts (key-on and New session wait); a posted RevviewDataLock is only a poke to re-read the mount table
//   --netmon: watch the network (default route + TCP connect to $REVVIEW_NETMON_HOST, default api.anthropic.com:443); offline after 2 failures, online after 1 success; a posted RevviewNetwork is only a poke to probe again
//   --thermal: watch temperature and the Pi throttle flags: HOT and LOW POWER marks (sources: $REVVIEW_THERMAL_TEMP file, default /sys/class/thermal/thermal_zone0/temp;
//     `vcgencmd get_throttled`, command path $REVVIEW_THERMAL_VCGENCMD, or a file $REVVIEW_THERMAL_THROTTLED instead of the command); a missing source is logged once
import path from 'node:path';
import { DEFAULT_DATA_MOUNT } from './datalock.js';
import { createDefaultProbe } from './netmon.js';
import { createDefaultReaders, thermalEnv, DEFAULT_TEMP_PATH, DEFAULT_VCGENCMD } from './thermal.js';
import { createSessionRunner, loadProjects } from '../sessions/index.js';
import { loadConfig, ConfigError, DEFAULT_CONFIG_PATH } from '../input/keymap.js';
import { loadSpeechConfig, pickEngine, describeChoice, SpeechConfigError, DEFAULT_SPEECH_CONFIG_PATH } from '../speech/index.js';
import { DEFAULT_PORT, startLiveServer } from './live.js';
import { bootSessions, bootAfterUnlock, netmonTarget, installShutdown } from './boot.js';

export function parseArgs(argv) {
  const out = { port: null, inputPath: null, devBridge: false, sessions: false, start: [], projects: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dev-bridge') out.devBridge = true;
    else if (a === '--sessions') out.sessions = true;
    else if (a === '--boot') out.boot = true;
    else if (a === '--netmon') out.netmon = true;
    else if (a === '--thermal') out.thermal = true;
    else if (a === '--data-lock') {
      const next = argv[i + 1];
      if (next !== undefined && next.startsWith('/')) { out.dataLock = next; i++; } else out.dataLock = DEFAULT_DATA_MOUNT;
    }
    else if (a === '--start') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error('--start needs a directory');
      out.start.push(next);
      out.sessions = true;
      i++;
    }
    else if (a === '--projects') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error('--projects needs a file');
      out.projects = next;
      i++;
    } else if (a === '--tmux-socket') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error('--tmux-socket needs an absolute file path');
      if (!next.startsWith('/')) throw new Error(`--tmux-socket needs an absolute file path, got ${next}`);
      out.tmuxSocket = next;
      i++;
    } else if (a === '--claude-settings') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error('--claude-settings needs an absolute file path');
      if (!next.startsWith('/')) throw new Error(`--claude-settings needs an absolute file path, got ${next}`);
      out.claudeSettings = next;
      i++;
    } else if (a === '--speech') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error('--speech needs a file');
      out.speech = next;
      i++;
    } else if (a === '--dev-demo') out.devDemo = true;
    else if (a === '--dev-keys') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error('--dev-keys needs a file');
      out.devKeysPath = next;
      i++;
    } else if (a === '--input') {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out.inputPath = next; i++; } else out.inputPath = DEFAULT_CONFIG_PATH;
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else if (out.port === null && /^\d+$/.test(a)) out.port = Number(a);
    else throw new Error(`unexpected argument ${a}`);
  }
  if (out.devKeysPath && !out.devBridge) throw new Error('--dev-keys needs --dev-bridge');
  if (out.devDemo && !out.devBridge) throw new Error('--dev-demo needs --dev-bridge');
  if (out.port === null) out.port = Number(process.env.REVVIEW_PORT || DEFAULT_PORT);
  if (out.boot && out.start.length === 0 && process.env.REVVIEW_START) out.start = [process.env.REVVIEW_START];
  if (out.dataLock === undefined && process.env.REVVIEW_DATA_MOUNT) out.dataLock = process.env.REVVIEW_DATA_MOUNT;
  if (out.dataLock !== undefined && !/^\/[A-Za-z0-9._/-]+$/.test(out.dataLock)) throw new Error(`--data-lock needs an absolute directory (letters, digits, . _ / -), got ${out.dataLock}`);
  if (out.dataLock !== undefined && out.start.length > 0 && !out.boot) throw new Error('--start with a data lock needs --boot (the key-on session waits for the unlock)');
  if (out.projects === null) out.projects = process.env.REVVIEW_PROJECTS || null;
  // the key exists only when a speech file was named (flag or REVVIEW_SPEECH)
  if (out.speech === undefined && process.env.REVVIEW_SPEECH) out.speech = process.env.REVVIEW_SPEECH;
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  let input = null;
  let devKeys = null;
  try {
    args = parseArgs(argv);
    if (args.inputPath) input = loadConfig(args.inputPath);
    if (args.devKeysPath) devKeys = loadConfig(args.devKeysPath);
  } catch (e) {
    console.error(e instanceof ConfigError || e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  let runner = null;
  const startedIds = []; // sessions --start made without --boot: marked STARTING like a menu New session (live.launched)
  let selectId = null; // the session the buttons act on at boot: the last one started, else the only one there is
  if (args.sessions) {
    runner = createSessionRunner({
      socket: args.tmuxSocket ? { path: args.tmuxSocket } : { name: 'revview' },
      ...(args.claudeSettings ? { claude: ['claude', '--settings', args.claudeSettings] } : {}),
      log: (m) => console.error(m),
    });
    if (!args.boot) {
      try {
        const existing = await runner.list();
        if (existing.length === 1) selectId = existing[0].id;
        for (const dir of args.start) {
          selectId = (await runner.start({ cwd: path.resolve(dir) })).id;
          startedIds.push(selectId);
        }
      } catch (e) {
        console.error(`sessions: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(2);
      }
    }
  }
  let netmon = null;
  let netmonLine = null;
  if (args.netmon) {
    const { host, port } = netmonTarget(process.env.REVVIEW_NETMON_HOST, (m) => console.error(m));
    netmon = { probe: createDefaultProbe({ host, port }) };
    netmonLine = `netmon: online = default route + TCP connect to ${host}:${port} every 10 s`;
  }
  let thermal = null;
  let thermalLine = null;
  if (args.thermal) {
    const env = thermalEnv(process.env);
    thermal = createDefaultReaders(env);
    thermalLine = `thermal: temperature from ${env.tempPath ?? DEFAULT_TEMP_PATH}, throttle flags from ${env.throttledPath ?? `${env.vcgencmd ?? DEFAULT_VCGENCMD} get_throttled`} every 5 s`;
  }
  const projects = args.projects ? loadProjects(args.projects, { log: (m) => console.error(m) }) : [];
  // a bad speech config means no voice, never no bar
  let speech = null;
  let speechLine;
  try {
    const config = loadSpeechConfig(args.speech ?? DEFAULT_SPEECH_CONFIG_PATH);
    const engine = pickEngine(config);
    console.error(describeChoice(config, engine));
    speech = { engine, speakOnStop: config.speakOnStop };
    speechLine = `speech: ${engine ? engine.name : 'none found (read aloud does nothing)'}${config.speakOnStop ? ' (spoken summary on Stop: on)' : ''}`;
  } catch (e) {
    if (!(e instanceof SpeechConfigError)) throw e;
    console.error(e.message);
    speechLine = 'speech: off (bad speech config, see the log)';
  }
  const live = await startLiveServer({ port: args.port, input, devBridge: args.devBridge, devKeys, devDemo: args.devDemo === true, sessions: runner, projects, speech, boot: args.boot, netmon, thermal, dataLock: args.dataLock ? { mountPoint: args.dataLock } : null });
  if (args.boot && runner && args.dataLock) {
    const log = (m) => console.error(m);
    bootAfterUnlock({ live, runner, dirs: args.start, log }).then(() => log('boot: key-on session step done'));
  } else if (args.boot && runner) selectId = await bootSessions({ runner, live, dirs: args.start, log: (m) => console.error(m) });
  else if (args.boot) live.bootDone(); // no runner: nothing will ever start a session, so the boot STARTING ends now
  else {
    for (const id of startedIds) live.launched(id); // the same mark and the same 30 s limit as menu -> New session (not the Pi's key-on mark)
    if (selectId !== null) live.select(selectId);
  }
  const selectedNow = selectId !== null && live.selected() === selectId;
  const { url } = live;
  installShutdown(live);
  console.log(`revview live server (127.0.0.1 only)`);
  console.log(`view:  ${url}/`);
  console.log(`post:  curl -s -X POST --data-binary @- ${url}/event < <(head -1 fixtures/sessions/working-turn.jsonl)`);
  if (input) console.log('input: reading wheel buttons (GET /buttons)');
  if (runner) console.log(`sessions: private tmux server (${args.tmuxSocket ? `-S ${args.tmuxSocket}` : '-L revview'}), ${selectId === null ? 'selected: none' : `${selectedNow ? 'selected' : 'wanted'}: ${selectId}`}`);
  console.log(speechLine);
  if (netmonLine) console.log(netmonLine);
  if (thermalLine) console.log(thermalLine);
  if (args.boot) console.log('boot: STARTING until the first session is on the board');
  if (args.boot && runner && args.dataLock) console.log(`boot: the key-on session waits for the data unlock (${args.dataLock})`);
  if (args.projects) console.log(`projects: ${projects.length} from ${args.projects}`);
  if (args.devKeysPath) console.log(`dev keys: ${args.devKeysPath}`);
  if (args.devDemo) console.log('dev demo: GET /dev/demo (the demo player\'s keys 1-9 P [ ] go there, not to the bridge)');
  if (args.devBridge) console.log('dev bridge ON (POST /dev/key): never use this on the car');
}
