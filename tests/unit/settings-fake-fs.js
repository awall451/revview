// An in-memory stand-in for the few node:fs functions src/server/settings.js uses (see its header).
// f.files: path -> text; f.calls: 'op path' in call order; f.failOn: { read|mkdir|open|write|fsync|rename: 'EROFS' } makes that op throw.
export function fakeFs(files = {}) {
  const f = { files: new Map(Object.entries(files)), dirs: new Set(), calls: [], failOn: {}, fds: new Map(), nextFd: 10 };
  const fail = (op, p) => {
    f.calls.push(`${op} ${p}`);
    if (f.failOn[op]) throw Object.assign(new Error(`${f.failOn[op]}: ${op} ${p}`), { code: f.failOn[op] });
  };
  f.readFileSync = (p) => {
    fail('read', p);
    if (!f.files.has(p)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    return f.files.get(p);
  };
  f.mkdirSync = (p) => { fail('mkdir', p); f.dirs.add(p); };
  f.openSync = (p) => { fail('open', p); const fd = f.nextFd++; f.fds.set(fd, { path: p, buf: '' }); return fd; };
  f.writeSync = (fd, data) => { const o = f.fds.get(fd); fail('write', o.path); o.buf += String(data); return Buffer.byteLength(String(data)); };
  f.fsyncSync = (fd) => fail('fsync', f.fds.get(fd).path);
  f.closeSync = (fd) => {
    const o = f.fds.get(fd);
    f.calls.push(`close ${o.path}`);
    if (o.buf !== '') f.files.set(o.path, o.buf);
    f.fds.delete(fd);
  };
  f.renameSync = (a, b) => { fail('rename', `${a} ${b}`); f.files.set(b, f.files.get(a)); f.files.delete(a); };
  return f;
}
