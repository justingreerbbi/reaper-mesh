# USB firmware updates

The prototype uses the ESP32-S3 ROM loader and a single factory application. A failed/interrupted update can require BOOT/RESET and reinstall; automatic rollback and authenticated release signing are later public-release gates. Checksums detect corruption, not a malicious publisher. Use builds from your reviewed source tree. Do not flash this prototype on encrypted or secure-boot devices.

From the repository root, build committed source and validate without opening a device:

```sh
bash tools/build-firmware.sh
python3 tools/update-firmware.py
```

Disconnect the web console, keep USB power connected, then install:

```sh
python3 tools/update-firmware.py --flash --port /dev/cu.usbserial-0001
```

The updater checks clean source identity, supported protocol/storage schemas, pinned SDK, exact board/target, three artifact paths/offsets/sizes/SHA256 hashes, ESP32-S3 embedded checksums/digests, and the fixed partition table/MD5. It stages the verified bytes before opening the port. ROM preflight requires ESP32-S3, 8MB flash, esptool 4.12.0 and disabled security/encryption flags. It installs only bootloader at 0, partition table at 0x8000, and app at 0x10000; NVS at 0x9000–0xdfff is preserved. It never issues erase-all or eFuse commands. Esptool prints progress and verifies each image. Local flash-result.json records ROM verification separately from application qualification.

The default interpreter is the pinned SDK environment. `--python /absolute/path/to/python` can select another environment containing esptool 4.12.0. No shell command interpolation or automatic downloads are used. Validation needs Python 3.9+; installation additionally needs the serial tool environment. Board auto-detection cannot prove the Heltec RF variant or antenna: those remain separate documented facts.

After installation, reconnect the console. Confirm the expected firmware, synchronized persisted label/region/radio settings, fresh boot identity, probe status, and stable USB health. Old uncertain outcomes stay unknown after a reboot and are never resent. For the physical TS adapter regression:

```sh
node tools/hardware-client-smoke.ts .tools/espressif/python_env/idf5.5_py3.12_env/bin/python /dev/cu.usbserial-0001 usb-prototype-4
```

If automatic ROM entry fails, hold PRG/BOOT, tap RESET, release PRG, and rerun the same updater with known-good artifacts. If an update stops after writing begins, assume the application may be incomplete until reinstalled and verified. Do not clear NVS to fix a connection failure. The detailed historical first-flash record is in FIRST_FLASH.md.

## Validation

Host tests reject wrong targets, dirty/incompatible builds, altered paths/offsets, artifact size/hash mismatches, rehashed-but-invalid ESP images, changed partition layouts, symlink escapes, and secured/unexpected ROM targets. On November 1, 2026 the updater reinstalled usb-prototype-4 from commit 6692d12 on the development board: all three image hashes verified, followed by three TS client/adapter reconnects in 649/648/643 ms with revision 14 preserved. Actual power loss during flashing remains unqualified.
