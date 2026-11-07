"""Record exact build artifacts without publishing or flashing anything."""

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
board = sys.argv[1] if len(sys.argv) > 1 else "heltec-v3"
if board not in ("heltec-v3", "tbeam-v12"):
    raise ValueError("unsupported board")
tbeam = board == "tbeam-v12"
build = root / "build" / board
sdk = json.loads((root / "firmware/esp-idf.lock.json").read_text())
if tbeam:
    sdk["target"] = "esp32"
flash = json.loads((build / "flasher_args.json").read_text())
artifacts = []
for offset, name in flash["flash_files"].items():
    path = build / name
    data = path.read_bytes()
    artifacts.append(
        {
            "offset": offset,
            "file": name,
            "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        }
    )
manifest = {
    "board": "LILYGO T-Beam V1.2" if tbeam else "Heltec WiFi LoRa 32 V3",
    "target": "esp32" if tbeam else "esp32s3",
    "sdk": sdk,
    "source_commit": subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=root, text=True
    ).strip(),
    "source_dirty": bool(
        subprocess.check_output(["git", "status", "--porcelain"], cwd=root, text=True).strip()
    ),
    # version.hpp lists the T-Beam name first, then the Heltec name.
    "firmware": re.findall(
        r'kFirmwareVersion\[\] = "([^"]+)"',
        (root / "firmware/components/reaper_device/include/reaper/version.hpp").read_text(),
    )[0 if tbeam else -1],
    "radio_config_schema": 1,
    "read_record_schemas": [1, 2, 3, 4, 5, 6, 7, 8],
    "usb_protocol": 1,
    "config_schema": 1,
    "record_schema": 8,
    "radio_protocol": 2,
    "uart": {"baud": 115200, "tx_gpio": 1 if tbeam else 43, "rx_gpio": 3 if tbeam else 44},
    "radio": {
        "protocol": 1,
        "receive_supported": True,
        "boot_spi_probe": True,
        "reset_gpio": 23 if tbeam else 12,
        "default_mode": "off",
        "runtime_mode": "device-configuration",
        "antenna_verified": True
        if tbeam
        else re.search(
            r"kAntennaVerified = (true|false)",
            (root / "firmware/heltec-v3/main/board_profile.hpp").read_text(),
        ).group(1)
        == "true",
        "driver": {
            "source": "first-party-sx1276",
            "probe_version": "0x12",
            "tx_dbm": [2, 17],
            "boost_dbm": 20,
        }
        if tbeam
        else json.loads(
            (root / "firmware/components/reaper_radio/vendor/upstream.json").read_text()
        ),
    },
    "display": {
        "controller": "SSD1306",
        "width": 128,
        "height": 64,
        "sda_gpio": 21 if tbeam else 17,
        "scl_gpio": 22 if tbeam else 18,
        "reset_gpio": None if tbeam else 21,
        "vext_gpio": None if tbeam else 36,
        "vext_active_low": not tbeam,
    },
    "flash_settings": flash["flash_settings"],
    "artifacts": artifacts,
    "hardware_tested": False,
    "flashed": False,
}
(build / "reaper-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Wrote build/{board}/reaper-manifest.json")
