# Initial hardware inventory

Read-only inspection on November 1, 2026 found:

- Serial port: `/dev/cu.usbserial-0001`.
- USB product: CP2102 USB to UART Bridge Controller, Silicon Labs.
- USB vendor/product IDs: `0x10c4` / `0xea60`.
- Owner confirms a US-model Heltec V3 / Version 3 board with the built-in display. This is the target board family; exact PCB subrevision and RF band remain unverified.

The USB bridge identification is consistent with a USB UART path but does not prove the board model, revision, RF band, antenna, or flash size. Treat US band as owner-reported, not electronically verified. Check the board label/order details before radio firmware development and transmission. ROM serial commands have opened/reset the device and run a RAM stub for read-only identification/backup. No flash/erase/eFuse writes occurred.

Local tools observed: Node 25.9.0, npm 11.12.1, Python 3.12.4. `idf.py` was not on PATH. Host tests use the built-in Node TypeScript runner plus pinned development tooling and a C++17 host compiler. Node 24 is the proposed development baseline; Node 25 is the current locally tested runtime. ESP-IDF v5.5.4 is installed under ignored .tools/ and pinned in firmware/esp-idf.lock.json.

## Display and manufacturer baseline

The owner describes the screen as an LCD. Heltec documents the WiFi LoRa 32 V3 built-in screen as a 0.96-inch 128×64 OLED, with ESP32-S3FN8, SX1262, CP2102 USB UART, and nominal 8 MB flash. Source: [Heltec V3 product details](https://heltec.org/project/wifi-lora-32-v3/), checked November 1, 2026. These identify the expected board family, not an electronic verification of this unit. No display driver, pin map, or RF-band assumption is needed for the portable device authority. Display bring-up follows the first USB-only firmware milestone.

## ROM inspection and backup status

The USB-only ESP-IDF v5.5.4 application now builds for ESP32-S3/8 MB. It integrates the portable session engine, framed UART0 at 115200, fresh boot IDs, and a fail-closed NVS backend. GPIO12 holds the SX1262 in reset; Wi-Fi, BLE, display initialization, and RF transmission are disabled. All 128 host tests, strict/generated checks, web build, and 24 CTest cases pass locally. Native wire tests exercise the real TypeScript client against the C++ session, including reconnect recovery and uncertain persistence. Real device connection/persistence and power-loss qualification remain pending. ROM inspection/reset confirmed ESP32-S3 revision v0.2, 8 MB flash, secure boot disabled, and flash encryption disabled. No flash, erase, or eFuse writes have occurred. The owner explicitly declined preservation of the existing firmware/settings. Backup attempts are discontinued; the unverified partial read is not a recovery image. Review the exact image and ROM USB reinstall procedure before first-flash authorization. See docs/FIRST_FLASH.md.

The existing partition table identifies NVS at 0x9000 with size 0x5000. The proposed image preserves this range and uses a separate namespace/key without an automatic erase fallback. USB identification cannot verify the antenna or RF band. Backup files/logs stay private under ignored .backups/.

## First Reaper firmware test

First flash completed November 1, 2026 using commit c41dc6e, USB app SHA-256 bf2be8a9514df3f463d7edcfe76752d791ec7b871284f7e099d42bbb81cff523. Esptool verified all three written artifacts. Physical USB smoke checks passed: handshake/snapshot, NVS configuration commit, logical reconnect, retained receipt query, serial reopen, and reset with fresh boot identity and persisted revision/settings. Opening this CP2102 port reset the board; immediate negotiation timed out, while waiting two seconds succeeded. Browser Web Serial startup/retry handling needs qualification before calling the web path ready. No display, RF, physical cable-removal, power-cut, or long-duration qualification is claimed.

## Browser hardware evidence

November 1, 2026: native Brave Web Serial hardware QA passed against usb-prototype-0 on the Heltec V3. The browser chooser selected CP2102 cu.usbserial-0001; the console reached Connected · synchronized with revision 2. Saving label Reaper Mesh V3 returned Committed on device and revision 3. Explicit disconnect released the port and disabled editing; reconnect through the chooser returned the same label/revision and preserved the page-session command history. The radio remained disabled. Screenshot evidence is local/ignored at build/heltec-v3/browser-usb.png. Physical cable removal, browser reload during an uncertain command, real power loss, display, and RF remain unqualified.
