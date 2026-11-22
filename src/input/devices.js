// Parse /proc/bus/input/devices and pick the event node of a configured device.

const hex = (s) => (s || '').toLowerCase();

// Decode a `B: KEY=` bitmap: hex words separated by spaces, most significant word printed first.
// Each word is one kernel `unsigned long`, assumed 64 bits (64-bit kernel; the Pi target is arm64).
// Bit n lives in word floor(n / 64) counted from the last printed word.
export function parseKeyBitmap(text) {
  const keys = new Set();
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  words.forEach((w, i) => {
    if (!/^[0-9a-fA-F]+$/.test(w)) return;
    const base = (words.length - 1 - i) * 64;
    let v = BigInt(`0x${w}`);
    for (let bit = 0; v; bit++, v >>= 1n) if (v & 1n) keys.add(base + bit);
  });
  return keys;
}

export function parseProcDevices(text) {
  const out = [];
  if (typeof text !== 'string') return out;
  for (const block of text.split(/\r?\n\s*\r?\n/)) {
    const d = { bus: '', vendor: '', product: '', name: '', phys: '', handlers: [], event: null, keys: new Set() };
    let any = false;
    for (const line of block.split(/\r?\n/)) {
      const m = /^([INPHB]): (.*)$/.exec(line);
      if (!m) continue;
      const [, tag, rest] = m;
      if (tag === 'I') {
        const f = (k) => hex(new RegExp(`\\b${k}=([0-9a-fA-F]+)`).exec(rest)?.[1]);
        d.bus = f('Bus');
        d.vendor = f('Vendor');
        d.product = f('Product');
        any = true;
      } else if (tag === 'N') {
        d.name = /^Name="(.*)"\s*$/.exec(rest)?.[1] ?? '';
      } else if (tag === 'P') {
        d.phys = /^Phys=(.*)$/.exec(rest)?.[1] ?? '';
      } else if (tag === 'B') {
        const k = /^KEY=(.*)$/.exec(rest);
        if (k) d.keys = parseKeyBitmap(k[1]);
      } else if (tag === 'H') {
        d.handlers = (/^Handlers=(.*)$/.exec(rest)?.[1] ?? '').split(/\s+/).filter(Boolean);
        d.event = d.handlers.find((h) => /^event\d+$/.test(h)) ?? null;
      }
    }
    if (any) out.push(d);
  }
  return out;
}

// First `kbd` event node whose non-null fields match. With no criteria at all there is no match (that
// would pick any keyboard, including the console's). A non-empty `keys` list also requires the node to
// support at least one of those key codes; a node with no KEY line supports none.
export function matchDevice(list, { name = null, vendor = null, product = null } = {}, keys = []) {
  if (name === null && vendor === null && product === null) return null;
  for (const d of list) {
    if (!d.event || !d.handlers.includes('kbd')) continue;
    if (name !== null && d.name !== name) continue;
    if (vendor !== null && d.vendor !== hex(vendor)) continue;
    if (product !== null && d.product !== hex(product)) continue;
    if (keys.length && !keys.some((c) => d.keys.has(c))) continue;
    return `/dev/input/${d.event}`;
  }
  return null;
}
