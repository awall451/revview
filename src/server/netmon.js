// Network monitor: "online" = a default route on any interface plus a TCP connect to the Claude API host.
// The phone hotspot over Wi-Fi drops in tunnels, so nothing here depends on Ethernet. Node built-ins only.
import fs from 'node:fs';
import net from 'node:net';

const ZERO6 = '0'.repeat(32);

// /proc/net/route: Iface Destination Gateway Flags ...; a default route has Destination 00000000 and RTF_UP (0x1).
// /proc/net/ipv6_route: dest(32) prefixlen(2) src(32) srcprefixlen(2) nexthop(32) metric refcnt use flags iface.
export function hasDefaultRoute(route4Text, route6Text) {
  for (const line of String(route4Text ?? '').split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 4 || f[1] !== '00000000') continue;
    const flags = parseInt(f[3], 16);
    if (Number.isFinite(flags) && (flags & 1) === 1) return true;
  }
  for (const line of String(route6Text ?? '').split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10 || f[0] !== ZERO6 || f[1] !== '00') continue;
    if (f[f.length - 1] !== 'lo') return true;
  }
  return false;
}

export function createDefaultProbe({
  readFile = fs.promises.readFile, connect = net.connect, host = 'api.anthropic.com', port = 443, timeoutMs = 3000,
  routeFiles = ['/proc/net/route', '/proc/net/ipv6_route'],
} = {}) {
  const read = async (file) => {
    try {
      return String(await readFile(file, 'utf8'));
    } catch {
      return '';
    }
  };
  return async () => {
    try {
      const [r4, r6] = await Promise.all(routeFiles.map(read));
      if (!hasDefaultRoute(r4, r6)) return false;
      return await new Promise((resolve) => {
        let socket = null;
        let timer = null;
        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try { socket?.destroy(); } catch { /* already gone */ }
          resolve(ok);
        };
        timer = setTimeout(() => finish(false), timeoutMs);
        try {
          socket = connect({ host, port });
          socket.once('connect', () => finish(true));
          socket.once('error', () => finish(false));
          socket.once('close', () => finish(false));
        } catch {
          finish(false);
        }
      });
    } catch {
      return false;
    }
  };
}

export function createNetMonitor({
  probe, onChange, timers = { setTimeout, clearTimeout }, onlineIntervalMs = 10000, offlineIntervalMs = 5000,
  failuresToOffline = 2, log = () => {},
} = {}) {
  let stopped = false;
  let timer = null;
  let reported = null; // null = unknown
  let failures = 0;

  const report = (online) => {
    if (reported === online) return;
    reported = online;
    try {
      onChange(online);
    } catch (e) {
      log(`netmon: onChange failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  async function tick() {
    timer = null;
    let ok = false;
    try {
      ok = (await probe()) === true;
    } catch (e) {
      log(`netmon: probe failed: ${e instanceof Error ? e.message : e}`);
    }
    if (stopped) return;
    if (ok) {
      failures = 0;
      report(true);
    } else {
      failures += 1;
      if (failures >= failuresToOffline) report(false);
    }
    timer = timers.setTimeout(tick, reported === false ? offlineIntervalMs : onlineIntervalMs);
  }

  tick();
  return {
    stop() {
      stopped = true;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
  };
}
