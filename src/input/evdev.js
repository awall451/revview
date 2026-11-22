// Linux `struct input_event` parser.
// 64-bit Linux (aarch64, x86-64): struct timeval { long sec; long usec } (8+8), u16 type, u16 code, s32 value
// = 24 bytes, little-endian. 32-bit userspace (armhf) has 4+4 byte time = 16 bytes.

export const EVENT_SIZE = 24;
export const EVENT_SIZE_32 = 16;
export const EV_SYN = 0;
export const EV_KEY = 1;
export const EV_MSC = 4;
export const SYN_REPORT = 0;
export const SYN_DROPPED = 3;

function decode(b, o, size) {
  const wide = size === EVENT_SIZE;
  const tw = wide ? 8 : 4;
  return {
    sec: wide ? Number(b.readBigInt64LE(o)) : b.readInt32LE(o),
    usec: wide ? Number(b.readBigInt64LE(o + 8)) : b.readInt32LE(o + 4),
    type: b.readUInt16LE(o + 2 * tw),
    code: b.readUInt16LE(o + 2 * tw + 2),
    value: b.readInt32LE(o + 2 * tw + 4),
  };
}

export function createEventParser({ size = EVENT_SIZE } = {}) {
  let rest = Buffer.alloc(0);
  return {
    push(buffer) {
      rest = rest.length ? Buffer.concat([rest, buffer]) : buffer;
      const out = [];
      let o = 0;
      for (; o + size <= rest.length; o += size) out.push(decode(rest, o, size));
      rest = Buffer.from(rest.subarray(o)); // copy: the caller may reuse its chunk
      return out;
    },
  };
}

export function encodeEvent({ sec = 0, usec = 0, type, code, value }, size = EVENT_SIZE) {
  const b = Buffer.alloc(size);
  let o;
  if (size === EVENT_SIZE) {
    b.writeBigInt64LE(BigInt(sec), 0);
    b.writeBigInt64LE(BigInt(usec), 8);
    o = 16;
  } else {
    b.writeInt32LE(sec, 0);
    b.writeInt32LE(usec, 4);
    o = 8;
  }
  b.writeUInt16LE(type, o);
  b.writeUInt16LE(code, o + 2);
  b.writeInt32LE(value, o + 4);
  return b;
}
