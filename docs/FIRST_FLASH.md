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

## First hardware result

First flash completed November 1, 2026 using commit c41dc6e, USB app SHA-256 bf2be8a9514df3f463d7edcfe76752d791ec7b871284f7e099d42bbb81cff523. Esptool verified all three written artifacts. Physical USB smoke checks passed: handshake/snapshot, NVS configuration commit, logical reconnect, retained receipt query, serial reopen, and reset with fresh boot identity and persisted revision/settings. Opening this CP2102 port reset the board; immediate negotiation timed out, while waiting two seconds succeeded. Browser Web Serial startup/retry handling needs qualification before calling the web path ready. No display, RF, physical cable-removal, power-cut, or long-duration qualification is claimed.

The opt-in smoke check uses a small independent Python wire peer, not the browser or TypeScript client. It intentionally sets region US and label `Reaper hardware test`, then resets the board. Run only when those changes are intended:

```sh
.tools/espressif/python_env/idf5.5_py3.12_env/bin/python tools/hardware-smoke.py --port /dev/cu.usbserial-0001 --confirm-write
```

Its local result is build/heltec-v3/hardware-smoke.json. The reviewed build manifest describes the pre-flash artifacts; it is not a live hardware-status record. Future builds need fresh hash review.

## Physical TypeScript client check

After the startup fix, three serial opens reached ready without a fixed boot delay. This check is read-only at the protocol level; opening the observed bridge resets the board. It exercises the real Connection through a Python byte bridge, not browser Web Serial:

```sh
node tools/hardware-client-smoke.ts .tools/espressif/python_env/idf5.5_py3.12_env/bin/python /dev/cu.usbserial-0001
```

USB startup recovery is implemented: repeat the same hello at most once per 500 ms while negotiating, without extending the five-second deadline. Retries do not accumulate behind queued writes; welcome retires any unsent hello. No configuration mutation is replayed. All 131 host tests and the web build pass. The actual TypeScript Connection reached ready on three consecutive physical serial opens in 647/646/650 ms using a Python byte bridge, with persisted revision 2 unchanged. This qualifies the client protocol startup path; browser permission/stream behavior remains unverified on hardware.

The physical check was also extended to the real SerialAdapter using standard Web Streams over the Python serial byte bridge. Three consecutive opens reached ready in 626/645/648 ms, with revision 2 unchanged. Native browser permission, chooser, and browser-specific stream behavior remain pending.

## Browser hardware evidence

November 1, 2026: native Brave Web Serial hardware QA passed against usb-prototype-0 on the Heltec V3. The browser chooser selected CP2102 cu.usbserial-0001; the console reached Connected · synchronized with revision 2. Saving label Reaper Mesh V3 returned Committed on device and revision 3. Explicit disconnect released the port and disabled editing; reconnect through the chooser returned the same label/revision and preserved the page-session command history. The radio remained disabled. Screenshot evidence is local/ignored at build/heltec-v3/browser-usb.png. Physical cable removal, browser reload during an uncertain command, real power loss, display, and RF remain unqualified.

## OLED prototype update

The usb-prototype-1 image adds best-effort OLED status and keeps the same partition table and USB protocol. Routine USB firmware updates/testing are authorized by the owner. Use the same reviewed write offsets and ROM recovery route; do not erase NVS. The current manifest is regenerated for each build. The screen should show version, USB status, revision, storage health, and RADIO OFF; a successful serial check alone does not verify visible pixels.

Pin/power references: [Espressif Heltec V3 variant](https://github.com/espressif/arduino-esp32/blob/master/variants/heltec_wifi_lora_32_V3/pins_arduino.h), [Heltec power polarity](https://github.com/HelTecAutomation/Heltec_ESP32/blob/master/src/heltec.h), and [Heltec controller/address](https://github.com/HelTecAutomation/Heltec_ESP32/blob/master/src/heltec.cpp). Reviewed against the pinned ESP-IDF 5.5.4 I2C headers/SSD1306 driver.

Installed OLED update from commit 5a72fe6 on November 1, 2026. Application size 227,440 bytes; SHA-256 3baba75a548faca771733ec7e917c8d79fc25f9ee9f104c65de95c3fdbd70c7a. Esptool verified all three artifacts. Three physical TypeScript Connection/SerialAdapter opens confirmed usb-prototype-1 and persisted revision 3, reaching ready in 650/649/648 ms. NVS was not erased. These serial results do not verify visible OLED pixels or actual display-fault behavior; visual confirmation and real I2C fault injection remain pending.

## Physical recovery and message tests

`node tools/hardware-recovery-smoke.ts PYTHON PORT --confirm-write` writes the existing settings values twice, discards their commit replies, verifies query-only reconnect recovery and duplicate suppression, then resets and checks persistence/reboot ambiguity. It does not erase NVS.

`node tools/hardware-client-smoke.ts PYTHON PORT usb-prototype-2 --message-test` submits one 1024-byte test message and verifies queued -> expired failure with RF off, then repeats USB opens. It waits about a minute for the actual queue lifetime. Device queue acceptance is not RF delivery. OLED operation was confirmed visually by the owner.

## Hardware message acceptance evidence

usb-prototype-2 was installed from commit 443326d (230,960-byte application, SHA-256 5edcc60831f7ecdf2aa1873b3960001c72fe5a3050d8a10d97993a70323a5f87). Esptool verified all artifacts. Physical TS client/adapter testing accepted an exactly 1024-byte message, then observed failed/expired after the RF-disabled queue lifetime. Subsequent opens synchronized at persisted configuration revision 5. Native Brave also queued a multiline message, queried its status, and showed unknown on disconnect without resending it. Local screenshot: build/heltec-v3/browser-message.png. No RF transmission occurred.

Physical usb-prototype-3 testing now passes named-channel queue acceptance and radio-policy quiesce. A power change caused radio-config-changed; the client now preserves accepted messages during config snapshot resync and observes the failure by query. Previous settings were restored to mode off, power 2, relay enabled, Public/Camp channels; revision 12 survives repeated opens. No RF was enabled. The failed first test exposed an integration path omitting device identity; a Connection-level regression now covers it.

## Integrated board hardware check

For usb-prototype-4, `node tools/hardware-client-smoke.ts PYTHON PORT usb-prototype-4 --local-test` checks the actual SX1262 probe, main-stack headroom, 1024-byte local delivery/inbox retrieval, receive-only initialization and restoration of off mode across repeated opens. Local acknowledgment is not RF evidence. Antenna verification in board_profile.hpp remains false, so no remote transmissions are admitted. The manifest now records probe/RX support and the separate antenna gate rather than claiming the transceiver stays permanently in reset.
