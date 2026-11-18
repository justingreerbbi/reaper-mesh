#!/usr/bin/env python3
"""Builds the T1000-E's UF2 images for its Adafruit nRF52 bootloader (D57).

Usage: python3 tools/uf2-image.py APP.bin OUTPUT_DIR NAME

Writes two files:
  NAME-update.uf2   the application only; settings, keys and Bluetooth pairings are kept.
  NAME-install.uf2  the application plus blank (0xFF) data areas, for a first install over other
                    firmware. Reaper never erases storage it cannot read, so a fresh install has to.
"""

import struct
import sys
from pathlib import Path

FAMILY_NRF52840 = 0xADA52840
APP_START = 0x27000  # After SoftDevice S140 v7, as the bootloader expects.
APP_END = 0xE6000  # code_partition in boards/seeed/t1000_e/t1000_e.dts
DATA_START, DATA_END = 0xE6000, 0xF4000  # reaper_nvs, reaper_keys and storage
PAYLOAD = 256


def blocks(chunks: list[tuple[int, bytes]]) -> bytes:
    out = bytearray()
    for index, (address, data) in enumerate(chunks):
        out += struct.pack(
            "<IIIIIIII",
            0x0A324655,
            0x9E5D5157,
            0x00002000,  # familyID present
            address,
            len(data),
            index,
            len(chunks),
            FAMILY_NRF52840,
        )
        out += data.ljust(476, b"\x00")
        out += struct.pack("<I", 0x0AB16F30)
    return bytes(out)


def split(start: int, data: bytes) -> list[tuple[int, bytes]]:
    return [
        (start + offset, data[offset : offset + PAYLOAD].ljust(PAYLOAD, b"\xff"))
        for offset in range(0, len(data), PAYLOAD)
    ]


def main() -> None:
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    app = Path(sys.argv[1]).read_bytes()
    out_dir, name = Path(sys.argv[2]), sys.argv[3]
    if not app or APP_START + len(app) > APP_END:
        sys.exit(f"application is empty or larger than {APP_END - APP_START} bytes")
    application = split(APP_START, app)
    blank = split(DATA_START, b"\xff" * (DATA_END - DATA_START))
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{name}-update.uf2").write_bytes(blocks(application))
    (out_dir / f"{name}-install.uf2").write_bytes(blocks(application + blank))
    print(
        f"{name}: {len(app)} bytes at 0x{APP_START:x}; install also blanks 0x{DATA_START:x}-0x{DATA_END:x}"
    )


if __name__ == "__main__":
    main()
