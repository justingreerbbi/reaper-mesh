# First USB-only Heltec V3 flash: review and recovery

The target is the owner-confirmed Heltec WiFi LoRa 32 V3 with display, using its CP2102 USB/UART bridge. ROM inspection on November 1, 2026 identified ESP32-S3 revision v0.2, 8 MB GD flash, 40 MHz crystal, quad flash wiring, secure boot disabled, and flash encryption disabled. These queries temporarily reset the device and used a RAM loader; they did not write flash or eFuses. RF band remains owner-confirmed US; the prototype performs no RF transmission.

## What the prototype does

- UART0 at 115200 baud, TX GPIO43 / RX GPIO44, matching the [Heltec V3 manual](https://resource.heltec.cn/download/WiFi_LoRa_32_V3/HTIT-WB32LA_V3%28Rev1.1%29.pdf).
- Version/capability handshake, authoritative snapshots, compare-and-set settings, bounded receipts, reconnect queries, and structured storage-failure reporting through the tested native engine.
- NVS-backed configuration; no erase/format-on-error fallback. Set/commit errors are indeterminate and close the logical session.
- The SX1262 is held in reset on GPIO12; Wi-Fi/BLE are not started. The [Espressif Heltec V3 variant](https://github.com/espressif/arduino-esp32/blob/master/variants/heltec_wifi_lora_32_V3/pins_arduino.h) identifies that reset pin. Non-RF entropy is temporarily enabled for a new 128-bit boot identity.
- Display output, mesh messaging, BLE, encryption, and firmware installation from the web app are not implemented. The screen may be blank or retain old content; use the web console as the readiness indicator.

SDK UART/application logging and bootloader logging are disabled on the binary stream. Immutable ROM startup output may still occur before the app aligns framing with a zero delimiter. No eFuses are changed to suppress ROM output. UART overflow/parity/framing errors or a stale partial frame reset the logical session; the authority and receipts survive reconnects for this boot.

## Build and inspect

```sh
bash tools/bootstrap-esp-idf.sh
bash tools/build-firmware.sh
npm run check
```

The official ESP-IDF v5.5.4 source is pinned to commit `735507283d5b2f9fb363a1901172dbd9e847945d` in `firmware/esp-idf.lock.json`. SDK/tools are installed under ignored `.tools/`. The build regenerates its ignored sdkconfig from the tracked defaults. The generated `build/heltec-v3/reaper-manifest.json` records exact artifact sizes/hashes, flash offsets, SDK/source state, protocol/schema versions, and radio-disabled intent. Build success does not establish actual board operation or storage durability.

The proposed image writes only:

| Offset | Artifact |
| --- | --- |
| 0x0000 | `build/heltec-v3/bootloader/bootloader.bin` |
| 0x8000 | `build/heltec-v3/partition_table/partition-table.bin` |
| 0x10000 | `build/heltec-v3/reaper_mesh_usb.bin` |

The prototype is a single factory application with a 2 MB partition. It has no application rollback/OTA updater. The new NVS partition uses offset 0x9000 and size 0x5000, matching this unit's original NVS extent observed in the partial read. The runtime uses its own `reaper` namespace. No NVS image, whole-chip erase, or data-partition erase is part of this first-flash command. Existing incompatible/full NVS must fail closed; any destructive storage recovery would require a separate explicit decision.

## Preservation and recovery decision

The owner explicitly declined keeping the existing firmware/settings on November 1, 2026. No backup is required for this development board. Previous read attempts are discontinued; their partial file is not a usable recovery image. Recovery means reinstalling a reviewed Reaper image through the ESP32-S3 ROM USB/UART loader, not restoring the previous firmware.

## First write and recovery command

Obtain approval for this specific first flash, after reviewing the manifest. Close serial applications. The command replaces the bootloader, partition table, and factory app. It does not erase the whole chip or NVS, and does not change eFuses. Existing settings are not promised to survive. At 115200 baud, esptool verifies each written artifact; a verification/transport error must stop qualification.

```sh
.tools/espressif/python_env/idf5.5_py3.12_env/bin/python -m esptool \
  --chip esp32s3 --port /dev/cu.usbserial-0001 --baud 115200 \
  --before default_reset --after hard_reset write_flash \
  --flash_mode dio --flash_size 8MB --flash_freq 40m \
  0x0 build/heltec-v3/bootloader/bootloader.bin \
  0x8000 build/heltec-v3/partition_table/partition-table.bin \
  0x10000 build/heltec-v3/reaper_mesh_usb.bin
```

If the app fails to boot/connect, reenter ROM and reinstall the same verified artifacts with this command. If automatic entry fails, hold PRG/BOOT, tap RESET, then release PRG. ROM recovery does not depend on the custom app. This is manual reinstall, with no application rollback slot. Do not erase NVS automatically if storage fails; diagnose before a separately reviewed storage reset.

## First hardware acceptance tests

1. Connect the web console in USB mode and confirm the prototype/device identity, synchronized settings, US/UNSET choices, and radio version 0.
2. Save a label, verify a committed receipt and incremented snapshot revision, then reconnect and read the same setting.
3. Reset/power-cycle the board: config/revision must survive, boot identity must change, and previous-boot uncertain results must not be claimed committed.
4. Interrupt a save/connection and query retained results after reconnect; never automatically replay the mutation.
5. Record UART error recovery and repeated reconnect behavior. Keep display/RF claims separate. Real flash power-loss and long-duration reliability testing remain additional qualification, not implied by one successful boot.

## Current gate status

The USB-only image builds and host checks pass. The owner waived preserving old firmware/settings. The specific first write awaits authorization; real hardware connection/persistence qualification remains pending. Serial read instability was observed during abandoned backup attempts, so successful write verification and subsequent communications tests are required before claiming hardware operation.
