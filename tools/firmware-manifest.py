"""Record exact build artifacts without publishing or flashing anything."""
import hashlib
import json
import re
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent
build = root / "build/heltec-v3"
sdk = json.loads((root / "firmware/esp-idf.lock.json").read_text())
flash = json.loads((build / "flasher_args.json").read_text())
artifacts = []
for offset, name in flash["flash_files"].items():
    path = build / name
    data = path.read_bytes()
    artifacts.append({"offset": offset, "file": name, "size": len(data),
                      "sha256": hashlib.sha256(data).hexdigest()})
manifest = {
    "board": "Heltec WiFi LoRa 32 V3", "target": "esp32s3", "sdk": sdk,
    "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
    "source_dirty": bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=root, text=True).strip()),
    "firmware": re.search(r'kFirmwareVersion\[\] = "([^"]+)"', (root / "firmware/components/reaper_device/include/reaper/version.hpp").read_text()).group(1),
    "radio_config_schema": 1, "read_record_schemas": [1, 2],
    "usb_protocol": 1, "config_schema": 1, "record_schema": 2, "radio_protocol": 0,
    "uart": {"baud": 115200, "tx_gpio": 43, "rx_gpio": 44},
    "radio": {"enabled": False, "reset_gpio": 12, "held_in_reset": True},
    "display": {"controller": "SSD1306", "width": 128, "height": 64, "sda_gpio": 17,
                "scl_gpio": 18, "reset_gpio": 21, "vext_gpio": 36, "vext_active_low": True},
    "flash_settings": flash["flash_settings"], "artifacts": artifacts,
    "hardware_tested": False, "flashed": False,
}
(build / "reaper-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print("Wrote build/heltec-v3/reaper-manifest.json")
