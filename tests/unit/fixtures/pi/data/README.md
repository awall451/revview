`lsblk.json` and `mounts` are WRITTEN FROM MEMORY (the shape of `lsblk -J -b -o NAME,PATH,TYPE,FSTYPE,UUID,LABEL,SIZE,MOUNTPOINTS,TRAN,RM`
and of /proc/mounts), not copied from a real Pi: an SD card (mmcblk0, p3 an empty partition for the data) and a USB stick
(sda1, vfat, UUID 1234-ABCD). Replace them with real output when a Pi is at hand.
