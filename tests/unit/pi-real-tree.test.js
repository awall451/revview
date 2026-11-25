// Checks the pi/ scripts against names read from the REAL Raspberry Pi OS Trixie arm64 packages.
// Reads only tests/unit/fixtures/pi/real-tree/facts.txt (made by pi/tree/check.sh --write-facts): no network, no tree.
// When one of these fails, read the message: it says which name is missing and how to fix or regenerate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const FACTS_FILE = 'tests/unit/fixtures/pi/real-tree/facts.txt';
const REBUILD = `rebuild the tree (bash pi/tree/build.sh /tmp/pitree), run bash pi/tree/check.sh /tmp/pitree --write-facts ${FACTS_FILE}`;

const facts = read(FACTS_FILE).split('\n');
const lines = (kind) => facts.filter((l) => l.startsWith(`${kind} `)).map((l) => l.slice(kind.length + 1));
const paths = new Set(lines('path'));
const switches = new Set(lines('chromium-switch'));
const fns = new Set(lines('raspi-config-fn'));
const units = new Set(lines('unit')); // "system NAME" | "user NAME"
const seds = lines('raspi-config-sed'); // "FUNCTION EXPRESSION"

// Strip comment-only lines so words in prose are not read as code.
const code = (text) => text.split('\n').filter((l) => !/^\s*(#|\/\/|\*|\/\*)/.test(l)).join('\n');

test('(a) every switch kiosk.sh passes is a string in the real chromium binary', () => {
  const sh = read('pi/kiosk.sh');
  const body = /flags=\(\n([\s\S]*?)\n\)/.exec(sh);
  assert.ok(body, 'pi/kiosk.sh has no flags=( ... ) array: this test parses it, update the parser in tests/unit/pi-real-tree.test.js');
  const flags = body[1].split('\n').map((l) => l.trim().replace(/^"|"$/g, '')).filter((l) => l.startsWith('--'));
  assert.ok(flags.length >= 5, `parsed only ${flags.length} flags from pi/kiosk.sh: check the parser`);
  for (const f of flags) {
    const name = f.slice(2).split('=')[0];
    assert.ok(switches.has(name), `kiosk.sh passes --${name} but the real chromium binary has no such switch string; ${REBUILD} (it prints DIFF), then fix the flag in pi/kiosk.sh`);
  }
});

test('(b) every unit named in a dependency key of pi/*.service exists, as the right kind of unit', () => {
  const keys = /^(After|Before|Wants|Requires|WantedBy|RequiredBy|PartOf|BindsTo|Conflicts)=(.*)$/;
  let n = 0;
  for (const f of fs.readdirSync(path.join(ROOT, 'pi')).filter((x) => x.endsWith('.service'))) {
    let kind = null;
    if (f === 'revview.service') kind = 'user';
    else if (f.startsWith('revview-unlock')) kind = 'system';
    assert.ok(kind, `pi/${f} is a new unit: say in tests/unit/pi-real-tree.test.js whether it is a user or a system unit`);
    for (const l of read(`pi/${f}`).split('\n')) {
      const m = keys.exec(l);
      if (!m) continue;
      for (const name of m[2].trim().split(/\s+/).filter(Boolean)) {
        n++;
        assert.ok(units.has(`${kind} ${name}`), `pi/${f} has ${m[1]}=${name} but the real packages have no ${kind} unit ${name}; ${REBUILD}, then fix the unit name (a ${kind} unit lives in usr/lib/systemd/${kind})`);
      }
    }
  }
  assert.ok(n >= 2, 'no dependency keys found in pi/*.service: check the parser');
});

test('(c) every raspi-config function readonly.sh runs exists in the real raspi-config', () => {
  const sh = code(read('pi/readonly.sh'));
  const names = [...sh.matchAll(/\brun_rc\s+([a-z_]+)/g)].map((m) => m[1]);
  assert.ok(names.length >= 3, `found only ${names.length} run_rc calls in pi/readonly.sh: check the parser`);
  for (const n of names) {
    assert.ok(fns.has(n), `pi/readonly.sh runs raspi-config nonint ${n} but the real raspi-config has no function ${n}(); ${REBUILD}, then fix the name in pi/readonly.sh`);
  }
});

// Directories no package ships, with the reason (made by install or at run time, not by a package).
const NOT_FROM_A_PACKAGE = new Map([
  ['/etc/revview', 'revview own directory: pi/setup.mjs and pi/data.mjs create it'],
  ['/var/lib/revview', 'revview own directory: pi/setup.mjs records the shipped key map there'],
  ['/var/lib/systemd/linger', 'logind makes it; pi/setup.mjs writes the file loginctl enable-linger would write'],
  ['/etc/systemd/user/default.target.wants', 'the enable link of a user unit: systemctl --user enable would create it'],
  ['/etc/systemd/system/multi-user.target.wants', 'the enable link of a system unit: systemctl enable would create it'],
  ['/boot/firmware', 'the FAT boot partition of the image: made by the image builder, no package ships it'],
  ['/srv', 'the data partition mount point (/srv/revview-data): made by pi/data-setup.sh'],
]);

test('(d) the directories pi/setup.mjs and pi/data.mjs write into exist in the real packages (or are listed as not from a package)', () => {
  const dests = new Set();
  for (const f of ['pi/setup.mjs', 'pi/data.mjs']) {
    for (const m of code(read(f)).matchAll(/['"`](\/(?:etc|var|boot|srv|usr)\/[A-Za-z0-9._@/-]+)['"`]/g)) dests.add(m[1]);
  }
  assert.ok(dests.size >= 10, `found only ${dests.size} absolute paths in pi/setup.mjs and pi/data.mjs: check the parser`);
  for (const d of dests) {
    const parent = path.posix.dirname(d);
    if ([...NOT_FROM_A_PACKAGE.keys()].some((p) => parent === p || parent.startsWith(`${p}/`))) continue;
    assert.ok(paths.has(parent), `pi/ writes ${d} but ${parent} is not in the real packages; ${REBUILD}; if the directory is made at run time, add it to NOT_FROM_A_PACKAGE in tests/unit/pi-real-tree.test.js with the reason`);
  }
  for (const p of NOT_FROM_A_PACKAGE.keys()) {
    assert.ok(!paths.has(p), `${p} is now shipped by a package (it is in the fixture): remove it from NOT_FROM_A_PACKAGE in tests/unit/pi-real-tree.test.js`);
  }
});

test('(e) the raspi-config stub in pi-readonly.test.js uses the real sed expressions', () => {
  const t = read('tests/unit/pi-readonly.test.js');
  // The stub is JS source: unescape the string escapes (\\ -> \) before comparing.
  const stub = new Set([...t.matchAll(/-e\s+(["'])(.*?)\1/g)].map((m) => m[2].replace(/\\\\/g, '\\')));
  assert.equal(seds.length, 4, `the fixture should hold four raspi-config-sed lines (enable/disable_overlayfs, enable/disable_bootro); ${REBUILD}`);
  for (const l of seds) {
    const i = l.indexOf(' ');
    const [fn, expr] = [l.slice(0, i), l.slice(i + 1)];
    assert.ok(stub.has(expr), `the stub in tests/unit/pi-readonly.test.js has no sed "${expr}" (the real one of raspi-config ${fn}); copy it from the real raspi-config so the stub does what the Pi does`);
  }
});

test('(f) the fixture header names a date and every package', () => {
  const head = facts.filter((l) => l.startsWith('#'));
  assert.match(head[0], /^# Extracted by pi\/tree\/check\.sh from the real Raspberry Pi OS Trixie arm64 packages on \d{4}-\d{2}-\d{2}$/, `the first line of ${FACTS_FILE} must name the date; ${REBUILD}`);
  const pkgs = head.filter((l) => l.startsWith('# package '));
  for (const l of pkgs) assert.match(l, /^# package [dr] \S+ \S+$/, `bad package line "${l}" in ${FACTS_FILE}`);
  const wanted = read('pi/tree/packages.list').split('\n').filter((l) => /^[a-z0-9]/.test(l)).map((l) => l.split(/\s+/)[0]);
  assert.ok(wanted.length >= 30, `parsed only ${wanted.length} names from pi/tree/packages.list: check the parser`);
  const have = new Set(pkgs.map((l) => l.split(' ')[3]));
  for (const n of wanted) assert.ok(have.has(n), `${n} is in pi/tree/packages.list but not in the fixture header; ${REBUILD}`);
});
