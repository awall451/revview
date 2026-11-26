#!/usr/bin/env python3
# Feeds WS2812B frames to SPI. UNTESTED ON HARDWARE (only compiled in the tests).
# stdin: one line per frame, lowercase hex of the SPI bytes. On EOF / SIGTERM / SIGINT: dark frame, exit 0.
# exit 3: no spidev module; exit 4: cannot open the device.
import argparse
import re
import signal
import sys

ap = argparse.ArgumentParser()
ap.add_argument('--device', required=True)
ap.add_argument('--leds', type=int, required=True)
ap.add_argument('--hz', type=int, default=2400000)
args = ap.parse_args()

try:
    import spidev
except ImportError:
    sys.stderr.write('no spidev module (install python3-spidev)\n')
    sys.exit(3)

m = re.match(r'^/dev/spidev(\d+)\.(\d+)$', args.device)
spi = spidev.SpiDev()
try:
    if not m:
        raise OSError('bad device path')
    spi.open(int(m.group(1)), int(m.group(2)))
    spi.mode = 0
    spi.max_speed_hz = args.hz
except OSError as e:
    sys.stderr.write('cannot open %s: %s\n' % (args.device, e))
    sys.exit(4)

DARK = bytes([0x92, 0x49, 0x24] * 3 * args.leds) + bytes(90)


def finish(*_):
    try:
        spi.writebytes2(DARK)
        spi.close()
    finally:
        sys.exit(0)


signal.signal(signal.SIGTERM, finish)
signal.signal(signal.SIGINT, finish)

for line in sys.stdin:
    try:
        data = bytes.fromhex(line.strip())
    except ValueError:
        continue  # malformed line: skip
    if data:
        spi.writebytes2(data)
finish()
