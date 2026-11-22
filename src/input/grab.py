"""Exclusive-grab an evdev node and copy its raw input_event bytes to stdout.

Usage: python3 grab.py <device path> [parent pid]
Exit: 0 quiet stop (signal, closed pipe), 1 device read error or EOF, 2 grab failed, 3 open failed.
Standard library only. Node core cannot call ioctl, so this is the whole helper.
"""
import errno
import fcntl
import os
import select
import signal
import sys

# EVIOCGRAB = _IOW('E', 0x90, int) = 0x40044590; the same number on arm64 and x86-64.
EVIOCGRAB = 0x40044590
CHUNK = 24 * 64


def main():
    path = sys.argv[1]
    # The server passes its own pid: if it died before this ran, getppid() is already 1 (or a subreaper),
    # so compare against the given pid, not against whatever getppid() returns at startup.
    ppid = int(sys.argv[2]) if len(sys.argv) > 2 else os.getppid()
    signal.signal(signal.SIGTERM, lambda *_: os._exit(0))
    signal.signal(signal.SIGINT, lambda *_: os._exit(0))
    try:
        fd = os.open(path, os.O_RDONLY)
    except OSError as e:
        sys.stderr.write("revview-grab: cannot open %s: %s\n" % (path, e.strerror))
        return 3
    try:
        fcntl.ioctl(fd, EVIOCGRAB, 1)
    except OSError as e:
        sys.stderr.write("revview-grab: cannot grab %s: %s\n" % (path, e.strerror))
        return 2
    sys.stderr.write("revview-grab: ok\n")
    sys.stderr.flush()
    out = sys.stdout.buffer
    # The kernel releases the grab when the fd closes, so no explicit release is needed.
    while True:
        try:
            # Wake every second to notice that the parent (the server) died, e.g. kill -9: exit, which
            # closes the fd and releases the grab.
            if not select.select([fd], [], [], 1.0)[0]:
                if os.getppid() != ppid:
                    return 0
                continue
            data = os.read(fd, CHUNK)
        except OSError as e:  # ENODEV when unplugged
            sys.stderr.write("revview-grab: read %s: %s\n" % (path, e.strerror))
            return 1
        if not data:
            sys.stderr.write("revview-grab: eof on %s\n" % path)
            return 1
        try:
            out.write(data)
            out.flush()
        except OSError as e:
            if e.errno == errno.EPIPE:
                return 0
            raise


if __name__ == "__main__":
    try:
        code = main()
    except BrokenPipeError:
        code = 0
    # Skip interpreter shutdown flush on a broken stdout pipe.
    os._exit(code)
