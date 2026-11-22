// Data lock monitor: the data partition is "unlocked" when the topmost mount on the data directory is ext4 from
// /dev/mapper/revview-data, as the kernel's mount table says. Node built-ins only; no shell.
import fs from 'node:fs';

export const DEFAULT_DATA_MOUNT = '/srv/revview-data';
export const DEFAULT_DATA_SOURCE = '/dev/mapper/revview-data';
export const DEFAULT_DATA_FSTYPE = 'ext4';

const unescapeOctal = (s) => s.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));

// /proc/self/mountinfo: id parent maj:min root mountpoint options [optional...] - fstype source superoptions
export function parseMountinfo(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const f = line.trim().split(/ +/);
    if (f.length < 10) continue;
    const dash = f.indexOf('-', 6);
    if (dash < 0 || f.length < dash + 3) continue;
    out.push({ mountPoint: unescapeOctal(f[4]), fstype: f[dash + 1], source: unescapeOctal(f[dash + 2]) });
  }
  return out;
}

export function isDataMounted(text, { mountPoint, source = DEFAULT_DATA_SOURCE, fstype = DEFAULT_DATA_FSTYPE }) {
  const hits = parseMountinfo(text).filter((m) => m.mountPoint === mountPoint);
  if (hits.length === 0) return false;
  const top = hits[hits.length - 1];
  return top.source === source && top.fstype === fstype;
}

export function createDataLockMonitor({
  mountPoint, read = () => fs.readFileSync('/proc/self/mountinfo', 'utf8'), pollMs = 3000, onChange, log = () => {},
  setInterval: setIv = setInterval, clearInterval: clearIv = clearInterval,
} = {}) {
  let last = null;
  let failing = false;
  let stopped = false;
  function check() {
    let locked;
    try {
      locked = !isDataMounted(String(read()), { mountPoint });
      failing = false;
    } catch (e) {
      locked = true;
      if (!failing) log(`data lock: cannot read the mount table (${e instanceof Error ? e.message : String(e)}); treated as locked`);
      failing = true;
    }
    if (locked !== last) {
      last = locked;
      try { onChange?.(locked); } catch (e) { log(`data lock: onChange failed: ${e instanceof Error ? e.message : String(e)}`); }
    }
    return locked;
  }
  const timer = setIv(() => { if (!stopped) check(); }, pollMs);
  timer?.unref?.();
  return {
    check,
    locked: () => last,
    stop: () => { stopped = true; clearIv(timer); },
  };
}
