# If the Pi or the key stick is lost or stolen

Written without a Pi. Nothing here was run. Menu names, file names and cryptsetup commands are *(from memory)*:
check them as you go. Set-up of the encrypted data: `pi/README.md`. Decisions: `docs/DECISIONS.md` "stage 4B".

## What lives where

| Thing | Where | Notes |
|---|---|---|
| Claude sign-in | `~/.claude/.credentials.json` on the encrypted data partition | *(file name from memory)* |
| Push credentials | `~/.ssh` on the encrypted partition: deploy keys, or a fine-grained token in a file there | |
| Repositories | `~/repos` on the encrypted partition | |
| The key file | on the key stick, `revview/data.key` | Never on the Pi's root. |
| The recovery passphrase | with the owner, on paper | Opens the data without the stick. Keep it apart from both. |

Not encrypted: the kiosk settings (`~/.config/labwc`, `~/.config/revview`), the program in `/opt/revview`,
`/etc/revview`. They hold no secrets.

## (a) The Pi was stolen WITH the stick, or while it was running

Assume everything on the data partition can be read. Do all of this, quickly.

1. Revoke the Claude sign-in: in claude.ai, settings, sign out of all sessions and devices *(from memory: the
   exact menu names may differ)*. If in doubt, change the claude.ai password too.
2. Delete each deploy key on each repository: GitHub, the repository, Settings, Deploy keys *(menu names from
   memory)*. If you used a fine-grained token instead: GitHub, Settings, Developer settings, Personal access tokens,
   revoke it.
3. Look at each repository's recent pushes and branches for anything you did not do.
4. Make new credentials only on a Pi you trust, and put them in `~/.ssh` there.

## (b) The Pi was stolen WITHOUT the stick, and was powered off

The data is encrypted and the key is not with it. Still do (a) to be safe: it costs little. A Pi that was
running when taken counts as case (a): pulling the stick does not lock a running Pi, the data stays open until
power-off.

## (c) The stick is lost, the Pi is still here

1. Find the data partition (`lsblk`; call it `/dev/X`). Show the key slots: `sudo cryptsetup luksDump /dev/X`
   *(from memory)*. The recovery passphrase is in one slot and the stick's key file in another. Work out which is
   which before you remove anything: the set-up made the key file's slot with PBKDF `pbkdf2` and the passphrase's
   slot with cryptsetup's default (`argon2id`), and `luksDump` shows the PBKDF of each slot *(from memory)*.
2. Remove the lost stick's slot: `sudo cryptsetup luksKillSlot /dev/X N` (N is the slot number). It asks for a
   passphrase of a remaining slot: use the recovery passphrase. *(from memory)*
3. Make a new stick by hand. `pi/data-setup.sh` without `--format` only rewrites the configuration; it does not
   make a key. Plug in the new stick (FAT or exFAT), and mount it so that only root can read it: `sudo mount -o uid=0,gid=0,umask=077
   /dev/NEWSTICK /mnt` *(from memory)*. A plain mount makes the files on a FAT stick readable by every user, and
   `chmod` does nothing on FAT. Then:

   ```
   sudo mkdir -p /mnt/revview
   head -c 4096 /dev/urandom | sudo tee /mnt/revview/data.key > /dev/null
   sudo cryptsetup luksAddKey /dev/X /mnt/revview/data.key
   ```

   `luksAddKey` asks for the recovery passphrase. *(from memory)* Unmount the stick (`sudo umount /mnt`).
   While the data is locked, SSH login with a key does not work (`~/.ssh` is on the encrypted partition): use the
   Pi's own keyboard or a password login for step 4.
4. Record the new stick's UUID. `data-setup.sh` refuses while the read-only root is on and while the data is open,
   so: `sudo bash pi/readonly.sh disable` (both rounds, see `pi/README.md` "Updating"), boot WITHOUT any stick in
   (the data stays locked), then `sudo bash pi/data-setup.sh --user NAME --device /dev/X --key-device /dev/NEWSTICK`
   (no `--format`; add `--dry-run` first). Then `sudo bash pi/readonly.sh enable` and reboot with the new stick in.
5. If whoever found the old stick could also reach the Pi, do (a) as well. Until step 2 the old stick still opens
   the data.

## (d) The stick is lost and there is no recovery passphrase

The data is gone. Run the set-up again with `--format` (it erases the partition), make a new stick, sign in to
Claude Code again, make new push credentials, and clone the repositories again. Do (a) as well if the Pi may also
be in someone else's hands.

## Why deleting the old copies from the SD card is not enough

Flash storage keeps old data. Deleting a file does not erase it, and the card's wear levelling may keep copies
anywhere. A sign-in or key made BEFORE the data set-up lived unencrypted on the card, and the set-up's copy-then-
delete does not remove it for sure. So after the first set-up: sign in to Claude Code again, and replace every
key and token that was made before it (revoke the old ones as in (a), steps 1 and 2).

## Use the least access

Prefer small credentials, so that a stolen Pi costs little (DESIGN): one deploy key per repository, with write
access only where the Pi really has to push. A fine-grained token limited to one repository is the next best
thing. Never put a token that reaches all your repositories on the Pi.
