"""Validate a supported Reaper board build, optionally install it using the pinned ROM tool.

No erase-all, eFuse writes, encrypted targets, unsigned remote downloads or OTA.
Hashes detect corruption; they are not publisher authentication.
"""

import argparse
import hashlib
import json
import re
import struct
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

SDK = "735507283d5b2f9fb363a1901172dbd9e847945d"
ESP32S3_BOARDS = ["Heltec WiFi LoRa 32 V3", "Heltec Wireless Stick V3"]
OTADATA = 0x21A000
FILES = {
    0: ("bootloader/bootloader.bin", 0x8000),
    0x8000: ("partition_table/partition-table.bin", 0x1000),
    # Also has to fit the smaller second slot, which a later signed update installs into.
    0x10000: ("reaper_mesh_usb.bin", 0x1E0000),
    # Blank, so the bootloader takes the first slot, which is the one just written.
    OTADATA: ("ota_data_initial.bin", 0x2000),
}
PARTITIONS = [
    (1, 2, 0x9000, 0x5000, b"reaper_nvs"),
    (1, 1, 0xF000, 0x1000, b"phy_init"),
    (0, 0x10, 0x10000, 0x200000, b"ota_0"),
    (1, 2, 0x210000, 0x8000, b"nvs"),
    (1, 0x40, 0x218000, 0x2000, b"reaper_keys"),
    (1, 0, 0x21A000, 0x2000, b"otadata"),
    (0, 0x11, 0x220000, 0x1E0000, b"ota_1"),
]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def image(data, chip_id=9, flash_byte=0x30):
    require(len(data) >= 64 and data[0] == 0xE9, "invalid ESP image header")
    require(
        1 <= data[1] <= 16 and data[2:4] == bytes([2, flash_byte]),
        "image flash mode/size/frequency mismatch",
    )
    require(
        struct.unpack_from("<H", data, 12)[0] == chip_id and data[23] == 1,
        "image target or embedded digest flag mismatch",
    )
    position, checksum = 24, 0xEF
    for _ in range(data[1]):
        require(position + 8 <= len(data), "truncated image segment header")
        length = struct.unpack_from("<I", data, position + 4)[0]
        position += 8
        require(length > 0 and position + length <= len(data), "invalid image segment length")
        for byte in data[position : position + length]:
            checksum ^= byte
        position += length
    checksum_at = position + 15 - position % 16
    require(checksum_at + 33 == len(data), "truncated image or unsupported appended signature/data")
    require(data[checksum_at] == checksum, "image segment checksum mismatch")
    require(
        hashlib.sha256(data[: checksum_at + 1]).digest() == data[checksum_at + 1 :],
        "image embedded SHA256 mismatch",
    )


def partitions(data):
    require(len(data) == 3072, "partition table must be 3072 bytes")
    for index, expected in enumerate(PARTITIONS):
        magic, kind, subtype, offset, size, label, flags = struct.unpack_from(
            "<2sBBII16sI", data, index * 32
        )
        require(
            magic == b"\xaa\x50"
            and (kind, subtype, offset, size, label.rstrip(b"\0")) == expected
            and flags == 0,
            "partition layout would change storage or application boundaries",
        )
    end = len(PARTITIONS) * 32
    require(
        data[end : end + 16] == b"\xeb\xeb" + b"\xff" * 14
        and data[end + 16 : end + 32] == hashlib.md5(data[:end]).digest(),
        "partition table MD5 mismatch",
    )
    require(data[end + 32 :] == b"\xff" * (len(data) - end - 32), "extra partition entries/data")


def validate(path, allow_dirty=False):
    path = Path(path).resolve()
    require(path.stat().st_size <= 65536, "manifest too large")
    manifest = json.loads(path.read_text())
    tbeam = manifest.get("board") == "LILYGO T-Beam V1.2"
    target = "esp32" if tbeam else "esp32s3"
    # Both Heltec boards are an ESP32-S3FN8 with the same flash, layout and image format.
    require(
        manifest.get("board") in (["LILYGO T-Beam V1.2"] if tbeam else ESP32S3_BOARDS)
        and manifest.get("target") == target,
        "wrong board/target",
    )
    files = dict(FILES)
    if tbeam:
        files[0x1000] = (files.pop(0)[0], 0x7000)
    require(
        re.fullmatch(r"[0-9a-f]{40}", manifest.get("source_commit", "")) is not None
        and (
            manifest.get("source_dirty") is False
            or (allow_dirty and manifest.get("source_dirty") is True)
        ),
        "build must identify a clean committed source (or use --allow-dirty for local development hardware)",
    )
    require(
        re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", manifest.get("firmware", "")) is not None,
        "invalid firmware ID",
    )
    require(
        manifest.get("sdk", {}).get("commit") == SDK and manifest["sdk"].get("target") == target,
        "unreviewed SDK",
    )
    require(
        manifest.get("flash_settings")
        == {"flash_mode": "dio", "flash_size": "4MB" if tbeam else "8MB", "flash_freq": "40m"},
        "unsupported flash settings",
    )
    require(
        (manifest.get("usb_protocol"), manifest.get("config_schema")) == (1, 1)
        and (manifest.get("record_schema"), manifest.get("read_record_schemas"))
        in [
            (2, [1, 2]),
            (3, [1, 2, 3]),
            (4, [1, 2, 3, 4]),
            (5, [1, 2, 3, 4, 5]),
            (6, [1, 2, 3, 4, 5, 6]),
            (8, [1, 2, 3, 4, 5, 6, 7, 8]),
        ],
        "unsupported configuration compatibility",
    )
    records = manifest.get("artifacts")
    require(
        isinstance(records, list) and len(records) == len(files),
        "expected exactly four flash artifacts",
    )
    artifacts = {}
    for entry in records:
        offset = int(entry["offset"], 16)
        require(offset in files and offset not in artifacts, "unexpected/duplicate flash offset")
        name, maximum = files[offset]
        require(entry["file"] == name, "unexpected artifact path")
        artifact = path.parent / name
        require(
            not artifact.is_symlink() and artifact.resolve().is_relative_to(path.parent),
            "artifact escapes build directory",
        )
        require(0 < artifact.stat().st_size <= maximum, "artifact exceeds its flash region")
        data = artifact.read_bytes()
        require(type(entry["size"]) is int and entry["size"] == len(data), "artifact size mismatch")
        require(hashlib.sha256(data).hexdigest() == entry["sha256"], "artifact SHA256 mismatch")
        if offset == 0x8000:
            partitions(data)
        elif offset == OTADATA:
            require(data == b"\xff" * 0x2000, "OTA data must be blank")
        else:
            image(data, 0 if tbeam else 9, 0x20 if tbeam else 0x30)
        artifacts[offset] = data
    return manifest, artifacts


def run_tool(python, port, command, *args, chip="esp32s3"):
    result = subprocess.run(
        [
            str(python),
            "-m",
            "esptool",
            "--chip",
            chip,
            "--port",
            port,
            "--baud",
            "115200",
            "--before",
            "default_reset",
            "--after",
            "hard_reset",
            command,
            *map(str, args),
        ],
        capture_output=True,
        text=True,
        timeout=180 if command == "write_flash" else 30,
    )
    # Report only the intended serial tool's output; never pass it to a shell.
    print(result.stdout, end="")
    print(result.stderr, end="", file=sys.stderr)
    require(
        result.returncode == 0,
        f"ROM tool failed during {command}; stop and use documented BOOT/RESET recovery",
    )
    return result.stdout


def preflight(flash, security, target="esp32s3"):
    require("esptool.py v4.12.0" in flash, "unexpected esptool version")
    pattern = r"Chip is ESP32-D0WD" if target == "esp32" else r"Chip is ESP32-S3(?:\s|\s*\()"
    size = "4MB" if target == "esp32" else "8MB"
    require(
        re.search(pattern, flash) is not None and f"Detected flash size: {size}" in flash,
        "target processor/flash mismatch",
    )
    if target == "esp32":
        require(security.startswith("espefuse.py v4.12.0\n"), "unexpected security reader version")
        fields = json.loads(security.split("\n", 1)[1])
        for name in [
            "FLASH_CRYPT_CNT",
            "ABS_DONE_0",
            "ABS_DONE_1",
            "DISABLE_DL_ENCRYPT",
            "DISABLE_DL_DECRYPT",
            "DISABLE_DL_CACHE",
            "SECURE_VERSION",
        ]:
            field = fields.get(name, {})
            require(
                field.get("readable") is True and field.get("value") in (0, False),
                f"unsupported ESP32 security state: {name}",
            )
        return
    require("esptool.py v4.12.0" in security, "unexpected esptool version")
    require(
        "Secure Boot: Disabled" in security and "Flash Encryption: Disabled" in security,
        "secured targets need a separate reviewed update flow",
    )
    flags = re.search(r"^Flags: (0x[0-9a-fA-F]+)", security, re.MULTILINE)
    require(flags is not None and int(flags.group(1), 16) == 0, "unexpected ROM security flags")


def esp32_security(python, port, directory):
    report = Path(directory) / "security.json"
    names = [
        "FLASH_CRYPT_CNT",
        "ABS_DONE_0",
        "ABS_DONE_1",
        "DISABLE_DL_ENCRYPT",
        "DISABLE_DL_DECRYPT",
        "DISABLE_DL_CACHE",
        "SECURE_VERSION",
    ]
    result = subprocess.run(
        [
            str(python),
            "-m",
            "espefuse",
            "--chip",
            "esp32",
            "--port",
            port,
            "summary",
            "--format",
            "json",
            "--file",
            str(report),
            *names,
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    require(
        result.returncode == 0 and "espefuse.py v4.12.0" in result.stdout,
        "ESP32 security summary failed",
    )
    return "espefuse.py v4.12.0\n" + report.read_text()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest", type=Path, default=Path("build/heltec-v3/reaper-manifest.json")
    )
    parser.add_argument(
        "--flash",
        action="store_true",
        help="install validated images; default only validates files",
    )
    parser.add_argument(
        "--allow-dirty",
        action="store_true",
        help="allow a hash-verified dirty-tree build for local development only",
    )
    parser.add_argument("--port", help="explicit USB serial port, e.g. /dev/cu.usbserial-0001")
    parser.add_argument(
        "--python",
        type=Path,
        help="Python interpreter with esptool 4.12.0; defaults to the repository SDK environment",
    )
    options = parser.parse_args()
    manifest, artifacts = validate(options.manifest, allow_dirty=options.allow_dirty)
    print(
        f"Validated {manifest['firmware']} / source {manifest['source_commit']}: four images, fixed storage-preserving layout."
    )
    if manifest["source_dirty"]:
        print(
            "WARNING: dirty-tree development build; image hashes and ROM target/security checks still apply, but this is not a reproducible release build."
        )
    if not options.flash:
        print("No device opened. Add --flash --port PORT to install these images.")
        return
    require(bool(options.port), "--flash requires an explicit --port")
    root = Path(__file__).resolve().parent.parent
    python = (
        options.python.resolve()
        if options.python
        else root / ".tools/espressif/python_env/idf5.5_py3.12_env/bin/python"
    )
    require(python.is_file(), "install the pinned SDK first: bash tools/bootstrap-esp-idf.sh")
    # Stage verified bytes, never re-read mutable build outputs during the write.
    with tempfile.TemporaryDirectory(prefix="reaper-update-") as directory:
        staged = []
        for offset, data in sorted(artifacts.items()):
            destination = Path(directory) / f"{offset:x}.bin"
            destination.write_bytes(data)
            staged += [hex(offset), str(destination)]
        flash = run_tool(python, options.port, "flash_id", chip=manifest["target"])
        security = (
            esp32_security(python, options.port, directory)
            if manifest["target"] == "esp32"
            else run_tool(python, options.port, "get_security_info", chip=manifest["target"])
        )
        preflight(flash, security, manifest["target"])
        print("Installing; keep USB connected. NVS is outside every write range.")
        written = run_tool(
            python,
            options.port,
            "write_flash",
            "--flash_mode",
            "dio",
            "--flash_size",
            manifest["flash_settings"]["flash_size"],
            "--flash_freq",
            "40m",
            *staged,
            chip=manifest["target"],
        )
        require(
            written.count("Hash of data verified.") == len(artifacts),
            "ROM did not verify all images",
        )
    receipt = {
        "time_utc": datetime.now(timezone.utc).isoformat(),
        "firmware": manifest["firmware"],
        "source_commit": manifest["source_commit"],
        "artifacts": manifest["artifacts"],
        "verified_images": len(artifacts),
        "application_qualified": False,
    }
    receipt_path = options.manifest.resolve().parent / "flash-result.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
    print(
        f"ROM verified all {len(artifacts)} images. Reconnect the console and verify firmware/settings. Receipt: {receipt_path}"
    )


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        print(f"Update stopped: {error}", file=sys.stderr)
        sys.exit(1)
