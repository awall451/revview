---
status: closed (2026-11-23, work/qa6-fixes: see DECISIONS "QA round 6b"; cryptsetup details from memory, a spare-card bench item S4B-19 added; not yet re-run by QA)
id: qa-20261122-r6b-04
title: REVOKE.md (c) adds the new stick's key with cryptsetup's defaults, so the PBKDF rule it gives for telling slots apart no longer holds after one stick loss
severity: minor
area: docs/REVOKE.md section (c), pi/data-setup.sh (luksFormat --pbkdf pbkdf2 --iter-time 500)
how to reproduce: read docs/REVOKE.md (c) steps 1 and 3 next to `pi/data-setup.sh --dry-run --format` output (fake root, stub lsblk/cryptsetup)
evidence: REVOKE.md (c) step 1: "the set-up made the key file's slot with PBKDF `pbkdf2` and the passphrase's slot with cryptsetup's default (`argon2id`)"; step 3: `sudo cryptsetup luksAddKey /dev/X /mnt/revview/data.key` (no --pbkdf); data-setup dry run prints `cryptsetup luksFormat ... --pbkdf pbkdf2 --iter-time 500 --key-file ...`
---

## Seen

Step 3 adds the replacement key file with plain `luksAddKey`, i.e. with cryptsetup's default PBKDF. After that both
remaining slots (recovery passphrase and new key file) use the default, so the next time a stick is lost, step 1's
"work out which is which by the PBKDF" does not work. The new key-file slot also differs from what data-setup.sh
chose for the key file (pbkdf2, 500 ms), for a reason DECISIONS gives for the Pi's unlock time; with the default, the
boot unlock with the new stick may be slower or use more memory than the one data-setup made (from memory, not
measured; not in BENCH).

## Expected

Step 3 uses the same options as data-setup.sh (`--pbkdf pbkdf2 --iter-time 500`, from memory as the rest), or step 1
tells the owner another way to identify slots (e.g. write down the slot numbers data-setup.sh created; `luksDump`
before and after `luksAddKey`). A BENCH item for REVOKE (c) on a spare card would show whether the unlock still works
with the new stick.
