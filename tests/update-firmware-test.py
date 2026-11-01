"""Host-only destructive-input and preflight checks; never opens a serial port."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("updater", Path(__file__).resolve().parents[1] / "tools/update-firmware.py")
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


def esp_image(payload=b"test"):
    data = bytearray(24)
    data[:4] = b"\xe9\x01\x02\x30"
    struct.pack_into("<H", data, 12, 9)
    data[23] = 1
    data += struct.pack("<II", 0x3fc88000, len(payload)) + payload
    checksum = 0xef
    for value in payload:
        checksum ^= value
    data += bytes(15 - len(data) % 16) + bytes([checksum])
    return bytes(data) + hashlib.sha256(data).digest()


def partition_table():
    data = b"".join(struct.pack("<2sBBII16sI", b"\xaa\x50", *item[:4], item[4], 0) for item in updater.PARTITIONS)
    data += b"\xeb\xeb" + b"\xff" * 14 + hashlib.md5(data).digest()
    return data + b"\xff" * (3072 - len(data))


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="reaper-update-test-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.manifest = {"board": "Heltec WiFi LoRa 32 V3", "target": "esp32s3", "source_commit": "a" * 40,
                         "source_dirty": False, "firmware": "usb-prototype-test", "sdk": {"commit": updater.SDK, "target": "esp32s3"},
                         "usb_protocol": 1, "config_schema": 1, "record_schema": 2, "read_record_schemas": [1, 2],
                         "flash_settings": {"flash_mode": "dio", "flash_size": "8MB", "flash_freq": "40m"}, "artifacts": []}
        for offset, (name, _) in updater.FILES.items():
            self.artifact(offset, partition_table() if offset == 0x8000 else esp_image())
        self.path = self.root / "manifest.json"

    def artifact(self, offset, data):
        name = updater.FILES[offset][0]
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        entry = {"offset": hex(offset), "file": name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        self.manifest["artifacts"] = [item for item in self.manifest["artifacts"] if item["offset"] != hex(offset)] + [entry]

    def validate(self):
        self.path.write_text(json.dumps(self.manifest))
        return updater.validate(self.path)

    def test_valid_stages_exact_bytes(self):
        _, images = self.validate()
        self.assertEqual(images[0x10000], esp_image())
        self.assertEqual(images[0x8000], partition_table())

    def test_manifest_target_compatibility_and_identity(self):
        for key, value in [("target", "esp32"), ("board", "other"), ("source_dirty", True), ("source_commit", "HEAD"),
                           ("record_schema", 3), ("read_record_schemas", [2]), ("firmware", "../file")]:
            with self.subTest(key=key):
                old = self.manifest[key]; self.manifest[key] = value
                with self.assertRaises(ValueError): self.validate()
                self.manifest[key] = old

    def test_paths_offsets_and_hashes(self):
        for key, value in [("file", "../image.bin"), ("offset", "0x9000"), ("size", 1), ("sha256", "0" * 64)]:
            with self.subTest(key=key):
                entry = self.manifest["artifacts"][0]; old = entry[key]; entry[key] = value
                with self.assertRaises(ValueError): self.validate()
                entry[key] = old
        self.manifest["artifacts"].append(self.manifest["artifacts"][0].copy())
        with self.assertRaises(ValueError): self.validate()

    def test_corrupt_embedded_image_even_if_manifest_rehashed(self):
        valid = esp_image()
        for position in [0, 1, 2, 3, 12, 23, 28, 32, len(valid) - 33, len(valid) - 1]:
            data = bytearray(valid); data[position] ^= 0x80
            with self.subTest(position=position):
                self.artifact(0x10000, data)
                with self.assertRaises(ValueError): self.validate()
        for data in [valid[:-1], valid + b"extra", esp_image(b"x" * (0x200000 + 1))]:
            self.artifact(0x10000, data)
            with self.assertRaises(ValueError): self.validate()

    def test_partition_change_rejected_even_with_new_checksums(self):
        data = bytearray(partition_table()); struct.pack_into("<I", data, 8, 0x6000)
        data[112:128] = hashlib.md5(data[:96]).digest()
        self.artifact(0x8000, data)
        with self.assertRaisesRegex(ValueError, "boundaries"): self.validate()

    def test_symlink_escape(self):
        outside = self.root.parent / (self.root.name + "-outside.bin")
        outside.write_bytes(esp_image()); self.addCleanup(outside.unlink)
        image = self.root / updater.FILES[0][0]; image.unlink(); image.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, "escapes"): self.validate()

    def test_security_and_flash_preflight_fail_closed(self):
        flash = "esptool.py v4.12.0\nChip is ESP32-S3 (QFN56)\nDetected flash size: 8MB\n"
        security = "esptool.py v4.12.0\nFlags: 0x00000000 (0b0)\nSecure Boot: Disabled\nFlash Encryption: Disabled\n"
        updater.preflight(flash, security)
        for f, s in [(flash.replace("8MB", "4MB"), security), (flash.replace("ESP32-S3", "ESP32"), security),
                     (flash, security.replace("Boot: Disabled", "Boot: Enabled")), (flash, security.replace("Encryption: Disabled", "Encryption: Enabled")),
                     (flash, security.replace("00000000", "00000001")), (flash, security.replace("v4.12.0", "v5.0.0"))]:
            with self.subTest(flash=f, security=s):
                with self.assertRaises(ValueError): updater.preflight(f, s)


if __name__ == "__main__":
    unittest.main()
