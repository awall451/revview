# real-tree facts

`facts.txt` lists NAMES that exist in the real Raspberry Pi OS Trixie arm64 packages (paths, commands, systemd
unit names, Chromium switch names, raspi-config function names and the sed expressions inside them). It holds
names only, no file contents and no behaviour. The header lists every package (archive, name, version) the
names were read from and the UTC date it was made.

It was made by `pi/tree/check.sh` from a tree that `pi/tree/build.sh` unpacked (nothing installed, nothing run):

    bash pi/tree/build.sh /tmp/pitree
    bash pi/tree/check.sh /tmp/pitree --write-facts tests/unit/fixtures/pi/real-tree/facts.txt

`tests/unit/pi-real-tree.test.js` reads only this file (no network, no tree), so the gate can check on every run
that the pi/ scripts still use names the real packages have. When a test fails because pi/ now uses a new name,
rebuild the tree, run `pi/tree/check.sh` (it says which name is missing), fix pi/ or the script, and
regenerate this file. Lines: `path /x/y`, `cmd NAME /path`, `unit system|user NAME`, `chromium-switch NAME`,
`raspi-config-fn NAME`, `raspi-config-sed FUNCTION EXPRESSION`.
