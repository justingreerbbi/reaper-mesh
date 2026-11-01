"""Validate a Reaper Heltec V3 build, optionally install it using the pinned ROM tool.

No erase-all, eFuse writes, encrypted targets, unsigned remote downloads or OTA.
Hashes detect corruption; they are not publisher authentication.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import sys
import tempfile

SDK = "735507283d5b2f9fb363a1901172dbd9e847945d"
FILES = {0: ("bootloader/bootloader.bin", 0x8000),
         0x8000: ("partition_table/partition-table.bin", 0x1000),
         0x10000: ("reaper_mesh_usb.bin", 0x200000)}
PARTITIONS = [(1, 2, 0x9000, 0x5000, b"reaper_nvs"),
              (1, 1, 0xf000, 0x1000, b"phy_init"),
              (0, 0, 0x10000, 0x200000, b"factory")]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def image(data):
    require(len(data) >= 64 and data[0] == 0xe9, "invalid ESP image header")
    require(1 <= data[1] <= 16 and data[2:4] == b"\x02\x30", "image needs DIO / 8MB / 40MHz")
    require(struct.unpack_from("<H", data, 12)[0] == 9 and data[23] == 1, "image must be hashed ESP32-S3")
    position, checksum = 24, 0xef
    for _ in range(data[1]):
        require(position + 8 <= len(data), "truncated image segment header")
        length = struct.unpack_from("<I", data, position + 4)[0]
        position += 8
        require(length > 0 and position + length <= len(data), "invalid image segment length")
        for byte in data[position:position + length]:
            checksum ^= byte
        position += length
    checksum_at = position + 15 - position % 16
    require(checksum_at + 33 == len(data), "truncated image or unsupported appended signature/data")
    require(data[checksum_at] == checksum, "image segment checksum mismatch")
    require(hashlib.sha256(data[:checksum_at + 1]).digest() == data[checksum_at + 1:], "image embedded SHA256 mismatch")


def partitions(data):
    require(len(data) == 3072, "partition table must be 3072 bytes")
    for index, expected in enumerate(PARTITIONS):
        magic, kind, subtype, offset, size, label, flags = struct.unpack_from("<2sBBII16sI", data, index * 32)
        require(magic == b"\xaa\x50" and (kind, subtype, offset, size, label.rstrip(b"\0")) == expected and flags == 0,
                "partition layout would change storage or application boundaries")
    end = len(PARTITIONS) * 32
    require(data[end:end + 16] == b"\xeb\xeb" + b"\xff" * 14 and
            data[end + 16:end + 32] == hashlib.md5(data[:end]).digest(), "partition table MD5 mismatch")
    require(data[end + 32:] == b"\xff" * (len(data) - end - 32), "extra partition entries/data")


def validate(path):
    path = Path(path).resolve()
    require(path.stat().st_size <= 65536, "manifest too large")
    manifest = json.loads(path.read_text())
    require(manifest.get("board") == "Heltec WiFi LoRa 32 V3" and manifest.get("target") == "esp32s3", "wrong board/target")
    require(re.fullmatch(r"[0-9a-f]{40}", manifest.get("source_commit", "")) is not None and manifest.get("source_dirty") is False,
            "build must identify a clean committed source")
    require(re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", manifest.get("firmware", "")) is not None, "invalid firmware ID")
    require(manifest.get("sdk", {}).get("commit") == SDK and manifest["sdk"].get("target") == "esp32s3", "unreviewed SDK")
    require(manifest.get("flash_settings") == {"flash_mode": "dio", "flash_size": "8MB", "flash_freq": "40m"}, "unsupported flash settings")
    require((manifest.get("usb_protocol"), manifest.get("config_schema"), manifest.get("record_schema"), manifest.get("read_record_schemas")) == (1, 1, 2, [1, 2]), "unsupported configuration compatibility")
    records = manifest.get("artifacts")
    require(isinstance(records, list) and len(records) == 3, "expected exactly three flash artifacts")
    artifacts = {}
    for entry in records:
        offset = int(entry["offset"], 16)
        require(offset in FILES and offset not in artifacts, "unexpected/duplicate flash offset")
        name, maximum = FILES[offset]
        require(entry["file"] == name, "unexpected artifact path")
        artifact = path.parent / name
        require(not artifact.is_symlink() and artifact.resolve().is_relative_to(path.parent), "artifact escapes build directory")
        require(0 < artifact.stat().st_size <= maximum, "artifact exceeds its flash region")
        data = artifact.read_bytes()
        require(type(entry["size"]) is int and entry["size"] == len(data), "artifact size mismatch")
        require(hashlib.sha256(data).hexdigest() == entry["sha256"], "artifact SHA256 mismatch")
        (partitions if offset == 0x8000 else image)(data)
        artifacts[offset] = data
    return manifest, artifacts


def run_tool(python, port, command, *args):
    result = subprocess.run([str(python), "-m", "esptool", "--chip", "esp32s3", "--port", port, "--baud", "115200",
                             "--before", "default_reset", "--after", "hard_reset", command, *map(str, args)],
                            capture_output=True, text=True, timeout=180 if command == "write_flash" else 30)
    # Report only the intended serial tool's output; never pass it to a shell.
    print(result.stdout, end=""); print(result.stderr, end="", file=sys.stderr)
    require(result.returncode == 0, f"ROM tool failed during {command}; stop and use documented BOOT/RESET recovery")
    return result.stdout


def preflight(flash, security):
    require("esptool.py v4.12.0" in flash and "esptool.py v4.12.0" in security, "unexpected esptool version")
    require(re.search(r"Chip is ESP32-S3(?:\s|\s*\()", flash) is not None and "Detected flash size: 8MB" in flash, "target must be ESP32-S3 with 8MB flash")
    require("Secure Boot: Disabled" in security and "Flash Encryption: Disabled" in security, "secured targets need a separate reviewed update flow")
    flags = re.search(r"^Flags: (0x[0-9a-fA-F]+)", security, re.MULTILINE)
    require(flags is not None and int(flags.group(1), 16) == 0, "unexpected ROM security flags")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("build/heltec-v3/reaper-manifest.json"))
    parser.add_argument("--flash", action="store_true", help="install validated images; default only validates files")
    parser.add_argument("--port", help="explicit USB serial port, e.g. /dev/cu.usbserial-0001")
    parser.add_argument("--python", type=Path, help="Python interpreter with esptool 4.12.0; defaults to the repository SDK environment")
    options = parser.parse_args()
    manifest, artifacts = validate(options.manifest)
    print(f"Validated {manifest['firmware']} / source {manifest['source_commit']}: three images, fixed storage-preserving layout.")
    if not options.flash:
        print("No device opened. Add --flash --port PORT to install these images.")
        return
    require(bool(options.port), "--flash requires an explicit --port")
    root = Path(__file__).resolve().parent.parent
    python = options.python.resolve() if options.python else root / ".tools/espressif/python_env/idf5.5_py3.12_env/bin/python"
    require(python.is_file(), "install the pinned SDK first: bash tools/bootstrap-esp-idf.sh")
    # Stage verified bytes, never re-read mutable build outputs during the write.
    with tempfile.TemporaryDirectory(prefix="reaper-update-") as directory:
        staged = []
        for offset, data in sorted(artifacts.items()):
            destination = Path(directory) / f"{offset:x}.bin"
            destination.write_bytes(data); staged += [hex(offset), str(destination)]
        flash = run_tool(python, options.port, "flash_id")
        security = run_tool(python, options.port, "get_security_info")
        preflight(flash, security)
        print("Installing; keep USB connected. NVS is outside every write range.")
        written = run_tool(python, options.port, "write_flash", "--flash_mode", "dio", "--flash_size", "8MB", "--flash_freq", "40m", *staged)
        require(written.count("Hash of data verified.") == 3, "ROM did not verify all three images")
    receipt = {"time_utc": datetime.now(timezone.utc).isoformat(), "firmware": manifest["firmware"],
               "source_commit": manifest["source_commit"], "artifacts": manifest["artifacts"], "verified_images": 3,
               "application_qualified": False}
    receipt_path = options.manifest.resolve().parent / "flash-result.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
    print(f"ROM verified three images. Reconnect the console and verify firmware/settings. Receipt: {receipt_path}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        print(f"Update stopped: {error}", file=sys.stderr)
        sys.exit(1)
