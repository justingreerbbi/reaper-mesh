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
node tools/hardware-client-smoke.ts .tools/espressif/python_env/idf5.5_py3.12_env/bin/python /dev/cu.usbserial-0001 usb-prototype-6
```

If automatic ROM entry fails, hold PRG/BOOT, tap RESET, release PRG, and rerun the same updater with known-good artifacts. If an update stops after writing begins, assume the application may be incomplete until reinstalled and verified. Do not clear NVS to fix a connection failure. The detailed historical first-flash record is in FIRST_FLASH.md.

## Validation

Host tests reject wrong targets, dirty/incompatible builds, altered paths/offsets, artifact size/hash mismatches, rehashed-but-invalid ESP images, changed partition layouts, symlink escapes, and secured/unexpected ROM targets. On November 1, 2026 the updater reinstalled usb-prototype-4 from commit 6692d12 on the development board: all three image hashes verified, followed by three TS client/adapter reconnects in 649/648/643 ms with revision 14 preserved. Actual power loss during flashing remains unqualified.

## Local prototype bundle

`python3 tools/package-firmware.py --output build/heltec-v3/reaper-mesh-usb-prototype-6.zip` creates a validated archive of the three images, manifest, standalone updater, exact source archive, SHA256SUMS, recovery instructions and retained SDK/Semtech notices. It refuses to overwrite an existing package. Nothing is uploaded. An extracted package was validated and every file hash checked; corrupt extracted images were rejected. Project licensing and authenticated public releases remain deferred. The web console also offers Export device settings for a readable snapshot before updating.

## T-Beam V1.2

Use `bash tools/build-firmware.sh tbeam-v12` and explicitly select `--manifest build/tbeam-v12/reaper-manifest.json` for validation/installation. The updater requires ESP32/4MB and bootloader0x1000; Heltec requires ESP32-S3/8MB and bootloader0. Wrong targets fail closed. ESP32 security uses a read-only named-eFuse summary because that ROM lacks get_security_info. See TBEAM.md for the identified port, confirmed hardware, first install and actual two-board RF evidence. Package generation accepts the board-specific manifest and writes matching hardware instructions.

Discovery builds Heltec7/T-Beam2 read records1/2/3. Nondefault discovery settings use record3; old firmware that only reads1/2 must fail closed on it. A future downgrade needs explicit configuration compatibility handling, never automatic NVS erasure. Returning discovery to its default off/off/300 policy writes the applicable older record format while preserving the other configuration. See PHASE2.md for installed-image and hardware-test evidence.

Fixed-position builds Heltec8/T-Beam3 read records1–4 and write record4 for nondefault saved position policy (max166 bytes). The updater accepts this exact schema/read-set pair while retaining older supported manifests. Unsupported downgrade storage fails closed; no erase is implied.

Qualified fixed-position images use clean source420967909bb4693746620b76ca2d88ef7d0e4eb3. Local bundles (all internal checksums verified): Heltec8 SHA25641369fe1d2e905666835e5d90f7539c850fb078d7f4cc5cd835304a47584db1f; T-Beam3 SHA256f9ae32ed25d7f223c575305b3f5d2d383431f9d156a7618c173dfb48f06d7f56. The first Heltec write stopped at70% of the app; reinstalling the same validated three-image set recovered it, with ROM hashes verified and settings preserved. This observed failure/recovery does not establish automatic rollback or arbitrary power-loss safety.
