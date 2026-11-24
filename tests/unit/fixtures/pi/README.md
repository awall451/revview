# Pi fixtures

`lightdm.conf` is an EXCERPT mirroring the layout of `/etc/lightdm/lightdm.conf` from lightdm
1.32.0-6+rpt2+deb13u1 (Raspberry Pi archive: every [Seat:*] key commented out, in that order), plus the in-place
edits raspi-config 20261026+2 `do_wayland` W2 makes (`greeter-session=pi-greeter-labwc`, `user-session=rpd-labwc`,
`autologin-session=rpd-labwc`). `display-setup-script=/usr/share/dispsetup.sh` is still FROM MEMORY (no archive
package ships that file; it comes from the image builder). `#autologin-user=` stays commented, as raspi-config's
`do_boot_behaviour B4` sed expects.

`cmdline.txt` and `config.txt` are stock-looking Raspberry Pi OS (Trixie) files WRITTEN FROM MEMORY, not copied
from a real Pi. `cmdline.txt` cannot hold a comment (it is one line of kernel arguments), so this note is the only
marker. The PARTUUID is made up. Replace them with real files when a Pi is at hand.
