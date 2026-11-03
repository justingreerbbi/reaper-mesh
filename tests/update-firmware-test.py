"""Host-only destructive-input and preflight checks; never opens a serial port."""

import contextlib
import hashlib
import importlib.util
import io
import json
import struct
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "updater", Path(__file__).resolve().parents[1] / "tools/update-firmware.py"
)
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


def esp_image(payload=b"test"):
    data = bytearray(24)
    data[:4] = b"\xe9\x01\x02\x30"
    struct.pack_into("<H", data, 12, 9)
    data[23] = 1
    data += struct.pack("<II", 0x3FC88000, len(payload)) + payload
    checksum = 0xEF
    for value in payload:
        checksum ^= value
    data += bytes(15 - len(data) % 16) + bytes([checksum])
    return bytes(data) + hashlib.sha256(data).digest()


def partition_table():
    data = b"".join(
        struct.pack("<2sBBII16sI", b"\xaa\x50", *item[:4], item[4], 0)
        for item in updater.PARTITIONS
    )
    data += b"\xeb\xeb" + b"\xff" * 14 + hashlib.md5(data).digest()
    return data + b"\xff" * (3072 - len(data))


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="reaper-update-test-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.manifest = {
            "board": "Heltec WiFi LoRa 32 V3",
            "target": "esp32s3",
            "source_commit": "a" * 40,
            "source_dirty": False,
            "firmware": "usb-prototype-test",
            "sdk": {"commit": updater.SDK, "target": "esp32s3"},
            "usb_protocol": 1,
            "config_schema": 1,
            "record_schema": 2,
            "read_record_schemas": [1, 2],
            "flash_settings": {"flash_mode": "dio", "flash_size": "8MB", "flash_freq": "40m"},
            "artifacts": [],
        }
        for offset, (name, _) in updater.FILES.items():
            self.artifact(offset, partition_table() if offset == 0x8000 else esp_image())
        self.path = self.root / "manifest.json"

    def artifact(self, offset, data):
        name = updater.FILES[offset][0]
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        entry = {
            "offset": hex(offset),
            "file": name,
            "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        }
        self.manifest["artifacts"] = [
            item for item in self.manifest["artifacts"] if item["offset"] != hex(offset)
        ] + [entry]

    def validate(self):
        self.path.write_text(json.dumps(self.manifest))
        return updater.validate(self.path)

    def test_dirty_source_requires_explicit_local_development_override(self):
        self.manifest["source_dirty"] = True
        self.path.write_text(json.dumps(self.manifest))
        with self.assertRaisesRegex(ValueError, "allow-dirty"):
            updater.validate(self.path)
        _, images = updater.validate(self.path, allow_dirty=True)
        self.assertEqual(images[0x10000], esp_image())

    def test_valid_stages_exact_bytes(self):
        _, images = self.validate()
        self.assertEqual(images[0x10000], esp_image())
        self.assertEqual(images[0x8000], partition_table())

    def test_manifest_target_compatibility_and_identity(self):
        for key, value in [
            ("target", "esp32"),
            ("board", "other"),
            ("source_dirty", True),
            ("source_commit", "HEAD"),
            ("record_schema", 3),
            ("read_record_schemas", [2]),
            ("firmware", "../file"),
        ]:
            with self.subTest(key=key):
                old = self.manifest[key]
                self.manifest[key] = value
                with self.assertRaises(ValueError):
                    self.validate()
                self.manifest[key] = old

    def test_paths_offsets_and_hashes(self):
        for key, value in [
            ("file", "../image.bin"),
            ("offset", "0x9000"),
            ("size", 1),
            ("sha256", "0" * 64),
        ]:
            with self.subTest(key=key):
                entry = self.manifest["artifacts"][0]
                old = entry[key]
                entry[key] = value
                with self.assertRaises(ValueError):
                    self.validate()
                entry[key] = old
        self.manifest["artifacts"].append(self.manifest["artifacts"][0].copy())
        with self.assertRaises(ValueError):
            self.validate()

    def test_position_record_compatibility(self):
        self.manifest["record_schema"] = 4
        self.manifest["read_record_schemas"] = [1, 2, 3, 4]
        self.validate()
        self.manifest["read_record_schemas"] = [4]
        with self.assertRaises(ValueError):
            self.validate()

    def test_corrupt_embedded_image_even_if_manifest_rehashed(self):
        valid = esp_image()
        for position in [0, 1, 2, 3, 12, 23, 28, 32, len(valid) - 33, len(valid) - 1]:
            data = bytearray(valid)
            data[position] ^= 0x80
            with self.subTest(position=position):
                self.artifact(0x10000, data)
                with self.assertRaises(ValueError):
                    self.validate()
        for data in [valid[:-1], valid + b"extra", esp_image(b"x" * (0x200000 + 1))]:
            self.artifact(0x10000, data)
            with self.assertRaises(ValueError):
                self.validate()

    def test_partition_change_rejected_even_with_new_checksums(self):
        data = bytearray(partition_table())
        struct.pack_into("<I", data, 8, 0x6000)
        data[112:128] = hashlib.md5(data[:96]).digest()
        self.artifact(0x8000, data)
        with self.assertRaisesRegex(ValueError, "boundaries"):
            self.validate()

    def test_symlink_escape(self):
        outside = self.root.parent / (self.root.name + "-outside.bin")
        outside.write_bytes(esp_image())
        self.addCleanup(outside.unlink)
        image = self.root / updater.FILES[0][0]
        image.unlink()
        image.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, "escapes"):
            self.validate()

    def test_security_and_flash_preflight_fail_closed(self):
        flash = "esptool.py v4.12.0\nChip is ESP32-S3 (QFN56)\nDetected flash size: 8MB\n"
        security = "esptool.py v4.12.0\nFlags: 0x00000000 (0b0)\nSecure Boot: Disabled\nFlash Encryption: Disabled\n"
        updater.preflight(flash, security)
        for f, s in [
            (flash.replace("8MB", "4MB"), security),
            (flash.replace("ESP32-S3", "ESP32"), security),
            (flash, security.replace("Boot: Disabled", "Boot: Enabled")),
            (flash, security.replace("Encryption: Disabled", "Encryption: Enabled")),
            (flash, security.replace("00000000", "00000001")),
            (flash, security.replace("v4.12.0", "v5.0.0")),
        ]:
            with self.subTest(flash=f, security=s):
                with self.assertRaises(ValueError):
                    updater.preflight(f, s)

    def test_tbeam_target_and_security_are_not_interchangeable_with_heltec(self):
        self.manifest["board"] = "LILYGO T-Beam V1.2"
        self.manifest["target"] = "esp32"
        self.manifest["sdk"]["target"] = "esp32"
        self.manifest["flash_settings"]["flash_size"] = "4MB"
        for entry in self.manifest["artifacts"]:
            if entry["offset"] == "0x0":
                entry["offset"] = "0x1000"
            if entry["file"].endswith("partition-table.bin"):
                continue
            path = self.root / entry["file"]
            data = bytearray(esp_image())
            data[3] = 0x20
            struct.pack_into("<H", data, 12, 0)
            data[-32:] = hashlib.sha256(data[:-32]).digest()
            path.write_bytes(data)
            entry["sha256"] = hashlib.sha256(data).hexdigest()
        self.validate()
        self.manifest["target"] = "esp32s3"
        with self.assertRaises(ValueError):
            self.validate()
        fields = {
            name: {"readable": True, "value": 0}
            for name in [
                "FLASH_CRYPT_CNT",
                "ABS_DONE_0",
                "ABS_DONE_1",
                "DISABLE_DL_ENCRYPT",
                "DISABLE_DL_DECRYPT",
                "DISABLE_DL_CACHE",
                "SECURE_VERSION",
            ]
        }
        flash = "esptool.py v4.12.0\nChip is ESP32-D0WDQ6-V3\nDetected flash size: 4MB"

        def summary():
            return "espefuse.py v4.12.0\n" + json.dumps(fields)

        updater.preflight(flash, summary(), "esp32")
        fields["ABS_DONE_1"]["value"] = True
        with self.assertRaises(ValueError):
            updater.preflight(flash, summary(), "esp32")
        with self.assertRaises(ValueError):
            updater.preflight(flash, summary(), "esp32s3")

    def test_package_round_trip_retains_exact_images_and_required_notices(self):
        spec = importlib.util.spec_from_file_location(
            "packager", Path(__file__).resolve().parents[1] / "tools/package-firmware.py"
        )
        packager = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(packager)
        self.validate()
        for name in [
            "LICENSE",
            "NOTICE",
            ".tools/esp-idf/LICENSE",
            ".tools/esp-idf/components/newlib/COPYING.NEWLIB",
            "firmware/components/reaper_radio/vendor/LICENSE.txt",
            "tools/update-firmware.py",
        ]:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("retained fixture notice/source")
        output = self.root / "package.zip"
        with (
            patch.object(packager, "root", self.root),
            patch.object(
                packager.subprocess,
                "check_output",
                side_effect=[updater.SDK + "\n", b"source archive"],
            ),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            packager.package(self.path, output)
        with zipfile.ZipFile(output) as archive:
            for line in archive.read("SHA256SUMS").decode().splitlines():
                digest, name = line.split("  ", 1)
                self.assertEqual(hashlib.sha256(archive.read(name)).hexdigest(), digest)
            self.assertEqual(archive.read("reaper_mesh_usb.bin"), esp_image())
            self.assertEqual(archive.read("source.tar"), b"source archive")
            self.assertIn("notices/esp-idf/components/newlib/COPYING.NEWLIB", archive.namelist())
            self.assertEqual(archive.read("LICENSE"), b"retained fixture notice/source")
            self.assertEqual(archive.read("NOTICE"), b"retained fixture notice/source")
            extracted = self.root / "extracted"
            archive.extractall(extracted)
        updater.validate(extracted / "reaper-manifest.json")
        (extracted / "reaper_mesh_usb.bin").write_bytes(b"corrupt")
        with self.assertRaises(ValueError):
            updater.validate(extracted / "reaper-manifest.json")


if __name__ == "__main__":
    unittest.main()
