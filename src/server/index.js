// Live server: hook scripts POST raw Claude Code hook JSON to /event, the state core
// (src/state) reduces it, and the new state is pushed to the page over Server-Sent Events.
// It also serves the view. Binds to 127.0.0.1 only; see src/server/README.md.
//   node src/server/index.js [port] [--input [path]] [--dev-bridge [--dev-keys file] [--dev-demo]] [--sessions] [--start dir]... [--projects file] [--speech file] [--look-config file] [--lights-config file] [--boot] [--netmon] [--thermal] [--data-lock [dir]]   (port default 8138, or REVVIEW_PORT)
//   --look-config file: the bar's look (day | night | auto with night hours; default config/look.json); a bad file logs and uses day
//   --lights-config file: the LEDs (one per session; config/lights.json); without it there is no lights feature; a bad or missing file exits 2
//   --boot: key-on start: show STARTING until the first session is on the board; with no tmux windows, start one session in $REVVIEW_START (or each --start dir)
//   --data-lock [dir]: the data is locked until the topmost mount on dir (default /srv/revview-data, or $REVVIEW_DATA_MOUNT) is ext4 from /dev/mapper/revview-data;
//     locked shows INSERT KEY, no session starts (key-on and New session wait); a posted RevviewDataLock is only a poke to re-read the mount table
//   --netmon: watch the network (default route + TCP connect to $REVVIEW_NETMON_HOST, default api.anthropic.com:443); offline after 2 failures, online after 1 success; a posted RevviewNetwork is only a poke to probe again
//   --thermal: watch temperature and the Pi throttle flags: HOT and LOW POWER marks (sources: $REVVIEW_THERMAL_TEMP file, default /sys/class/thermal/thermal_zone0/temp;
//     `vcgencmd get_throttled`, command path $REVVIEW_THERMAL_VCGENCMD, or a file $REVVIEW_THERMAL_THROTTLED instead of the command); a missing source is logged once
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './cli.js';

export { DEFAULT_PORT, DEFAULT_HOST, startLiveServer } from './live.js';
export { COMPACT_LIMIT_MS } from './lifecycle.js';
export { MAX_BODY_BYTES } from './routes-event.js';
export { MAX_SSE_CLIENTS, MAX_CLIENT_BACKLOG_BYTES } from './feed.js';
export { MAX_DEMO_CLIENTS, DEMO_CODES } from './routes-dev.js';
export { parseArgs } from './cli.js';
export { bootSessions, bootAfterUnlock, netmonTarget, installShutdown } from './boot.js';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
