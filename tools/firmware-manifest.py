"""Record exact build artifacts without publishing or flashing anything."""

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
# What differs between boards. Firmware names come from version.hpp by their prefix.
HELTEC_DISPLAY = {
    "controller": "SSD1306",
    "width": 128,
    "height": 64,
    "sda_gpio": 17,
    "scl_gpio": 18,
    "reset_gpio": 21,
    "vext_gpio": 36,
    "vext_active_low": True,
}
BOARDS = {
    "heltec-v3": {
        "name": "Heltec WiFi LoRa 32 V3",
        "target": "esp32s3",
        "prefix": "heltec-reaper-mesh-",
        "profile": "firmware/heltec-v3/main/board_profile.hpp",
        "uart": (43, 44),
        "reset_gpio": 12,
        "display": HELTEC_DISPLAY,
    },
    "heltec-wsl-v3": {
        "name": "Heltec Wireless Stick Lite V3",
        "target": "esp32s3",
        "prefix": "heltec-wsl-reaper-mesh-",
        "profile": "firmware/heltec-wsl-v3/main/board_profile.hpp",
        "uart": (43, 44),
        "reset_gpio": 12,
        "display": None,
    },
    "tbeam-v12": {
        "name": "LILYGO T-Beam V1.2",
        "target": "esp32",
        "prefix": "tbeam-reaper-mesh-",
        "profile": None,
        "uart": (1, 3),
        "reset_gpio": 23,
        "display": {
            "controller": "SSD1306",
            "width": 128,
            "height": 64,
            "sda_gpio": 21,
            "scl_gpio": 22,
            "reset_gpio": None,
            "vext_gpio": None,
            "vext_active_low": False,
        },
    },
}

board = sys.argv[1] if len(sys.argv) > 1 else "heltec-v3"
if board not in BOARDS:
    raise ValueError("unsupported board")
spec = BOARDS[board]
tbeam = board == "tbeam-v12"
build = root / "build" / board
sdk = json.loads((root / "firmware/esp-idf.lock.json").read_text())
sdk["target"] = spec["target"]
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
    "board": spec["name"],
    "target": spec["target"],
    "sdk": sdk,
    "source_commit": subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=root, text=True
    ).strip(),
    "source_dirty": bool(
        subprocess.check_output(["git", "status", "--porcelain"], cwd=root, text=True).strip()
    ),
    "firmware": next(
        name
        for name in re.findall(
            r'kFirmwareVersion\[\] = "([^"]+)"',
            (root / "firmware/components/reaper_device/include/reaper/version.hpp").read_text(),
        )
        if name.startswith(spec["prefix"])
    ),
    "radio_config_schema": 1,
    "read_record_schemas": [1, 2, 3, 4, 5, 6, 7, 8],
    "usb_protocol": 1,
    "config_schema": 1,
    "record_schema": 8,
    "radio_protocol": 2,
    "uart": {"baud": 115200, "tx_gpio": spec["uart"][0], "rx_gpio": spec["uart"][1]},
    "radio": {
        "protocol": 1,
        "receive_supported": True,
        "boot_spi_probe": True,
        "reset_gpio": spec["reset_gpio"],
        "default_mode": "off",
        "runtime_mode": "device-configuration",
        "antenna_verified": True
        if tbeam
        else re.search(
            r"kAntennaVerified = (true|false)", (root / spec["profile"]).read_text()
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
    "display": spec["display"],
    "flash_settings": flash["flash_settings"],
    "artifacts": artifacts,
    "hardware_tested": False,
    "flashed": False,
}
(build / "reaper-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Wrote build/{board}/reaper-manifest.json")
