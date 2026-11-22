// The file writer shared by pi/setup.mjs and pi/data.mjs: atomic writes, backups, ownership, symlink refusal,
// dry-run. UNTESTED on a Pi; tested against a fake root (tests/unit/pi-setup.test.js, pi-data.test.js).
// createWriter({ dry, owner, homeAbs, say, tag, ownMark }) -> { write, link, mkdirp, refuse, isLink, readOr, failed }
//   owner    { uid, gid } or undefined: applied to what is written with { owned: true } and lies inside homeAbs
//   tag      prefix of the message on stderr for a refusal (default "revview setup")
//   ownMark  text that marks a file as written by us (backup: 'foreign' keeps a copy of files without it)
// A refusal (a symlink where a file is written) leaves the file alone, says "skipped", and makes failed() true.
import fs from 'node:fs';
import path from 'node:path';

export function createWriter({ dry = false, owner, homeAbs = '', say = (s) => console.log(s), tag = 'revview setup', ownMark = '' } = {}) {
  let failed = false;
  const readOr = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
  const refuse = (p, why) => {
    failed = true;
    say(`skipped ${p}: ${why}`);
    process.stderr.write(`${tag}: ${p}: ${why}\n`);
  };
  const isLink = (p) => {
    try {
      return fs.lstatSync(p).isSymbolicLink();
    } catch {
      return false;
    }
  };
  const chownIf = (p, owned) => {
    if (owned && owner) fs.chownSync(p, owner.uid, owner.gid);
  };
  // Creates d and the missing parents; `mode` (optional) is set on d itself when d is created here.
  const mkdirp = (d, owned, mode) => {
    const todo = [];
    for (let p = d; !fs.existsSync(p); p = path.dirname(p)) todo.unshift(p);
    for (const p of todo) {
      fs.mkdirSync(p);
      if (mode !== undefined && p === d) fs.chmodSync(p, mode);
      chownIf(p, owned && homeAbs !== '' && (p === homeAbs || p.startsWith(`${homeAbs}${path.sep}`)));
    }
  };

  // Temp file in the same directory, fsync, rename: a power cut leaves the old or the new file, never half of one
  // (like hooks/install.mjs). On the FAT partition /boot/firmware rename is not guaranteed atomic by FAT itself,
  // but it is still the best that is available there.
  const atomicWrite = (p, content, mode, owned) => {
    const tmp = path.join(path.dirname(p), `.${path.basename(p)}.revview-tmp-${process.pid}`);
    fs.rmSync(tmp, { force: true });
    const fd = fs.openSync(tmp, 'wx', mode);
    try {
      fs.writeSync(fd, content);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.chmodSync(tmp, mode);
      chownIf(tmp, owned);
      fs.renameSync(tmp, p);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
  };

  // write(p, content, { owned, backup: 'first' | 'foreign', createOnly, mode })
  const write = (p, content, opts = {}) => {
    if (isLink(p)) return refuse(p, 'is a symlink; not written through (replace it with a regular file or remove it)');
    const old = readOr(p);
    if (old !== null && opts.createOnly) return say(`unchanged ${p}`); // exists: never overwritten
    if (old === content) return say(`unchanged ${p}`);
    if (dry) return say(`would write ${p}`);
    mkdirp(path.dirname(p), opts.owned);
    const bak = `${p}.revview-backup`;
    const wantBackup = old !== null && !fs.existsSync(bak) && !isLink(bak)
      && (opts.backup === 'first' || (opts.backup === 'foreign' && !(ownMark && old.includes(ownMark))));
    const mode = opts.mode ?? (old !== null ? fs.statSync(p).mode & 0o777 : 0o644);
    if (wantBackup) {
      atomicWrite(bak, old, mode, opts.owned);
      say(`backup ${p} -> ${bak}`);
    }
    atomicWrite(p, content, mode, opts.owned);
    say(`wrote ${p}`);
  };

  // link(p, target): a symlink at p pointing to target (an enable symlink). A wrong one is replaced.
  const link = (p, target) => {
    let cur = null;
    try {
      cur = fs.readlinkSync(p);
    } catch { /* missing or not a link */ }
    if (cur === target) say(`unchanged ${p}`);
    else if (dry) say(`would write ${p}`);
    else {
      mkdirp(path.dirname(p), false);
      fs.rmSync(p, { force: true });
      fs.symlinkSync(target, p);
      say(`wrote ${p}`);
    }
  };

  return { write, link, mkdirp, refuse, isLink, readOr, failed: () => failed };
}
