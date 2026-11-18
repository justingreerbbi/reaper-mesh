#!/usr/bin/env python3
"""Packages a T1000-E build for its Adafruit nRF52 bootloader (D57).

Usage: python3 tools/t1000e-package.py BUILD_DIR FIRMWARE_ID

Reads BUILD_DIR/zephyr/zephyr.bin and writes, in BUILD_DIR:
  FIRMWARE_ID.bin           the application, at 0x27000. The browser installer sends it over the
                            bootloader's serial DFU, alone for an update or padded with 0xff up
                            to 0xea000 for a first install.
  FIRMWARE_ID-update.uf2    the application only; settings, keys and Bluetooth pairings are kept.
  FIRMWARE_ID-install.uf2   also blanks the data areas, for a first install over other firmware.
  reaper-manifest.json      what tools/build-site.ts publishes to the installer.

The layout must match boards/seeed/t1000_e/t1000_e.dts and agents/flasher/nrf-dfu.ts.
"""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

FAMILY_NRF52840 = 0xADA52840
APP_START = 0x27000  # After SoftDevice S140 v7, as the bootloader expects.
DATA_START = 0xE2000  # reaper_nvs, reaper_keys and Bluetooth storage, up to DATA_END
DATA_END = 0xEA000  # The end of what the bootloader's serial update can write (40 KB reserved).
PAYLOAD = 256


def blocks(chunks: list[tuple[int, bytes]]) -> bytes:
    out = bytearray()
    for index, (address, data) in enumerate(chunks):
        out += (0x0A324655).to_bytes(4, "little") + (0x9E5D5157).to_bytes(4, "little")
        for value in (0x00002000, address, len(data), index, len(chunks), FAMILY_NRF52840):
            out += value.to_bytes(4, "little")  # 0x2000: familyID present
        out += data.ljust(476, b"\x00") + (0x0AB16F30).to_bytes(4, "little")
    return bytes(out)


def split(start: int, data: bytes) -> list[tuple[int, bytes]]:
    return [
        (start + offset, data[offset : offset + PAYLOAD].ljust(PAYLOAD, b"\xff"))
        for offset in range(0, len(data), PAYLOAD)
    ]


def git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout.strip()


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    build, firmware = Path(sys.argv[1]), sys.argv[2]
    app = (build / "zephyr" / "zephyr.bin").read_bytes()
    if not app or APP_START + len(app) > DATA_START:
        sys.exit(f"application is empty or larger than {DATA_START - APP_START} bytes")
    application = split(APP_START, app)
    blank = split(DATA_START, b"\xff" * (DATA_END - DATA_START))
    (build / f"{firmware}.bin").write_bytes(app)
    (build / f"{firmware}-update.uf2").write_bytes(blocks(application))
    (build / f"{firmware}-install.uf2").write_bytes(blocks(application + blank))
    manifest = {
        "board": "Seeed SenseCAP T1000-E",
        "target": "nrf52840",
        "firmware": firmware,
        "source_commit": git("rev-parse", "HEAD"),
        "source_dirty": bool(git("status", "--porcelain", "--untracked-files=no")),
        "flash_settings": {"flash_size": "1MB"},
        "artifacts": [
            {
                "offset": f"0x{APP_START:x}",
                "file": f"{firmware}.bin",
                "size": len(app),
                "sha256": hashlib.sha256(app).hexdigest(),
            }
        ],
    }
    (build / "reaper-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(
        f"{firmware}: {len(app)} bytes at 0x{APP_START:x}; install also blanks 0x{DATA_START:x}-0x{DATA_END:x}"
    )


if __name__ == "__main__":
    main()
